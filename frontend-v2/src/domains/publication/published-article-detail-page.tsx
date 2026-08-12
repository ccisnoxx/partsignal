import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline, type TimelineItem } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import {
  PublicationRequestError,
  mapPublicationError,
  openPublishedContentIssue,
  publishedArticleQueryOptions,
  type PublicationStartErrorMapping,
} from './publication.api';
import {
  formatPublicationTime,
  publicationEventLabels,
  publishedArticleStageRegistry,
  publishedArticleUrlDomain,
  type PublishedArticle,
} from './published-article.model';
import {
  issueKindLabels,
  openIssueFormSchema,
  type PublishedContentIssue,
} from './published-content-issue.model';

type PublishedArticleDetailPageProps = {
  articleId: string;
  csrfToken: string | null;
  onIssueOpened: (issue: PublishedContentIssue) => Promise<void> | void;
};
type LineageStep = components['schemas']['ContentVersionLineageStep'];

function PublishedArticleDetailPage({
  articleId,
  csrfToken,
  onIssueOpened,
}: PublishedArticleDetailPageProps) {
  const article = useQuery(publishedArticleQueryOptions(articleId));

  if (article.isPending) return <PublishedArticleSkeleton articleId={articleId} />;
  if (!article.data && article.error) {
    return <PublishedArticleFailure error={article.error} onRetry={() => void article.refetch()} />;
  }
  if (!article.data) return null;
  if (!matchesArticleIdentity(article.data, articleId)) return <PublishedArticleMismatch />;

  return (
    <div className="min-w-0 space-y-4">
      {article.error && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="text-sm text-danger">刷新失败，已保留当前不可变成果：{article.error.message}</p>
          <Button onClick={() => void article.refetch()} variant="outline">重试刷新</Button>
        </section>
      )}
      <PublishedArticleDetailView
        article={article.data}
        csrfToken={csrfToken}
        onIssueOpened={onIssueOpened}
      />
    </div>
  );
}

function matchesArticleIdentity(article: PublishedArticle, articleId: string) {
  return article.id.toLowerCase() === articleId.toLowerCase()
    && article.content_version_id === article.verification.content_version_id
    && article.content_version_id === article.source_content.content.id
    && article.content_hash === article.source_content.content.content_hash
    && article.verification.outcome === 'PASSED'
    && (article.primary_task !== 'HANDLE_CONTENT_ISSUE' || Boolean(article.open_issue_id));
}

