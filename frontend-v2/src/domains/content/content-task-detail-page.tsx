import { useQuery } from '@tanstack/react-query';

import { RowActions } from '@/design-system/data-table/row-actions';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import {
  contentTaskDetailErrorKind,
  contentTaskDetailQueryOptions,
} from './content.api';
import {
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
} from './content-task-actions';
import { useContentTaskLifecycle } from './content-task-lifecycle';
import {
  contentWorkflowStageRegistry,
  formatExactContentTaskTime,
} from './content-task-list.model';
import { contentVersionStatusRegistry } from './content-version.model';

type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type FactStatus = ContentTaskDetail['fact']['status'];
type GenerationStatus = NonNullable<ContentTaskDetail['generation']>['status'];
type PublicationStatus = NonNullable<ContentTaskDetail['publishing']>['work']['status'];
type ReviewAction = NonNullable<
  NonNullable<ContentTaskDetail['review']>['latest_result']
>['action'];
type SourceBasis = NonNullable<
  NonNullable<ContentTaskDetail['source']>['geo_optimization']
>['basis'];

type ContentTaskDetailPageProps = {
  csrfToken: string | null;
  onDeleted: () => Promise<void>;
  taskId: string;
};

const factStatusLabels = {
  PENDING_REVIEW: '待审核',
  CHANGES_REQUESTED: '待修订',
  APPROVED: '已批准',
  RETIRED: '已停用',
} satisfies Record<FactStatus, string>;
const generationStatusLabels = {
  PENDING: '等待执行',
  RUNNING: '执行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
} satisfies Record<GenerationStatus, string>;
const publicationStatusLabels = {
  PREPARING: '准备中',
  PLATFORM_REVIEW: '平台审核中',
  AWAITING_VERIFICATION: '等待核验',
  ACTION_REQUIRED: '需要处理',
  COMPLETED: '已完成',
  CLOSED: '已关闭',
} satisfies Record<PublicationStatus, string>;

