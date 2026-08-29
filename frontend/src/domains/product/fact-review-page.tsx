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
  factReviewErrorKind,
  mapFactReviewCommandError,
  replaceCanonicalFactVersion,
  requestChangesSchema,
  resolveFactReviewActions,
  reviewTimelineItems,
  toRequestChangesCommand,
  type FactReviewTarget,
  type FactReviewWorkspace,
  type FactVersion,
  type RequestChangesValues,
} from './fact-review.model';
import {
  approveFactVersion,
  ProductRequestError,
  productFactReviewQueryOptions,
  productsKeys,
  requestFactVersionChanges,
} from './product.api';
import {
  confidentialityRegistry,
  productFactStatusRegistry,
  productStatusRegistry,
  productWorkflowStageRegistry,
} from './product.model';

type FactVersionDiff = components['schemas']['FactVersionDiff'];

type FactReviewPageProps = {
  productId: string;
  csrfToken: string | null;
};

function FactReviewPage({ csrfToken, productId }: FactReviewPageProps) {
  const review = useQuery(productFactReviewQueryOptions(productId));
  const [contextStale, setContextStale] = useState(false);

  async function refresh() {
    const result = await review.refetch();
    if (result.error) return undefined;
    setContextStale(false);
    return result.data;
  }

  if (review.isPending) return <FactReviewSkeleton productId={productId} />;
  if (!review.data && review.error) {
    return <FactReviewFailure error={review.error} onRetry={() => void refresh()} />;
  }
  if (!review.data) return null;

  return (
    <div className="min-w-0 space-y-4">
      {review.error && (
        <FactReviewRefreshFailure error={review.error} onRetry={() => void refresh()} />
      )}
      {review.data.review ? (
        <FactReviewWorkspaceView
          csrfToken={csrfToken}
          contextStale={contextStale}
          onRefresh={refresh}
          onContextStale={() => setContextStale(true)}
          productId={productId}
          target={review.data.review}
          workspace={review.data}
        />
      ) : (
        <FactReviewEmpty workspace={review.data} />
      )}
    </div>
  );
}

