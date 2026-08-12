import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore, type ReactNode } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline, type TimelineItem } from '@/design-system/workspace/timeline';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import {
  PublicationRequestError,
  publicationKeys,
  publishedContentIssueWorkspaceQueryOptions,
} from './publication.api';
import { publicationEventLabels } from './published-article.model';
import {
  canonicalIssueWorkspaceHash,
  issueKindLabels,
  issueStageRegistry,
  issueWorkspaceSections,
  type PublishedContentIssueWorkspaceContext,
  type PublishedContentIssueWorkspaceSection,
} from './published-content-issue.model';
import { PublishedContentIssueWorkspaceActions } from './published-content-issue-workspace-actions';
import { formatPublicationTime } from './publication-work.model';

type PublishedContentIssueWorkspacePageProps = {
  csrfToken: string | null;
  issueId: string;
  onContentProjectionChange: (taskId: string) => Promise<void>;
  onSectionChange: (section: PublishedContentIssueWorkspaceSection) => Promise<void> | void;
};

const sectionLabels = {
  issue: '问题报告',
  article: '发布成果',
  repair: '修复任务',
  resolution: '解决记录',
  history: '不可变历史',
} satisfies Record<PublishedContentIssueWorkspaceSection, string>;

function subscribeHash(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
}

function currentHash() {
  return canonicalIssueWorkspaceHash(window.location.hash);
}