function ContentTaskDetailPage({ csrfToken, onDeleted, taskId }: ContentTaskDetailPageProps) {
  const detail = useQuery(contentTaskDetailQueryOptions(taskId));
  const lifecycle = useContentTaskLifecycle({
    csrfToken,
    onDeleted: async () => onDeleted(),
    resolveTask: (candidateId) => (
      detail.data?.task.id === candidateId ? detail.data.task : undefined
    ),
  });

  if (detail.isPending) return <ContentTaskDetailSkeleton taskId={taskId} />;
  if (detail.error) {
    return <ContentTaskDetailFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const data = detail.data;
  const primary = resolveContentTaskPrimaryAction(data.task, {
    surface: 'detail',
    publicationWorkId: data.publishing?.work.id,
  });
  const overflow = resolveContentTaskOverflowActions(data.task, lifecycle.pendingAction);
  const readonly = data.task.archived_at !== null || data.task.status !== 'OPEN';

  return (
    <article className="min-w-0 space-y-4" aria-labelledby="content-task-detail-title">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-label text-text-muted">内容任务详情</p>
            {readonly && <Badge variant="secondary">只读</Badge>}
          </div>
          <h1 className="break-all font-mono type-page-title" id="content-task-detail-title">
            {data.task.identifier}
          </h1>
          <p className="break-words text-text-secondary">
            {data.product.brand} · {data.product.part_number} · {data.platform.name}
          </p>
        </div>
        <div className="min-w-0 sm:min-w-64">
          <RowActions
            objectLabel={data.task.identifier}
            onCommand={(command, focusReturn) => (
              lifecycle.handleCommand(command, data.task, focusReturn)
            )}
            overflow={overflow}
            primary={primary}
          />
        </div>
      </header>

      {lifecycle.notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
          {lifecycle.notice}
        </div>
      )}
      {lifecycle.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{errorMessage(lifecycle.error)}</span>
          <Button onClick={lifecycle.reset} size="sm" variant="outline">关闭</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <div id="summary">
          <DetailSection title="摘要" description="服务端投影的当前阶段、下一步和 canonical command state。">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryItem label="Workflow stage">
                <StatusBadge
                  label={contentWorkflowStageRegistry[data.task.workflow_stage].label}
                  tone={contentWorkflowStageRegistry[data.task.workflow_stage].tone}
                />
              </SummaryItem>
              <SummaryItem label="下一步">
                <span>{primary.label}</span>
                <code className="mt-1 block break-all text-xs text-text-muted">
                  {data.task.primary_task}
                </code>
              </SummaryItem>
              <SummaryItem label="任务状态">
                <StatusBadge
                  label={data.task.status === 'OPEN'
                    ? '进行中'
                    : data.task.status === 'COMPLETED' ? '已完成' : '已取消'}
                  tone={data.task.status === 'OPEN' ? 'info' : 'secondary'}
                />
              </SummaryItem>
              <SummaryItem label="Revision">
                <span className="font-mono">{data.task.revision}</span>
              </SummaryItem>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metadata label="创建时间" value={<TaskTime value={data.task.created_at} />} />
              <Metadata
                label="归档时间"
                value={data.task.archived_at ? <TaskTime value={data.task.archived_at} /> : <EmptyValue />}
              />
              <Metadata label="创建人 ID" value={data.task.created_by} mono />
            </dl>
          </DetailSection>
        </div>

        <DetailSection title="锁定上下文" description="任务创建时锁定的 Product、Fact 与 Platform identity。">
          <div className="grid gap-3 md:grid-cols-3">
            <ContextCard title="Product">
              <a className={linkClass} href={`/products/${encodeURIComponent(data.product.id)}`}>
                {data.product.brand} · {data.product.part_number}
              </a>
              <p className="mt-1 text-xs text-text-muted">状态：{data.product.status}</p>
            </ContextCard>
            <ContextCard title="Current Fact Version">
              <a
                className={linkClass}
                href={`/products/${encodeURIComponent(data.product.id)}/facts/versions/${encodeURIComponent(data.fact.id)}`}
              >
                v{data.fact.version} · {factStatusLabels[data.fact.status]}
              </a>
              <p className="mt-1 text-xs text-text-muted">分级：{data.fact.classification}</p>
            </ContextCard>
            <ContextCard title="Target Platform">
              <div className="flex items-center gap-2">
                {data.platform.logo && (
                  <img alt="" className="size-6 rounded object-contain" src={data.platform.logo.url} />
                )}
                {data.platform.id ? (
                  <a className={linkClass} href={`/settings/platforms/${encodeURIComponent(data.platform.id)}`}>
                    {data.platform.name}
                  </a>
                ) : <p>{data.platform.name}（历史快照）</p>}
              </div>
              {data.platform.website_url && (
                <a className={`${linkClass} mt-1 block break-all text-xs`} href={data.platform.website_url}>
                  {data.platform.website_url}
                </a>
              )}
            </ContextCard>
          </div>
        </DetailSection>

        <DetailSection title="当前内容" description="严格来自 current_content_version_id，不按版本号猜测。">
          {data.current_content ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metadata
                label="版本"
                value={(
                  <a className={linkClass} href={`/content/versions/${encodeURIComponent(data.current_content.id)}`}>
                    v{data.current_content.version}
                  </a>
                )}
              />
              <Metadata label="来源" value={data.current_content.source_type === 'AI' ? 'AI' : '人工'} />
              <Metadata
                label="状态"
                value={contentVersionStatusRegistry[data.current_content.status].label}
              />
              <Metadata label="标题" value={data.current_content.title} />
              <Metadata className="sm:col-span-2 lg:col-span-4" label="摘要" value={data.current_content.summary} />
            </dl>
          ) : <EmptyValue />}
        </DetailSection>

        <div id="generation">
          <DetailSection title="最近生成作业" description="服务端按 created_at、id 确定；本页不轮询。">
            {data.generation ? (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metadata label="作业" value={data.generation.job_type === 'GENERATE' ? '原始生成' : '自然化'} />
                <Metadata label="状态" value={generationStatusLabels[data.generation.status]} />
                <Metadata label="尝试次数" value={String(data.generation.attempt_count)} mono />
                <Metadata label="创建时间" value={<TaskTime value={data.generation.created_at} />} />
                <Metadata label="开始时间" value={data.generation.started_at ? <TaskTime value={data.generation.started_at} /> : <EmptyValue />} />
                <Metadata label="完成时间" value={data.generation.finished_at ? <TaskTime value={data.generation.finished_at} /> : <EmptyValue />} />
                <Metadata label="错误代码" value={data.generation.error_code ?? <EmptyValue />} mono />
                <Metadata label="失败摘要" value={data.generation.error_summary ?? <EmptyValue />} />
              </dl>
            ) : <EmptyValue />}
          </DetailSection>
        </div>

        <DetailSection title="审核摘要" description="只描述当前主线内容，不加载 Review Context 或 Diff。">
          {data.review ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metadata
                label="当前状态"
                value={contentVersionStatusRegistry[data.review.status].label}
              />
              <Metadata
                label="最近结果"
                value={data.review.latest_result
                  ? reviewActionLabel(data.review.latest_result.action)
                  : <EmptyValue />}
              />
              <Metadata
                label="审核人"
                value={data.review.latest_result
                  ? `${data.review.latest_result.actor.display_name}（${data.review.latest_result.actor.username}）`
                  : <EmptyValue />}
              />
              <Metadata
                label="审核时间"
                value={data.review.latest_result
                  ? <TaskTime value={data.review.latest_result.created_at} />
                  : <EmptyValue />}
              />
            </dl>
          ) : <EmptyValue />}
        </DetailSection>

        <DetailSection title="发布摘要" description="只展示当前工作与已核验结果，不加载 Publication Workspace。">
          {data.publishing ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ContextCard title="Publication Work">
                <a className={linkClass} href={`/publishing/work/${encodeURIComponent(data.publishing.work.id)}`}>
                  {publicationStatusLabels[data.publishing.work.status]}
                </a>
                <p className="mt-1 text-xs text-text-muted">
                  更新于 <TaskTime value={data.publishing.work.updated_at} />
                </p>
              </ContextCard>
              <ContextCard title="Published Result">
                {data.publishing.result ? (
                  <>
                    <a className={linkClass} href={`/publishing/articles/${encodeURIComponent(data.publishing.result.id)}`}>
                      {data.publishing.result.actual_title}
                    </a>
                    <p className="mt-1 text-xs text-text-muted">
                      已核验 · <TaskTime value={data.publishing.result.verified_at} />
                    </p>
                  </>
                ) : <EmptyValue />}
              </ContextCard>
            </div>
          ) : <EmptyValue />}
        </DetailSection>

        <DetailSection title="来源上下文" description="仅显示真实存在的 Query Topic、GEO 优化或发布问题来源。">
          {data.source ? (
            <div className="grid gap-3 md:grid-cols-3">
              <ContextCard title="Query Topic">
                {data.source.query_topic?.canonical_question ?? <EmptyValue />}
              </ContextCard>
              <ContextCard title="GEO Optimization">
                {data.source.geo_optimization ? (
                  <div className="space-y-1 text-sm">
                    <p>{geoRuleLabel(data.source.geo_optimization.rule_code)}</p>
                    <p className="text-text-muted">
                      {data.source.geo_optimization.date_from} 至 {data.source.geo_optimization.date_to}
                    </p>
                    <p className="text-text-secondary">
                      {geoBasisSummary(data.source.geo_optimization.basis)}
                    </p>
                  </div>
                ) : <EmptyValue />}
              </ContextCard>
              <ContextCard title="Published Content Issue">
                {data.source.published_content_issue ? (
                  <a
                    className={linkClass}
                    href={`/publishing/issues/${encodeURIComponent(data.source.published_content_issue.id)}`}
                  >
                    {issueKindLabel(data.source.published_content_issue.kind)} · {data.source.published_content_issue.status}
                  </a>
                ) : <EmptyValue />}
              </ContextCard>
            </div>
          ) : <EmptyValue />}
        </DetailSection>

        <div id="activity">
          <DetailSection title="Activity Timeline" description="服务端已排序并限制最近十项；前端保持原顺序。">
            <Timeline
              emptyMessage="暂无"
              items={data.activity.map((item) => ({
                id: item.id,
                title: item.summary,
                description: `${item.actor.display_name}（${item.actor.username}）`,
                meta: (
                  <div className="flex flex-col items-end gap-1">
                    <TaskTime value={item.timestamp} />
                    <a className={linkClass} href={activityTargetHref(item.target)}>
                      {item.target.label}
                    </a>
                  </div>
                ),
              }))}
            />
          </DetailSection>
        </div>
      </div>

      {lifecycle.dialogs}
    </article>
  );
}