function FactReviewWorkspaceView({
  csrfToken,
  contextStale,
  onContextStale,
  onRefresh,
  productId,
  target,
  workspace,
}: FactReviewPageProps & {
  contextStale: boolean;
  onContextStale: () => void;
  onRefresh: () => Promise<FactReviewWorkspace | undefined>;
  target: FactReviewTarget;
  workspace: FactReviewWorkspace;
}) {
  const queryClient = useQueryClient();
  const [commandError, setCommandError] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const requestFocusRef = useRef<HTMLElement | null>(null);
  const approve = useMutation({
    mutationFn: () => approveFactVersion(
      target.fact_version.id,
      target.fact_version.revision,
      csrfToken,
    ),
  });
  const requestChanges = useMutation({
    mutationFn: (values: RequestChangesValues) => requestFactVersionChanges(
      target.fact_version.id,
      toRequestChangesCommand(values, target.fact_version.revision),
      csrfToken,
    ),
  });

  async function refreshRelated(canonical: FactVersion) {
    queryClient.setQueryData<FactReviewWorkspace>(
      productsKeys.factReview(productId),
      (current) => current ? replaceCanonicalFactVersion(current, canonical) : current,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productsKeys.lists(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: productsKeys.details(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: productsKeys.fact(productId), refetchType: 'none' }),
    ]);
  }

  async function acceptCanonical(canonical: FactVersion, message: string) {
    setCommandError(undefined);
    setRequestId(undefined);
    onContextStale();
    await refreshRelated(canonical);
    setAnnouncement(message);
    await onRefresh();
  }

  async function handleCommandError(error: unknown) {
    const mapped = mapFactReviewCommandError(error);
    setCommandError(mapped.formMessage);
    setRequestId(mapped.requestId);
    if (mapped.code === 'REVISION_CONFLICT' || mapped.code === 'INVALID_STATE_TRANSITION') {
      onContextStale();
      await onRefresh();
    }
    return mapped;
  }

  async function approveTarget() {
    try {
      const canonical = await approve.mutateAsync();
      await acceptCanonical(canonical, `事实版本 v${canonical.version} 已批准`);
    } catch (error) {
      await handleCommandError(error);
    }
  }

  async function requestTargetChanges(values: RequestChangesValues) {
    try {
      const canonical = await requestChanges.mutateAsync(values);
      await acceptCanonical(canonical, `事实版本 v${canonical.version} 已退回修改`);
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
  const actions = resolveFactReviewActions(target, {
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
      : announcement || (actions.length ? `Revision ${target.fact_version.revision}` : '当前没有可执行的审核动作');

  return (
    <article className="min-w-0 space-y-4" aria-labelledby="fact-review-title">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">事实审核工作台</p>
          <h1 className="break-words font-mono type-page-title" id="fact-review-title">
            {workspace.product.part_number}
          </h1>
          <p className="break-words text-text-secondary">
            {workspace.product.brand} · {workspace.product.category} · FactVersion v{target.fact_version.version}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge presentation={productStatusRegistry[workspace.product.status]} />
          <StatusBadge presentation={productWorkflowStageRegistry[workspace.product.workflow_stage]} />
          <StatusBadge presentation={productFactStatusRegistry[target.fact_version.status]} />
        </div>
      </header>

      <ErrorSummary errors={summaryErrors} title="审核请求未完成" />
      <WorkspaceShell
        ariaLabel="事实审核工作台"
        context={{
          label: '审核上下文',
          content: <FactReviewContextPanel target={target} workspace={workspace} />,
        }}
        main={{
          label: '不可变事实快照',
          content: (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-raised px-4 py-3">
                <h2 className="type-section-title">Fact Markdown snapshot</h2>
                <Badge variant="outline">只读快照</Badge>
              </div>
              <MarkdownPreview
                ariaLabel={`事实版本 v${target.fact_version.version} Markdown 快照`}
                value={target.fact_version.body_markdown}
              />
            </div>
          ),
        }}
        reference={{
          label: '差异与审核历史',
          content: <FactReviewReference target={target} />,
        }}
      />
      <StickyActionBar actions={actions} status={<span aria-live="polite">{status}</span>} />
      <p aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</p>

      {requestOpen && (
        <RequestChangesDialog
          onClose={closeRequestDialog}
          onSubmit={requestTargetChanges}
          submitting={requestChanges.isPending}
          version={target.fact_version.version}
        />
      )}
    </article>
  );
}

function FactReviewContextPanel({
  target,
  workspace,
}: {
  target: FactReviewTarget;
  workspace: FactReviewWorkspace;
}) {
  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="type-label text-text-muted">只读产品上下文</p>
        <p className="mt-1 break-words font-mono text-lg font-semibold text-text-primary">
          {workspace.product.part_number}
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <Metadata label="品牌" value={workspace.product.brand} />
        <Metadata label="类别" value={workspace.product.category} />
        <Metadata label="数据级别" value={confidentialityRegistry[target.fact_version.classification]} />
        <Metadata label="版本" mono value={`v${target.fact_version.version}`} />
        <Metadata label="状态" value={productFactStatusRegistry[target.fact_version.status].label} />
        <Metadata label="提交摘要" value={target.fact_version.change_summary} />
        <Metadata label="Revision" mono value={String(target.fact_version.revision)} />
      </dl>
    </div>
  );
}

function FactReviewReference({ target }: { target: FactReviewTarget }) {
  return (
    <div className="space-y-6 p-4">
      <section aria-labelledby="fact-diff-title" className="space-y-3">
        <h2 className="type-section-title" id="fact-diff-title">版本差异</h2>
        <FactDiff diff={target.diff} />
      </section>
      <section aria-labelledby="fact-history-title" className="space-y-3 border-t border-border-subtle pt-5">
        <h2 className="type-section-title" id="fact-history-title">审核历史</h2>
        <Timeline
          emptyMessage="该事实版本暂无审核记录"
          items={reviewTimelineItems(target)}
        />
      </section>
    </div>
  );
}

function FactDiff({ diff }: { diff: FactVersionDiff | null }) {
  if (!diff) {
    return <p className="text-sm text-text-muted">首个事实版本，没有前序版本可比较。</p>;
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border-subtle" role="region" aria-label="事实版本 Markdown 差异" tabIndex={0}>
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
  onSubmit: (values: RequestChangesValues) => Promise<FactVersion>;
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
      const mapped = mapFactReviewCommandError(error);
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
    errors.push({ id: 'comment', fieldId: 'fact-review-request-comment', message: commentMessage });
  }
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) errors.push({ id: 'form', message: formMessage });
  if (requestId) errors.push({ id: 'request-id', message: `请求 ID：${requestId}` });

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>退回事实版本 v{version}</DialogTitle>
          <DialogDescription>
            请说明需要修改的内容。退回后事实快照保持不变，后续修订从事实工作区创建新版本。
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            className="space-y-4"
            id="fact-review-request-changes-form"
            noValidate
            onSubmit={form.handleSubmit(submitValues)}
          >
            <ErrorSummary errors={errors} />
            <FormField<RequestChangesValues, 'comment'>
              description="退回意见不能为空。"
              id="fact-review-request-comment"
              label="退回意见"
              name="comment"
              required
              render={(context) => (
                <textarea
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  aria-required={context['aria-required']}
                  autoFocus
                  className="min-h-32 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
                  disabled={submitting}
                  id={context.inputId}
                />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose render={<Button disabled={submitting} variant="outline" />}>取消</DialogClose>
          <Button
            disabled={submitting}
            form="fact-review-request-changes-form"
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

function FactReviewEmpty({ workspace }: { workspace: FactReviewWorkspace }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4">
      <p className="type-label text-text-muted">事实审核工作台</p>
      <h1 className="type-page-title">暂无事实版本可审核</h1>
      <p className="text-text-secondary">
        {workspace.product.part_number} 尚未产生不可变事实版本。请先在事实工作台保存并提交审核。
      </p>
      <a className="inline-flex rounded-md border border-border-default px-3 py-2 text-sm font-medium" href={`/products/${encodeURIComponent(workspace.product.id)}/facts`}>
        返回事实工作台
      </a>
    </section>
  );
}

function FactReviewSkeleton({ productId }: { productId: string }) {
  const panel = <div className="space-y-3 p-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-12" /><Skeleton className="h-20" /></div>;
  return (
    <article className="min-w-0 space-y-4" aria-busy="true" aria-labelledby="fact-review-loading-title">
      <header className="space-y-2">
        <p className="type-label text-text-muted">事实审核工作台</p>
        <h1 className="type-page-title" id="fact-review-loading-title">正在加载事实审核上下文</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{productId}</p>
      </header>
      <WorkspaceShell
        ariaLabel="正在加载事实审核工作台"
        context={{ label: '审核上下文', content: panel }}
        main={{ label: '不可变事实快照', content: <div className="p-4"><Skeleton className="h-80" /></div> }}
        reference={{ label: '差异与审核历史', content: panel }}
      />
    </article>
  );
}

function FactReviewFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = factReviewErrorKind(error);
  const requestId = error instanceof ProductRequestError ? error.detail?.request_id : undefined;
  const content = {
    'not-found': ['未找到事实审核工作台', '该产品不存在，或已被删除。'],
    forbidden: ['无法访问事实审核工作台', '当前会话没有读取该审核上下文的权限。'],
    generic: ['事实审核工作台加载失败', error instanceof Error ? error.message : '读取审核上下文时发生未知错误。'],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      {requestId && <p className="font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href="/products">返回产品列表</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function FactReviewRefreshFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div>
        <p className="font-medium text-danger">刷新事实审核上下文失败，已保留当前 canonical 结果</p>
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

function StatusBadge({ presentation }: { presentation: { label: string; tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info' } }) {
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

export { FactReviewPage };
export type { FactReviewPageProps };