function PublishedContentIssueWorkspacePage({
  csrfToken,
  issueId,
  onContentProjectionChange,
  onSectionChange,
}: PublishedContentIssueWorkspacePageProps) {
  const queryClient = useQueryClient();
  const options = publishedContentIssueWorkspaceQueryOptions(issueId);
  const query = useQuery(options);
  const activeSection = useSyncExternalStore(subscribeHash, currentHash, () => 'issue');

  if (!query.data) {
    if (query.isPending) {
      return <p aria-busy="true" className="p-6 text-text-secondary">正在读取内容问题工作区…</p>;
    }
    return <IssueWorkspaceFailure error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!matchesIssueWorkspaceIdentity(query.data, issueId)) {
    return (
      <section className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-6" role="alert">
        <h1 className="type-page-title">内容问题上下文不一致</h1>
        <p className="text-sm text-danger">响应的问题、发布成果、来源内容或修复任务身份不一致。</p>
      </section>
    );
  }

  const context = query.data;
  const issue = context.issue;
  const article = context.article;
  const content = article.source_content.content;
  const stage = issueStageRegistry[issue.workflow_stage];
  const history: TimelineItem[] = [
    {
      id: `${issue.id}-opened`,
      title: '已登记内容问题',
      description: `${issueKindLabels[issue.kind]}：${issue.description}`,
      meta: formatPublicationTime(issue.opened_at),
    },
    ...(context.repair_task ? [{
      id: context.repair_task.id,
      title: '已创建修复任务',
      description: `任务状态：${context.repair_task.status}`,
      meta: formatPublicationTime(context.repair_task.created_at),
    }] : []),
    ...(issue.resolved_at ? [{
      id: `${issue.id}-resolved`,
      title: '已解决内容问题',
      description: `${issue.resolution_outcome ?? '未记录'}：${issue.resolution_comment ?? '未填写说明'}`,
      meta: formatPublicationTime(issue.resolved_at),
    }] : []),
    ...article.events.map((event) => ({
      id: event.id,
      title: publicationEventLabels[event.action],
      description: event.comment || undefined,
      meta: formatPublicationTime(event.created_at),
    })),
  ];

  async function refreshCanonicalContext(repairTaskId?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.issueLists() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.article(article.id) }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.articleLists() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.summary() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.issueRepairContexts() }),
      ...(repairTaskId ? [onContentProjectionChange(repairTaskId)] : []),
    ]);
  }

  const contextPane = (
    <div className="space-y-5 p-4">
      <dl className="space-y-3 text-sm">
        <ContextValue label="问题类型" value={issueKindLabels[issue.kind]} />
        <ContextValue label="当前阶段" value={stage.label} />
        <ContextValue label="平台" value={issue.platform_profile_name} />
        <ContextValue label="修订号" value={String(issue.revision)} />
        <ContextValue label="Issue ID" mono value={issue.id} />
      </dl>
      <nav aria-label="内容问题工作区章节">
        <ul className="space-y-1">
          {issueWorkspaceSections.map((section) => (
            <li key={section}>
              <a
                aria-current={activeSection === section ? 'location' : undefined}
                className="block rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-muted aria-[current=location]:bg-primary/10 aria-[current=location]:font-medium aria-[current=location]:text-primary"
                href={`#${section}`}
                onClick={(event) => {
                  event.preventDefault();
                  void onSectionChange(section);
                }}
              >
                {sectionLabels[section]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );

  const mainPane = (
    <div className="min-w-0">
      <div id="issue">
        <DetailSection description="问题类型、描述和登记身份创建后不可原地修改。" title="问题报告">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <ContextValue label="类型" value={issueKindLabels[issue.kind]} />
            <ContextValue label="登记时间" value={formatPublicationTime(issue.opened_at)} />
            <ContextValue className="sm:col-span-2" label="问题描述" value={issue.description} />
            <ContextValue className="sm:col-span-2" label="公开地址" value={(
              <a className="break-all text-link hover:underline" href={issue.final_url} rel="noreferrer" target="_blank">
                {issue.final_url}
              </a>
            )} />
          </dl>
          <p className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3 text-sm text-info">
            当前合同没有问题附件；判断依据是问题描述、公开地址、冻结正文、首次核验和发布事件。
          </p>
        </DetailSection>
      </div>
      <div id="article">
        <DetailSection description="首次 PASSED verification 锁定的 PublishedArticle 与来源 Markdown。" title="发布成果与来源快照">
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
            <ContextValue label="实际标题" value={article.actual_title} />
            <ContextValue label="首次核验" value={formatPublicationTime(article.verified_at)} />
            <ContextValue label="来源 Content Version" value={`v${content.version}`} />
            <ContextValue label="内容哈希" mono value={content.content_hash} />
          </dl>
          <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle">
            <MarkdownPreview ariaLabel="内容问题关联的发布来源 Markdown" value={content.body_markdown} />
          </div>
        </DetailSection>
      </div>
      <div id="repair">
        <DetailSection description="创建或完成修复任务都不会自动解决内容问题。" title="修复流程">
          {context.repair_task ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ContextValue label="任务状态" value={context.repair_task.status} />
              <ContextValue label="任务修订号" value={String(context.repair_task.revision)} />
              <ContextValue className="sm:col-span-2" label="任务入口" value={(
                <a className="break-all text-link hover:underline" href={`/content/tasks/${context.repair_task.id}`}>
                  {context.repair_task.id}
                </a>
              )} />
            </dl>
          ) : <p className="text-sm text-text-muted">尚未创建修复任务。</p>}
        </DetailSection>
      </div>
      <div id="resolution">
        <DetailSection description="解决记录一经提交不可编辑；解决问题不会修改修复任务状态。" title="解决记录">
          {issue.status === 'RESOLVED' ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ContextValue label="结果" value={issue.resolution_outcome === 'RESTORED' ? '已恢复' : '已退役'} />
              <ContextValue label="解决时间" value={issue.resolved_at ? formatPublicationTime(issue.resolved_at) : '未记录'} />
              <ContextValue label="解决人 ID" mono value={issue.resolved_by ?? '未记录'} />
              <ContextValue label="最终修订号" value={String(issue.revision)} />
              <ContextValue className="sm:col-span-2" label="解决说明" value={issue.resolution_comment ?? '未填写'} />
            </dl>
          ) : <p className="text-sm text-text-muted">问题仍处于 OPEN；需使用服务端 RESOLVE 动作显式解决。</p>}
        </DetailSection>
      </div>
    </div>
  );

  const referencePane = (
    <div className="space-y-4 p-4" id="history">
      <h2 className="type-section-title">不可变历史</h2>
      <Timeline emptyMessage="没有历史记录。" items={history} />
    </div>
  );

  return (
    <section aria-labelledby="published-content-issue-workspace-title" className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">Published Content Issue</p>
          <h1 className="break-words type-page-title" id="published-content-issue-workspace-title">{issue.actual_title}</h1>
          <p className="break-all text-sm text-text-secondary">Issue ID：{issue.id}</p>
        </div>
        <Badge variant={stage.tone}>{stage.label}</Badge>
      </header>
      {query.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3" role="alert">
          <p className="text-sm text-warning">后台刷新失败，当前快照仍保留：{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">重试刷新</Button>
        </div>
      )}
      <WorkspaceShell
        ariaLabel="发布内容问题工作区"
        context={{ label: '问题上下文', content: contextPane }}
        main={{ label: '问题与修复', content: mainPane }}
        reference={{ label: '不可变历史', content: referencePane }}
      />
      <PublishedContentIssueWorkspaceActions
        context={context}
        csrfToken={csrfToken}
        onCanonicalChange={refreshCanonicalContext}
        onReload={async () => {
          const refreshed = await query.refetch();
          if (refreshed.error) throw refreshed.error;
          if (!refreshed.data) throw new Error('重载内容问题工作区后未返回 Context');
          return refreshed.data;
        }}
      />
    </section>
  );
}

function matchesIssueWorkspaceIdentity(
  context: PublishedContentIssueWorkspaceContext,
  issueId: string,
) {
  return context.issue.id.toLowerCase() === issueId.toLowerCase()
    && context.issue.published_article_id === context.article.id
    && context.issue.article.id === context.article.id
    && context.article.content_version_id === context.article.verification.content_version_id
    && context.article.content_version_id === context.article.source_content.content.id
    && context.article.content_hash === context.article.source_content.content.content_hash
    && context.article.verification.outcome === 'PASSED'
    && (!context.repair_task
      || context.repair_task.source_published_content_issue_id === context.issue.id);
}

function IssueWorkspaceFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof PublicationRequestError ? error.status : undefined;
  const requestId = error instanceof PublicationRequestError ? error.detail?.request_id : undefined;
  const title = status === 404
    ? '未找到内容问题'
    : status === 403
      ? '无法访问内容问题'
      : status === 409
        ? '内容问题上下文不完整'
        : '内容问题工作区加载失败';
  return (
    <section className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-6" role="alert">
      <h1 className="type-page-title">{title}</h1>
      <p className="break-words text-sm text-danger">{errorMessage(error)}</p>
      {requestId && <p className="break-all font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap gap-3">
        <a className="text-link hover:underline" href="/publishing/issues?status=OPEN&page=1&pageSize=20">返回问题列表</a>
        {status !== 403 && status !== 404 && <Button onClick={onRetry} variant="outline">重试</Button>}
      </div>
    </section>
  );
}

function ContextValue({ className, label, mono = false, value }: {
  className?: string;
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs' : 'break-words text-text-primary'}>{value}</dd>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { PublishedContentIssueWorkspacePage, matchesIssueWorkspaceIdentity };
export type { PublishedContentIssueWorkspacePageProps };
