import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline, type TimelineItem } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import {
  ContentRequestError,
  contentVersionDetailErrorKind,
  contentVersionDetailQueryOptions,
} from './content.api';
import {
  contentReviewActionLabel,
  contentVersionStatusRegistry,
  formatContentVersionTime,
} from './content-version.model';

type ContentVersionDetail = components['schemas']['ContentVersionDetail'];
type LineageStep = components['schemas']['ContentVersionLineageStep'];
type ReviewRecord = components['schemas']['ReviewRecord'];

type ContentVersionDetailPageProps = {
  versionId: string;
};

const sourceLabels = {
  AI: 'AI 生成',
  HUMAN: '人工创作',
} as const;

const factStatusLabels = {
  PENDING_REVIEW: '待审核',
  CHANGES_REQUESTED: '待修订',
  APPROVED: '已批准',
  RETIRED: '已停用',
} as const;

const classificationLabels = {
  PUBLIC: '公开',
  INTERNAL: '内部',
  RESTRICTED: '受限',
} as const;

function ContentVersionDetailPage({ versionId }: ContentVersionDetailPageProps) {
  const detail = useQuery(contentVersionDetailQueryOptions(versionId));

  if (detail.isPending) return <ContentVersionDetailSkeleton versionId={versionId} />;
  if (!detail.data && detail.error) {
    return (
      <ContentVersionFailure
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data) return null;
  if (detail.data.content.id.toLowerCase() !== versionId.toLowerCase()) {
    return <ContentVersionMismatch />;
  }

  return (
    <div className="min-w-0 space-y-4">
      {detail.error && (
        <ContentVersionRefreshFailure
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      )}
      <ContentVersionDetailView detail={detail.data} />
    </div>
  );
}

function ContentVersionDetailView({ detail }: { detail: ContentVersionDetail }) {
  const { content, fact_version: fact } = detail;
  const status = contentVersionStatusRegistry[content.status];
  const timeline = reviewTimelineItems(detail.review_timeline);

  return (
    <article aria-labelledby="content-version-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">Content Version v{content.version}</p>
          <h1 className="break-words type-page-title" id="content-version-title">
            {content.title}
          </h1>
          <p className="text-text-secondary">
            历史版本、AI 版本、审核版本与当前版本均只读；修改必须回到所属任务创建新修订。
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant={status.tone}>{status.label}</Badge>
            <Badge variant="outline">{sourceLabels[content.source_type]}</Badge>
            <Badge variant={content.is_current ? 'info' : 'secondary'}>
              {content.is_current ? '当前主线' : '历史版本'}
            </Badge>
            <Badge variant="outline">只读 · 不可变快照</Badge>
          </div>
        </div>
        <ContentTaskLink taskId={content.task_id} />
      </header>

      <div className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection title="内容摘要">
          <p className="break-words text-text-primary">{content.summary}</p>
          <div aria-label="内容标签" className="mt-3 flex flex-wrap gap-2">
            {content.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
        </DetailSection>

        <DetailSection
          description="Markdown 是该版本冻结时的 canonical 正文，只可阅读。"
          title="正文 Markdown"
        >
          <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle">
            <MarkdownPreview
              ariaLabel={`内容版本 v${content.version} Markdown 快照`}
              value={content.body_markdown}
            />
          </div>
        </DetailSection>

        <DetailSection title="版本信息">
          <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata label="版本" mono value={`v${content.version}`} />
            <Metadata label="状态" value={status.label} />
            <Metadata label="来源" value={sourceLabels[content.source_type]} />
            <Metadata label="主线位置" value={content.is_current ? '当前版本' : '历史版本'} />
            <Metadata
              label="对应 Fact Version"
              value={(
                <a
                  className="font-medium text-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  href={`/products/${encodeURIComponent(fact.product_id)}/facts/versions/${encodeURIComponent(fact.id)}`}
                >
                  FactVersion v{fact.version}
                </a>
              )}
            />
            <Metadata
              label="Fact 状态 / 数据级别"
              value={`${factStatusLabels[fact.status]} · ${classificationLabels[fact.classification]}`}
            />
            <Metadata label="内容版本 ID" mono value={content.id} />
            <Metadata label="来源作业 ID" mono value={content.source_job_id ?? <EmptyValue />} />
            <Metadata label="基于版本 ID" mono value={content.based_on_id ?? <EmptyValue />} />
            <Metadata
              className="sm:col-span-2 lg:col-span-3"
              label="内容哈希"
              mono
              value={content.content_hash}
            />
            <Metadata
              className="sm:col-span-2 lg:col-span-3"
              label="变更摘要"
              value={content.change_summary}
            />
            <Metadata
              label="创建者"
              value={`${content.creator.display_name}（${content.creator.username}）`}
            />
            <Metadata label="创建时间" value={<ContentTime value={content.created_at} />} />
            <Metadata
              label="更新时间"
              value={content.updated_at ? <ContentTime value={content.updated_at} /> : '历史记录未记录'}
            />
          </dl>
        </DetailSection>

        <DetailSection
          description="只展示目标版本祖先链上的冻结 Prompt、模型与来源步骤。"
          title="生成与来源追溯"
        >
          {detail.generation_lineage ? (
            <div className="space-y-4">
              <LineageStepSnapshot
                label="原始生成"
                step={detail.generation_lineage.original_generation}
              />
              {detail.generation_lineage.humanizations.map((step, index) => (
                <LineageStepSnapshot
                  key={step.job_id}
                  label={`自然化 ${index + 1}`}
                  step={step}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">该版本没有生成、Prompt 或模型快照。</p>
          )}
        </DetailSection>

        <DetailSection title="审核结果">
          {detail.review_result ? (
            <ReviewResult record={detail.review_result} />
          ) : (
            <p className="text-sm text-text-muted">该版本没有审核结果。</p>
          )}
        </DetailSection>

        <DetailSection
          description="按服务端顺序展示该版本时点可见的追加式审核记录。"
          title="审核时间线"
        >
          <Timeline emptyMessage="该版本时点没有审核记录。" items={timeline} />
        </DetailSection>
      </div>
    </article>
  );
}

function LineageStepSnapshot({ label, step }: { label: string; step: LineageStep }) {
  const prompt = step.prompt;
  return (
    <section className="min-w-0 rounded-lg border border-border-subtle p-3">
      <h3 className="font-medium text-text-primary">{label}</h3>
      <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metadata label="Job ID" mono value={step.job_id} />
        <Metadata label="Job 类型" value={step.job_type} />
        <Metadata label="合同版本" mono value={step.contract_version} />
        <Metadata label="来源 Content Version" mono value={step.source_content_version_id ?? <EmptyValue />} />
        <Metadata label="Prompt 类型" value={prompt.kind} />
        <Metadata label="Prompt 名称" value={prompt.name ?? '未记录'} />
        <Metadata label="Prompt ID" mono value={prompt.id ?? <EmptyValue />} />
        <Metadata label="Prompt Revision" mono value={prompt.revision === null ? <EmptyValue /> : String(prompt.revision)} />
      </dl>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        <SnapshotDetails label="Channel snapshot" value={step.channel} />
        <SnapshotDetails label="Model snapshot" value={step.model} />
        <SnapshotDetails label="Prompt template" value={prompt.template_markdown ?? '未记录'} />
        <SnapshotDetails label="System message" value={prompt.system_message} />
        <SnapshotDetails className="lg:col-span-2" label="User message" value={prompt.user_message} />
      </div>
    </section>
  );
}

function SnapshotDetails({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: object | string;
}) {
  return (
    <details className={`min-w-0 rounded-md border border-border-subtle p-3 ${className ?? ''}`}>
      <summary className="cursor-pointer font-medium text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {label}
      </summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-text-secondary">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function ReviewResult({ record }: { record: ReviewRecord }) {
  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <Metadata label="结论" value={contentReviewActionLabel(record.action)} />
      <Metadata label="目标版本" mono value={`v${record.target_version}`} />
      <Metadata label="审核人" value={`${record.actor.display_name}（${record.actor.username}）`} />
      <Metadata label="审核时间" value={<ContentTime value={record.created_at} />} />
      <Metadata
        className="sm:col-span-2 lg:col-span-3"
        label="审核意见"
        value={record.comment || '未填写'}
      />
    </dl>
  );
}

function reviewTimelineItems(records: ReviewRecord[]): TimelineItem[] {
  return records.map((record) => ({
    id: record.id,
    title: contentReviewActionLabel(record.action),
    description: record.comment || undefined,
    meta: `${record.actor.display_name} · ${formatContentVersionTime(record.created_at)}`,
  }));
}

function ContentTaskLink({ taskId }: { taskId: string }) {
  return (
    <nav aria-label="Content Version 返回导航" className="flex flex-wrap sm:justify-end">
      <a
        className="inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/content/tasks/${encodeURIComponent(taskId)}`}
      >
        返回所属 Content Task
      </a>
    </nav>
  );
}

function ContentVersionDetailSkeleton({ versionId }: { versionId: string }) {
  return (
    <article aria-busy="true" aria-labelledby="content-version-loading-title" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <p className="type-label text-text-muted">Content Version 快照</p>
        <h1 className="type-page-title" id="content-version-loading-title">正在加载内容版本</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{versionId}</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <div className="space-y-3 p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-80" />
        </div>
        <div className="grid gap-3 border-t border-border-subtle p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    </article>
  );
}

function ContentVersionMismatch() {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">未找到该内容版本</h1>
      <p className="text-text-secondary">响应版本与当前 URL 不一致，未展示任何快照内容。</p>
      <ContentTasksLink />
    </section>
  );
}

function ContentVersionFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = contentVersionDetailErrorKind(error);
  const requestId = error instanceof ContentRequestError ? error.detail?.request_id : undefined;
  const content = {
    'not-found': ['未找到内容版本', '该内容版本不存在，或已被删除。'],
    forbidden: ['无法访问内容版本', '当前会话不能读取该内容版本。'],
    generic: ['内容版本加载失败', error instanceof Error ? error.message : '读取内容版本时发生未知错误。'],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      {requestId && <p className="break-all font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <ContentTasksLink />
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function ContentTasksLink() {
  return (
    <a
      className="inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href="/content/tasks?page=1&pageSize=20&archiveStatus=ACTIVE"
    >
      返回内容任务
    </a>
  );
}

function ContentVersionRefreshFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div>
        <p className="font-medium text-danger">刷新内容版本失败，已保留当前不可变快照</p>
        <p className="mt-1 text-sm text-text-secondary">{error.message}</p>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">重试刷新</Button>
    </section>
  );
}

function ContentTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatContentVersionTime(value)}</time>;
}

function EmptyValue() {
  return <span className="text-text-muted">未记录</span>;
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
      <dd className={`mt-1 text-text-primary ${mono ? 'break-all font-mono text-sm' : 'break-words'}`}>
        {value}
      </dd>
    </div>
  );
}

export { ContentVersionDetailPage };
export type { ContentVersionDetailPageProps };
