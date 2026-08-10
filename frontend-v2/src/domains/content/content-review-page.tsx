import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { FormField } from '@/design-system/forms/form-field';
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
import { Skeleton } from '@/design-system/primitives/skeleton';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';
import { Timeline } from '@/design-system/workspace/timeline';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import type { components } from '@/shared/api/generated/schema';
import {
  approveContentVersion,
  contentKeys,
  ContentRequestError,
  contentReviewContextErrorKind,
  contentReviewContextQueryOptions,
  requestContentVersionChanges,
} from './content.api';
import {
  contentReviewTimelineItems,
  mapContentReviewCommandError,
  replaceCanonicalContentVersion,
  requestChangesSchema,
  resolveContentReviewActions,
  toRequestChangesCommand,
  type ContentReviewContext,
  type ContentVersion,
  type RequestChangesValues,
} from './content-review.model';
import { contentWorkflowStageRegistry } from './content-task-list.model';

type ContentDiff = components['schemas']['ContentDiff'];
type QualityIssue = components['schemas']['QualityIssue'];

type ContentReviewPageProps = {
  taskId: string;
  csrfToken: string | null;
};

const contentStatusRegistry = {
  DRAFT: { label: '草稿', tone: 'info' },
  PENDING_REVIEW: { label: '待审核', tone: 'warning' },
  CHANGES_REQUESTED: { label: '已退回修改', tone: 'warning' },
  APPROVED: { label: '已批准', tone: 'success' },
  SUPERSEDED: { label: '历史版本', tone: 'secondary' },
  ABANDONED: { label: '已放弃', tone: 'secondary' },
} as const satisfies Record<ContentVersion['status'], StatusPresentation>;

type StatusPresentation = {
  label: string;
  tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
};

function ContentReviewPage({ csrfToken, taskId }: ContentReviewPageProps) {
  const review = useQuery(contentReviewContextQueryOptions(taskId));
  const [contextStale, setContextStale] = useState(false);

  async function refresh() {
    const result = await review.refetch();
    if (result.error) return undefined;
    setContextStale(false);
    return result.data;
  }

  if (review.isPending) return <ContentReviewSkeleton taskId={taskId} />;
  if (!review.data && review.error) {
    return <ContentReviewFailure error={review.error} onRetry={() => void refresh()} taskId={taskId} />;
  }
  if (!review.data) return null;

  return (
    <div className="min-w-0 space-y-4">
      {review.error && (
        <ContentReviewRefreshFailure error={review.error} onRetry={() => void refresh()} />
      )}
      <ContentReviewWorkspace
        context={review.data}
        contextStale={contextStale}
        csrfToken={csrfToken}
        onContextStale={() => setContextStale(true)}
        onRefresh={refresh}
        taskId={taskId}
      />
    </div>
  );
}