function ContentTaskDetailSkeleton({ taskId }: { taskId: string }) {
  const sections = ['摘要', '锁定上下文', '当前内容', '最近生成作业', '审核摘要', '发布摘要', '来源上下文', 'Activity Timeline'];
  return (
    <article className="min-w-0 space-y-4" aria-busy="true" aria-labelledby="content-task-detail-loading-title">
      <header className="space-y-2">
        <p className="type-label text-text-muted">内容任务详情</p>
        <h1 className="type-page-title" id="content-task-detail-loading-title">正在加载内容任务</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{taskId}</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        {sections.map((title) => (
          <DetailSection key={title} title={title}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </DetailSection>
        ))}
      </div>
    </article>
  );
}

function ContentTaskDetailFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = contentTaskDetailErrorKind(error);
  const content = {
    'not-found': ['未找到内容任务', '该任务不存在，或已被删除。'],
    forbidden: ['无法访问内容任务详情', '当前会话没有读取该任务详情的权限。'],
    generic: ['内容任务详情加载失败', errorMessage(error)],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      <div className="flex flex-wrap gap-2">
        <a className={linkClass} href="/content/tasks">返回内容任务列表</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function SummaryItem({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-muted p-3">
      <p className="type-label text-text-muted">{label}</p>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

function ContextCard({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle p-3">
      <p className="type-label text-text-muted">{title}</p>
      <div className="mt-1 break-words text-sm text-text-primary">{children}</div>
    </div>
  );
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
  value: React.ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-text-primary${mono ? ' font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
}) {
  return <Badge variant={tone}>{label}</Badge>;
}

function EmptyValue() {
  return <span className="text-text-muted">暂无</span>;
}

function TaskTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatExactContentTaskTime(value)}</time>;
}

function reviewActionLabel(action: ReviewAction) {
  switch (action) {
    case 'submit-review': return '已提交审核';
    case 'approve': return '已批准';
    case 'request-changes': return '要求修订';
    default: return assertNever(action);
  }
}

function geoRuleLabel(rule: NonNullable<NonNullable<ContentTaskDetail['source']>['geo_optimization']>['rule_code']) {
  switch (rule) {
    case 'CONTENT_DECLINE': return '内容表现下降';
    case 'LONG_UNMENTIONED': return '长期未被提及';
    case 'QUESTION_COVERAGE_GAP': return '问题覆盖缺口';
    default: return assertNever(rule);
  }
}

function geoBasisSummary(basis: SourceBasis) {
  switch (basis.rule_code) {
    case 'CONTENT_DECLINE':
      return `${basis.item.title} · ${basis.item.content_platform}`;
    case 'LONG_UNMENTIONED':
      return `${basis.item.title} · 连续 ${basis.item.unmentioned_days} 天未被提及`;
    case 'QUESTION_COVERAGE_GAP':
      return `${basis.item.canonical_question} · ${basis.item.geo_platform}`;
    default:
      return assertNever(basis);
  }
}

function issueKindLabel(kind: NonNullable<NonNullable<ContentTaskDetail['source']>['published_content_issue']>['kind']) {
  switch (kind) {
    case 'PAGE_UNAVAILABLE': return '页面不可用';
    case 'CONTENT_CHANGED': return '内容发生变化';
    case 'OTHER': return '其他问题';
    default: return assertNever(kind);
  }
}

function activityTargetHref(target: ContentTaskDetail['activity'][number]['target']) {
  switch (target.kind) {
    case 'CONTENT_TASK': return '#summary';
    case 'GENERATION_JOB': return '#generation';
    case 'CONTENT_VERSION': return `/content/versions/${encodeURIComponent(target.id)}`;
    case 'PUBLICATION_WORK': return `/publishing/work/${encodeURIComponent(target.id)}`;
    default: return assertNever(target.kind);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Content Task Detail 收到未处理值：${String(value)}`);
}

const linkClass = 'rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

export { ContentTaskDetailPage };
export type { ContentTaskDetailPageProps };