function PublishedArticleDetailView({ article, csrfToken, onIssueOpened }: {
  article: PublishedArticle;
  csrfToken: string | null;
  onIssueOpened: (issue: PublishedContentIssue) => Promise<void> | void;
}) {
  const content = article.source_content.content;
  const fact = article.source_content.fact_version;
  const stage = publishedArticleStageRegistry[article.workflow_stage];
  const eventItems: TimelineItem[] = article.events.map((event) => ({
    id: event.id,
    title: publicationEventLabels[event.action],
    description: event.comment || undefined,
    meta: formatPublicationTime(event.created_at),
  }));

  return (
    <article aria-labelledby="published-article-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">Published Article</p>
          <h1 className="break-words type-page-title" id="published-article-title">{article.actual_title}</h1>
          <p className="text-text-secondary">首次成功核验形成的只读发布成果；发布结果、来源正文与核验快照均不可原地修改。</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant={stage.tone}>{stage.label}</Badge>
            <Badge variant="outline">Passed</Badge>
            <Badge variant="outline">只读 · 不可变快照</Badge>
          </div>
        </div>
        <nav aria-label="发布成果导航" className="flex flex-wrap gap-2 sm:justify-end">
          <a className={navLinkClass} href="/publishing/articles?page=1&pageSize=20">返回成果列表</a>
          <a className={navLinkClass} href={article.final_url} rel="noreferrer" target="_blank">打开公开页面</a>
          {article.primary_task === 'HANDLE_CONTENT_ISSUE' && article.open_issue_id && (
            <a className={navLinkClass} href={`/publishing/issues/${article.open_issue_id}#issue`}>处理内容问题</a>
          )}
          {article.available_actions.includes('OPEN_ISSUE') && (
            <OpenIssueDialog article={article} csrfToken={csrfToken} onIssueOpened={onIssueOpened} />
          )}
        </nav>
      </header>

      <div className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection description="平台与账号文本来自发布工作完成时冻结的 snapshot。" title="发布成果">
          <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="PublishedArticle ID" mono value={article.id} />
            <Metadata label="PublicationWork ID" mono value={article.id} />
            <Metadata label="公开域名" value={publishedArticleUrlDomain(article.final_url)} />
            <Metadata className="sm:col-span-2 lg:col-span-3" label="Final URL" value={(
              <a className="break-all text-link hover:underline" href={article.final_url} rel="noreferrer" target="_blank">
                {article.final_url}
              </a>
            )} />
            <Metadata label="实际标题" value={article.actual_title} />
            <Metadata label="平台" value={article.platform_profile_name} />
            <Metadata label="账号" value={`${article.platform_account_label} · ${article.account_identifier}`} />
            <Metadata label="发布时间" value={<Time value={article.published_at} />} />
            <Metadata label="首次核验时间" value={<Time value={article.verified_at} />} />
            <Metadata label="内容健康" value={stage.label} />
          </dl>
        </DetailSection>

        <DetailSection description="来源 ContentVersion 的 canonical Markdown payload，只可阅读。" title="来源内容快照">
          <div className="space-y-4">
            <div>
              <h3 className="font-heading text-lg font-semibold">{content.title}</h3>
              <p className="mt-1 break-words text-text-secondary">{content.summary}</p>
              <div aria-label="来源内容标签" className="mt-3 flex flex-wrap gap-2">
                {content.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
              </div>
            </div>
            <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Metadata label="Content Version" value={(
                <a className="text-link hover:underline" href={`/content/versions/${content.id}`}>v{content.version}</a>
              )} />
              <Metadata label="所属 Content Task" value={(
                <a className="break-all text-link hover:underline" href={`/content/tasks/${content.task_id}`}>{content.task_id}</a>
              )} />
              <Metadata label="对应 Fact Version" value={(
                <a className="text-link hover:underline" href={`/products/${fact.product_id}/facts/versions/${fact.id}`}>FactVersion v{fact.version}</a>
              )} />
              <Metadata className="sm:col-span-2 lg:col-span-3" label="内容哈希" mono value={content.content_hash} />
              <Metadata label="来源" value={content.source_type === 'AI' ? 'AI 生成' : '人工创作'} />
              <Metadata label="创建者" value={`${content.creator.display_name}（${content.creator.username}）`} />
              <Metadata label="创建时间" value={<Time value={content.created_at} />} />
              <Metadata className="sm:col-span-2 lg:col-span-3" label="变更摘要" value={content.change_summary} />
            </dl>
            <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle">
              <MarkdownPreview ariaLabel={`发布成果来源内容 v${content.version} Markdown 快照`} value={content.body_markdown} />
            </div>
          </div>
        </DetailSection>

        <DetailSection description="PublishedArticle 固定指向首次 PASSED verification。" title="首次成功核验快照">
          <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="结果" value="PASSED" />
            <Metadata label="Verification ID" mono value={article.verification.id} />
            <Metadata label="核验人 ID" mono value={article.verification.actor_id} />
            <Metadata label="标题 snapshot" value={article.verification.actual_title_snapshot} />
            <Metadata label="发布时间 snapshot" value={<Time value={article.verification.published_at_snapshot} />} />
            <Metadata label="核验时间" value={<Time value={article.verification.created_at} />} />
            <Metadata className="sm:col-span-2 lg:col-span-3" label="URL snapshot" value={article.verification.final_url_snapshot} />
            <Metadata className="sm:col-span-2 lg:col-span-3" label="核验说明" value={article.verification.comment || '未填写'} />
          </dl>
        </DetailSection>

        <DetailSection description="展示来源版本身份、生成步骤与该版本审核结论。" title="来源与 lineage">
          <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="基于 Content Version" mono value={content.based_on_id ?? '未记录'} />
            <Metadata label="来源 Job" mono value={content.source_job_id ?? '未记录'} />
            <Metadata label="Fact Version ID" mono value={content.fact_version_id} />
          </dl>
          <GenerationLineage lineage={article.source_content.generation_lineage} />
          <p className="mt-4 text-sm text-text-secondary">
            审核结论：{article.source_content.review_result?.action ?? '未记录'}
            {article.source_content.review_result?.comment ? ` · ${article.source_content.review_result.comment}` : ''}
          </p>
        </DetailSection>

        <DetailSection description="按服务端固定顺序展示 PublicationWork 追加式事件。" title="发布事件时间线">
          <Timeline emptyMessage="没有发布事件。" items={eventItems} />
        </DetailSection>

        <DetailSection description="问题登记使用服务端 OPEN_ISSUE 动作；处理与解决交接到 canonical Issue Workspace。" title="内容健康">
          <p className="font-medium">{stage.label} · {article.issues.length} 条历史问题</p>
          {article.issues.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              {article.issues.map((issue) => (
                <li className="rounded-lg border border-border-subtle p-3" key={issue.id}>
                  <a className="font-medium text-link hover:underline" href={`/publishing/issues/${issue.id}#issue`}>
                    {issueKindLabels[issue.kind]}
                  </a>
                  {' · '}{issue.status}{' · '}{issue.description}
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
      </div>
    </article>
  );
}

function OpenIssueDialog({ article, csrfToken, onIssueOpened }: {
  article: PublishedArticle;
  csrfToken: string | null;
  onIssueOpened: (issue: PublishedContentIssue) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'PAGE_UNAVAILABLE' | 'CONTENT_CHANGED' | 'OTHER'>('PAGE_UNAVAILABLE');
  const [description, setDescription] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: (body: { kind: typeof kind; description: string }) => (
      openPublishedContentIssue(article.id, body, csrfToken)
    ),
  });
  const errors: ErrorSummaryItem[] = [
    ...(fieldError ? [{ id: 'description', fieldId: 'published-issue-description', message: fieldError }] : []),
    ...(serverError ? [
      { id: 'server', message: serverError.message },
      ...(serverError.requestId
        ? [{ id: 'request-id', message: `请求 ID：${serverError.requestId}` }]
        : []),
    ] : []),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(undefined);
    setServerError(undefined);
    const parsed = openIssueFormSchema.safeParse({ kind, description });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '请检查问题描述');
      return;
    }
    try {
      const issue = await mutation.mutateAsync(parsed.data);
      await onIssueOpened(issue);
      setOpen(false);
    } catch (error) {
      setServerError(mapPublicationError(error));
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} ref={triggerRef} type="button">登记内容问题</Button>
      <Dialog
        onOpenChange={(next) => !mutation.isPending && setOpen(next)}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setDescription('');
            setFieldError(undefined);
            setServerError(undefined);
          }
        }}
        open={open}
      >
        <DialogContent finalFocus={() => triggerRef.current} showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>登记“{article.actual_title}”的内容问题</DialogTitle>
            <DialogDescription>问题类型与描述提交后不可编辑；服务端会重新校验成果资格。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <ErrorSummary errors={errors} title="内容问题未登记" />
            <label className="block space-y-1.5" htmlFor="published-issue-kind">
              <span className="font-medium">问题类型</span>
              <Select
                disabled={mutation.isPending}
                items={Object.entries(issueKindLabels).map(([value, label]) => ({ value, label }))}
                onValueChange={(value) => value && setKind(value as typeof kind)}
                value={kind}
              >
                <SelectTrigger id="published-issue-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(issueKindLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5" htmlFor="published-issue-description">
              <span className="font-medium">问题描述</span>
              <textarea
                className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
                disabled={mutation.isPending}
                id="published-issue-description"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </label>
            <DialogFooter>
              <DialogClose disabled={mutation.isPending} render={<Button variant="outline" />}>取消</DialogClose>
              <Button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? '正在登记…' : '确认登记'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GenerationLineage({ lineage }: { lineage: PublishedArticle['source_content']['generation_lineage'] }) {
  if (!lineage) return <p className="mt-4 text-sm text-text-muted">该来源版本没有 AI 生成 lineage。</p>;
  const steps = [lineage.original_generation, ...lineage.humanizations];
  return (
    <ol className="mt-4 space-y-2">
      {steps.map((step, index) => <LineageItem index={index} key={step.job_id} step={step} />)}
    </ol>
  );
}

function LineageItem({ index, step }: { index: number; step: LineageStep }) {
  return (
    <li className="rounded-lg border border-border-subtle p-3 text-sm">
      <p className="font-medium">{index === 0 ? '原始生成' : `自然化 ${index}`} · {step.job_type}</p>
      <p className="mt-1 break-all font-mono text-xs text-text-secondary">Job {step.job_id} · Contract {step.contract_version}</p>
      <p className="mt-1 text-text-secondary">Prompt：{step.prompt.name ?? step.prompt.kind}</p>
    </li>
  );
}

function PublishedArticleSkeleton({ articleId }: { articleId: string }) {
  return (
    <article aria-busy="true" className="space-y-4">
      <header className="space-y-2">
        <p className="type-label text-text-muted">Published Article</p>
        <h1 className="type-page-title">正在加载发布成果</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{articleId}</p>
      </header>
      <div className="space-y-3 rounded-xl border border-border-subtle p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72" />
      </div>
    </article>
  );
}

function PublishedArticleMismatch() {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">未找到该发布成果</h1>
      <p className="text-text-secondary">响应成果、成功核验或来源内容身份不一致，未展示任何快照。</p>
      <a className={navLinkClass} href="/publishing/articles?page=1&pageSize=20">返回成果列表</a>
    </section>
  );
}

function PublishedArticleFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof PublicationRequestError ? error.status : undefined;
  const requestId = error instanceof PublicationRequestError ? error.detail?.request_id : undefined;
  const [title, description] = status === 404
    ? ['未找到发布成果', '该发布成果不存在，或已被删除。']
    : status === 403
      ? ['无法访问发布成果', '当前会话不能读取该发布成果。']
      : ['发布成果加载失败', error instanceof Error ? error.message : '读取发布成果时发生未知错误。'];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{title}</h1>
      <p className="text-text-secondary">{description}</p>
      {requestId && <p className="break-all font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap gap-3">
        <a className={navLinkClass} href="/publishing/articles?page=1&pageSize=20">返回成果列表</a>
        {status !== 403 && status !== 404 && <Button onClick={onRetry}>重试</Button>}
      </div>
    </section>
  );
}

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{formatPublicationTime(value)}</time>;
}

function Metadata({
  className,
  label,
  mono = false,
  value,
}: {
  className?: string;
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={`mt-1 text-text-primary ${mono ? 'break-all font-mono text-sm' : 'break-words'}`}>{value}</dd>
    </div>
  );
}

const navLinkClass = 'inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

export { PublishedArticleDetailPage };
export type { PublishedArticleDetailPageProps };