function ContentReviewWorkspace({
  context,
  contextStale,
  csrfToken,
  onContextStale,
  onRefresh,
  taskId,
}: ContentReviewPageProps & {
  context: ContentReviewContext;
  contextStale: boolean;
  onContextStale: () => void;
  onRefresh: () => Promise<ContentReviewContext | undefined>;
}) {
  const queryClient = useQueryClient();
  const [commandError, setCommandError] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const requestFocusRef = useRef<HTMLElement | null>(null);
  const approve = useMutation({
    mutationFn: () => approveContentVersion(
      context.content.id,
      context.content.revision,
      csrfToken,
    ),
  });
  const requestChanges = useMutation({
    mutationFn: (values: RequestChangesValues) => requestContentVersionChanges(
      context.content.id,
      toRequestChangesCommand(values, context.content.revision),
      csrfToken,
    ),
  });

  async function refreshRelated(canonical: ContentVersion) {
    queryClient.setQueryData<ContentReviewContext>(
      contentKeys.reviewContext(taskId),
      (current) => current ? replaceCanonicalContentVersion(current, canonical) : current,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: contentKeys.details(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: contentKeys.reviewContexts(), refetchType: 'none' }),
    ]);
  }

  async function acceptCanonical(canonical: ContentVersion, message: string) {
    setCommandError(undefined);
    setRequestId(undefined);
    onContextStale();
    await refreshRelated(canonical);
    setAnnouncement(message);
    await onRefresh();
  }

  async function handleCommandError(error: unknown) {
    const mapped = mapContentReviewCommandError(error);
    setCommandError(mapped.formMessage);
    setRequestId(mapped.requestId);
    if (error instanceof ContentRequestError && error.status === 409) {
      onContextStale();
      await onRefresh();
    }
    return mapped;
  }

  async function approveTarget() {
    try {
      const canonical = await approve.mutateAsync();
      await acceptCanonical(canonical, `内容版本 v${canonical.version} 已批准`);
    } catch (error) {
      await handleCommandError(error);
    }
  }

  async function requestTargetChanges(values: RequestChangesValues) {
    try {
      const canonical = await requestChanges.mutateAsync(values);
      await acceptCanonical(canonical, `内容版本 v${canonical.version} 已退回修改`);
      closeRequestDialog();
      return canonical;
    } catch (error) {
      await handleCommandError(error);
      throw error;
    }
  }

  function openRequestDialog() {
    requestFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setRequestOpen(true);
  }

  function closeRequestDialog() {
    setRequestOpen(false);
    queueMicrotask(() => {
      if (requestFocusRef.current?.isConnected) requestFocusRef.current.focus();
    });
  }

  const pending = approve.isPending || requestChanges.isPending;
  const actions = resolveContentReviewActions(context, {
    pending,
    stale: contextStale,
    onApprove: () => void approveTarget(),
    onRequestChanges: openRequestDialog,
  });
  const summaryErrors: ErrorSummaryItem[] = [];
  if (commandError) summaryErrors.push({ id: 'command', message: commandError });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  const status = contextStale
    ? '正在刷新服务端审核上下文…'
    : commandError
      ? '审核请求失败，请核对服务端最新上下文'
      : announcement || (actions.length
        ? `Revision ${context.content.revision}`
        : '当前为只读状态，没有可执行的审核动作');

  return (
    <article className="min-w-0 space-y-4" aria-labelledby="content-review-title">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">Content Review</p>
          <h1 className="break-words type-page-title" id="content-review-title">
            {context.content.title}
          </h1>
          <p className="break-words text-text-secondary">
            内容版本 v{context.content.version} · {context.content.source_type === 'AI' ? 'AI 初稿' : '人工内容'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge presentation={contentWorkflowStageRegistry[context.task.workflow_stage]} />
          <StatusBadge presentation={contentStatusRegistry[context.content.status]} />
        </div>
      </header>

      <ErrorSummary errors={summaryErrors} title="审核请求未完成" />
      <WorkspaceShell
        ariaLabel="内容审核工作台"
        context={{
          label: '审核上下文',
          content: <ContentReviewContextPanel context={context} />,
        }}
        main={{
          label: 'Canonical Markdown',
          content: (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-raised px-4 py-3">
                <h2 className="type-section-title">Canonical Markdown</h2>
                <Badge variant="outline">只读主线</Badge>
              </div>
              <MarkdownPreview
                ariaLabel={`内容版本 v${context.content.version} canonical Markdown`}
                value={context.content.body_markdown}
              />
            </div>
          ),
        }}
        reference={{
          label: 'Review Panel',
          content: <ContentReviewPanel context={context} />,
        }}
      />
      <StickyActionBar actions={actions} status={<span aria-live="polite">{status}</span>} />
      <p aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</p>

      {requestOpen && (
        <RequestChangesDialog
          onClose={closeRequestDialog}
          onSubmit={requestTargetChanges}
          submitting={requestChanges.isPending}
          version={context.content.version}
        />
      )}
    </article>
  );
}

function ContentReviewContextPanel({ context }: { context: ContentReviewContext }) {
  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="type-label text-text-muted">当前内容主线</p>
        <p className="mt-1 break-all font-mono text-sm font-semibold text-text-primary">
          {context.task.current_content_version_id}
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <Metadata label="任务" mono value={context.task.id} />
        <Metadata label="内容版本" mono value={`v${context.content.version}`} />
        <Metadata label="来源" value={context.content.source_type === 'AI' ? 'AI' : '人工'} />
        <Metadata label="状态" value={contentStatusRegistry[context.content.status].label} />
        <Metadata label="Revision" mono value={String(context.content.revision)} />
        <Metadata label="事实版本" mono value={`v${context.fact_version.version}`} />
        <Metadata label="平台配置" mono value={context.task.platform_profile_id ?? '未绑定'} />
      </dl>
      <a
        className="inline-flex rounded-md border border-border-default px-3 py-2 text-sm font-medium"
        href={`/content/tasks/${encodeURIComponent(context.task.id)}`}
      >
        返回任务详情
      </a>
    </div>
  );
}

function ContentReviewPanel({ context }: { context: ContentReviewContext }) {
  const blocking = context.content.quality_issues.filter((issue) => issue.severity === 'BLOCKING');
  const warnings = context.content.quality_issues.filter((issue) => issue.severity === 'WARNING');
  const snapshot = context.generation_trace?.input_snapshot;

  return (
    <div className="space-y-6 p-4">
      <ReviewSection id="content-review-blocking" title="Blocking issues">
        <QualityIssues emptyMessage="没有阻断问题" issues={blocking} />
      </ReviewSection>
      <ReviewSection id="content-review-warnings" title="Warnings">
        <QualityIssues emptyMessage="没有警告" issues={warnings} />
      </ReviewSection>
      <ReviewSection id="content-review-facts" title="Fact consistency">
        <p className="text-sm text-text-secondary">
          以下批准事实是当前内容的锁定核对依据。
        </p>
        <MarkdownPreview
          ariaLabel={`事实版本 v${context.fact_version.version} Markdown 核对依据`}
          className="max-h-72 min-h-32 rounded-lg border border-border-subtle p-3"
          value={context.fact_version.body_markdown}
        />
      </ReviewSection>
      <ReviewSection id="content-review-platform" title="Platform adaptation">
        {snapshot ? (
          <div className="space-y-3 text-sm">
            <Metadata label="生成合同" mono value={snapshot.contract_version} />
            <Metadata label="生成作业" mono value={context.generation_trace?.job_id ?? '—'} />
            <SnapshotValue label="平台快照" value={snapshot.platform_profile ?? null} />
            <SnapshotValue label="模型快照" value={snapshot.model} />
            <SnapshotValue label="渠道快照" value={snapshot.channel} />
          </div>
        ) : (
          <p className="text-sm text-text-muted">该内容版本没有 AI generation snapshot。</p>
        )}
        {context.humanization_traces.length > 0 && (
          <p className="text-xs text-text-muted">
            已记录 {context.humanization_traces.length} 次自然化快照；canonical 内容仍以当前版本为准。
          </p>
        )}
      </ReviewSection>
      <ReviewSection id="content-review-diff" title="Canonical diff">
        <ContentVersionDiff diff={context.diff} />
      </ReviewSection>
      <ReviewSection id="content-review-timeline" title="Review timeline">
        <Timeline
          emptyMessage="该内容版本暂无审核记录"
          items={contentReviewTimelineItems(context)}
        />
      </ReviewSection>
    </div>
  );
}

function ReviewSection({ children, id, title }: { children: ReactNode; id: string; title: string }) {
  return (
    <section aria-labelledby={id} className="space-y-3 border-b border-border-subtle pb-5 last:border-0 last:pb-0">
      <h2 className="type-section-title" id={id}>{title}</h2>
      {children}
    </section>
  );
}

function QualityIssues({ emptyMessage, issues }: { emptyMessage: string; issues: QualityIssue[] }) {
  if (issues.length === 0) return <p className="text-sm text-text-muted">{emptyMessage}</p>;
  return (
    <ul className="space-y-2">
      {issues.map((issue, index) => (
        <li className="rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm" key={`${issue.code}-${index}`}>
          <p className="font-mono text-xs text-text-muted">{issue.code}</p>
          <p className="mt-1 text-text-primary">{issue.message}</p>
        </li>
      ))}
    </ul>
  );
}

function SnapshotValue({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-lg border border-border-subtle bg-surface-raised p-3">
      <summary className="cursor-pointer font-medium text-text-primary">{label}</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function ContentVersionDiff({ diff }: { diff: ContentDiff | null }) {
  if (!diff) return <p className="text-sm text-text-muted">首个内容版本，没有前序版本可比较。</p>;
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border-subtle" role="region" aria-label="内容版本 canonical Markdown 差异" tabIndex={0}>
      <ol className="min-w-max font-mono text-xs leading-5">
        {diff.lines.map((line, index) => {
          const presentation = {
            ADD: { symbol: '+', label: '新增', className: 'bg-success/5 text-success' },
            DELETE: { symbol: '−', label: '删除', className: 'bg-danger/5 text-danger' },
            EQUAL: { symbol: ' ', label: '未变更', className: 'text-text-secondary' },
          }[line.kind];
          return (
            <li
              className={`grid grid-cols-[2rem_2rem_1.5rem_minmax(12rem,1fr)] gap-1 px-2 py-0.5 ${presentation.className}`}
              key={`${line.kind}-${line.old_line ?? 'x'}-${line.new_line ?? 'x'}-${index}`}
            >
              <span aria-label={line.old_line == null ? '原行无' : `原行 ${line.old_line}`}>{line.old_line ?? ''}</span>
              <span aria-label={line.new_line == null ? '新行无' : `新行 ${line.new_line}`}>{line.new_line ?? ''}</span>
              <span aria-label={presentation.label}>{presentation.symbol}</span>
              <span className="whitespace-pre">{line.text || ' '}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RequestChangesDialog({
  onClose,
  onSubmit,
  submitting,
  version,
}: {
  onClose: () => void;
  onSubmit: (values: RequestChangesValues) => Promise<ContentVersion>;
  submitting: boolean;
  version: number;
}) {
  const [requestId, setRequestId] = useState<string>();
  const form = useForm<RequestChangesValues>({
    defaultValues: { comment: '' },
    resolver: zodResolver(requestChangesSchema),
  });

  async function submitValues(values: RequestChangesValues) {
    form.clearErrors();
    setRequestId(undefined);
    try {
      await onSubmit(values);
      form.reset();
    } catch (error) {
      const mapped = mapContentReviewCommandError(error);
      if (mapped.fields.comment) {
        form.setError('comment', { type: 'server', message: mapped.fields.comment });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
    }
  }

  const errors: ErrorSummaryItem[] = [];
  const commentMessage = form.formState.errors.comment?.message;
  if (commentMessage) {
    errors.push({ id: 'comment', fieldId: 'content-review-request-comment', message: commentMessage });
  }
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) errors.push({ id: 'form', message: formMessage });
  if (requestId) errors.push({ id: 'request-id', message: `请求 ID：${requestId}` });

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>退回内容版本 v{version}</DialogTitle>
          <DialogDescription>
            请说明需要修改的内容。退回后当前版本和生成快照保持不变，后续修改必须创建新修订。
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            className="space-y-4"
            id="content-review-request-changes-form"
            noValidate
            onSubmit={form.handleSubmit(submitValues)}
          >
            <ErrorSummary errors={errors} />
            <FormField<RequestChangesValues, 'comment'>
              description="退回意见不能为空。"
              id="content-review-request-comment"
              label="审核意见"
              name="comment"
              required
              render={(fieldContext) => (
                <textarea
                  {...fieldContext.field}
                  aria-describedby={fieldContext['aria-describedby']}
                  aria-invalid={fieldContext['aria-invalid']}
                  aria-required={fieldContext['aria-required']}
                  autoFocus
                  className="min-h-32 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
                  disabled={submitting}
                  id={fieldContext.inputId}
                />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose render={<Button disabled={submitting} variant="outline" />}>取消</DialogClose>
          <Button
            disabled={submitting}
            form="content-review-request-changes-form"
            type="submit"
            variant="destructive"
          >
            {submitting ? '提交中…' : '确认退回'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContentReviewSkeleton({ taskId }: { taskId: string }) {
  const panel = <div className="space-y-3 p-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-12" /><Skeleton className="h-20" /></div>;
  return (
    <article className="min-w-0 space-y-4" aria-busy="true" aria-labelledby="content-review-loading-title">
      <header className="space-y-2">
        <p className="type-label text-text-muted">Content Review</p>
        <h1 className="type-page-title" id="content-review-loading-title">正在加载内容审核上下文</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{taskId}</p>
      </header>
      <WorkspaceShell
        ariaLabel="正在加载内容审核工作台"
        context={{ label: '审核上下文', content: panel }}
        main={{ label: 'Canonical Markdown', content: <div className="p-4"><Skeleton className="h-80" /></div> }}
        reference={{ label: 'Review Panel', content: panel }}
      />
    </article>
  );
}

function ContentReviewFailure({ error, onRetry, taskId }: { error: unknown; onRetry: () => void; taskId: string }) {
  const kind = contentReviewContextErrorKind(error);
  const requestId = error instanceof ContentRequestError ? error.detail?.request_id : undefined;
  const content = {
    'not-found': ['未找到内容审核工作台', '该内容任务不存在，或已被删除。'],
    forbidden: ['无法访问内容审核工作台', '当前会话没有读取该审核上下文的权限。'],
    generic: ['内容审核工作台加载失败', error instanceof Error ? error.message : '读取审核上下文时发生未知错误。'],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      {requestId && <p className="font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href={`/content/tasks/${encodeURIComponent(taskId)}`}>返回任务详情</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function ContentReviewRefreshFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div>
        <p className="font-medium text-danger">刷新内容审核上下文失败，已保留当前 canonical 结果</p>
        <p className="mt-1 text-sm text-text-secondary">{error.message}</p>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">重试刷新</Button>
    </section>
  );
}

function Metadata({ label, mono = false, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-right text-text-primary' : 'break-words text-right text-text-primary'}>{value}</dd>
    </div>
  );
}

function StatusBadge({ presentation }: { presentation: StatusPresentation }) {
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

export { ContentReviewPage };
export type { ContentReviewPageProps };
