import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { MarkdownEditor } from '@/design-system/editor/markdown-editor';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import type { components } from '@/shared/api/generated/schema';
import {
  productFactsQueryOptions,
  ProductRequestError,
  productsKeys,
  replaceProductFacts,
  submitProductFactReview,
} from './product.api';
import {
  factReviewSubmissionSchema,
  factWorkspaceErrorKind,
  factWorkspaceFormSchema,
  factWorkspaceValues,
  mapFactReviewError,
  mapFactWorkspaceError,
  resolveFactWorkspaceActions,
  toFactReviewSubmission,
  toFactWorkspaceUpdate,
  type FactReviewSubmissionValues,
  type FactWorkspace,
  type FactWorkspaceField,
  type FactWorkspaceFormValues,
} from './fact-workspace.model';
import {
  confidentialityRegistry,
  productFactStatusRegistry,
  productStatusRegistry,
  productWorkflowStageRegistry,
} from './product.model';

type FactVersion = components['schemas']['FactVersion'];

type PendingBlocker = {
  message: string;
  requestId: string;
};

type FactWorkspacePageProps = {
  csrfToken: string | null;
  productId: string;
};

const fieldIds: Record<FactWorkspaceField, string> = {
  body_markdown: 'fact-workspace-body',
  classification: 'fact-workspace-classification',
};

const classificationItems = [
  { value: 'PUBLIC', label: confidentialityRegistry.PUBLIC },
  { value: 'INTERNAL', label: confidentialityRegistry.INTERNAL },
  { value: 'RESTRICTED', label: confidentialityRegistry.RESTRICTED },
] as const;

function FactWorkspacePage({ csrfToken, productId }: FactWorkspacePageProps) {
  const facts = useQuery(productFactsQueryOptions(productId));
  if (!facts.data && facts.isPending) return <FactWorkspaceSkeleton productId={productId} />;
  if (!facts.data && facts.error) {
    return <FactWorkspaceFailure error={facts.error} onRetry={() => void facts.refetch()} />;
  }
  if (!facts.data) return <FactWorkspaceSkeleton productId={productId} />;
  return (
    <div className="space-y-4">
      {facts.error && (
        <FactWorkspaceRefreshFailure error={facts.error} onRetry={() => void facts.refetch()} />
      )}
      <FactWorkspaceEditor
        csrfToken={csrfToken}
        onReload={async () => {
          const result = await facts.refetch();
          return result.isSuccess ? result.data : undefined;
        }}
        productId={productId}
        workspace={facts.data}
      />
    </div>
  );
}

function FactWorkspaceEditor({
  csrfToken,
  onReload,
  productId,
  workspace,
}: FactWorkspacePageProps & {
  onReload: () => Promise<FactWorkspace | undefined>;
  workspace: FactWorkspace;
}) {
  const queryClient = useQueryClient();
  const [baseRevision, setBaseRevision] = useState(workspace.revision);
  const [conflict, setConflict] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [saved, setSaved] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pendingBlocker, setPendingBlocker] = useState<PendingBlocker>();
  const form = useForm<FactWorkspaceFormValues>({
    defaultValues: factWorkspaceValues(workspace),
    resolver: zodResolver(factWorkspaceFormSchema),
  });
  const save = useMutation({
    mutationFn: async (values: FactWorkspaceFormValues) => {
      await queryClient.cancelQueries({ exact: true, queryKey: productsKeys.fact(productId) });
      return replaceProductFacts(
        productId,
        toFactWorkspaceUpdate(values, baseRevision),
        csrfToken,
      );
    },
  });
  const submit = useMutation({
    mutationFn: async (values: FactReviewSubmissionValues) => {
      await queryClient.cancelQueries({ exact: true, queryKey: productsKeys.fact(productId) });
      return submitProductFactReview(
        productId,
        toFactReviewSubmission(values, baseRevision),
        csrfToken,
      );
    },
  });
  const isDirty = form.formState.isDirty;
  const bodyValue = useWatch({ control: form.control, name: 'body_markdown' });
  const readOnly = !workspace.available_actions.includes('SAVE');

  useEffect(() => {
    // 路由复用时按产品身份清理临时 blocker，避免一个产品的错误污染另一个产品。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingBlocker(undefined);
  }, [productId]);

  useEffect(() => {
    if (isDirty || workspace.revision <= baseRevision) return;
    form.reset(factWorkspaceValues(workspace));
    // 仅在无本地修改时接收更高 revision 的查询快照，避免后台刷新覆盖编辑内容。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRevision(workspace.revision);
    setConflict(undefined);
    setRequestId(undefined);
    setSaved(false);
  }, [baseRevision, form, isDirty, workspace]);

  async function refreshRelatedQueries(canonical: FactWorkspace) {
    queryClient.setQueryData(productsKeys.fact(productId), canonical);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productsKeys.lists(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: productsKeys.details(), refetchType: 'none' }),
    ]);
  }

  async function saveWorkspace(values: FactWorkspaceFormValues) {
    form.clearErrors();
    setConflict(undefined);
    setRequestId(undefined);
    setSaved(false);
    try {
      const canonical = await save.mutateAsync(values);
      await refreshRelatedQueries(canonical);
      form.reset(factWorkspaceValues(canonical));
      setBaseRevision(canonical.revision);
      setSaved(true);
      setAnnouncement(`事实工作区已保存，Revision ${canonical.revision}`);
    } catch (error) {
      const mapped = mapFactWorkspaceError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FactWorkspaceField, { type: 'server', message });
      }
      if (mapped.formMessage) form.setError('root.server', { type: 'server', message: mapped.formMessage });
      setRequestId(mapped.requestId);
      if (mapped.recovery === 'REVISION_CONFLICT') setConflict(mapped.formMessage ?? '服务端已有更新。');
      if (mapped.recovery === 'INVALID_STATE_TRANSITION') await onReload();
    }
  }

  async function submitReview(values: FactReviewSubmissionValues): Promise<FactVersion> {
    if (pendingBlocker) {
      throw new Error('该产品已有待审核事实版本');
    }
    try {
      const version = await submit.mutateAsync(values);
      setAnnouncement(`事实版本 v${version.version} 已提交审核`);
      setSubmitOpen(false);
      await queryClient.invalidateQueries({ queryKey: productsKeys.fact(productId) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsKeys.lists(), refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: productsKeys.details(), refetchType: 'none' }),
      ]);
      return version;
    } catch (error) {
      const mapped = mapFactReviewError(error);
      if (mapped.recovery === 'REVISION_CONFLICT') {
        setConflict(mapped.formMessage ?? '服务端已有更新。');
        setRequestId(mapped.requestId);
      }
      if (mapped.recovery === 'FACT_REVIEW_PENDING' && mapped.requestId) {
        setPendingBlocker({
          message: mapped.formMessage ?? '该产品已有待审核事实版本',
          requestId: mapped.requestId,
        });
        setRequestId(mapped.requestId);
        const canonical = await onReload();
        if (canonical) {
          // GET 期间用户仍可编辑；成功的 canonical 只更新基线和服务端动作，不能覆盖新草稿。
          const hasLocalChanges = form.formState.isDirty;
          if (!hasLocalChanges) {
            form.reset(factWorkspaceValues(canonical));
            setBaseRevision(canonical.revision);
          }
          setConflict(undefined);
          setPendingBlocker(undefined);
          setSaved(false);
        }
      }
      if (mapped.recovery === 'INVALID_STATE_TRANSITION') {
        await onReload();
      }
      throw error;
    }
  }

  async function reloadCanonical() {
    const canonical = await onReload();
    if (!canonical) return;
    form.reset(factWorkspaceValues(canonical));
    setBaseRevision(canonical.revision);
    setConflict(undefined);
    setRequestId(undefined);
    setSaved(false);
    setAnnouncement(`已重新加载 Revision ${canonical.revision}`);
  }

  const summaryErrors: ErrorSummaryItem[] = (Object.keys(fieldIds) as FactWorkspaceField[])
    .flatMap((field) => {
      const message = form.formState.errors[field]?.message;
      return message ? [{ id: field, fieldId: fieldIds[field], message }] : [];
    });
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (pendingBlocker) summaryErrors.push({ id: 'pending-blocker', message: pendingBlocker.message });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });

  const actions = resolveFactWorkspaceActions(workspace, {
    canSave: bodyValue.trim().length > 0,
    dirty: isDirty,
    saving: save.isPending,
    submitting: submit.isPending,
    onSave: () => void form.handleSubmit(saveWorkspace)(),
    blocked: Boolean(pendingBlocker),
    onSubmit: () => {
      if (!pendingBlocker) setSubmitOpen(true);
    },
  });
  const saveAction = actions.find((action) => action.key === 'SAVE');
  const status = conflict
    ? `Revision 冲突 · 本地修改尚未覆盖`
    : save.isPending
      ? '保存中…'
      : isDirty
        ? `有未保存修改 · 基于 Revision ${baseRevision}`
        : saved
          ? `已保存 · Revision ${baseRevision}`
          : announcement
            ? announcement
          : `未修改 · Revision ${baseRevision}`;

  function handleShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (saveAction?.enabled) saveAction.onSelect();
  }

  return (
    <article className="min-w-0 space-y-4" aria-labelledby="fact-workspace-title">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">产品事实工作台</p>
          <h1 className="break-words font-mono type-page-title" id="fact-workspace-title">
            {workspace.product.part_number}
          </h1>
          <p className="break-words text-text-secondary">
            {workspace.product.brand} · {workspace.product.category}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge presentation={productStatusRegistry[workspace.product.status]} />
          <StatusBadge presentation={productWorkflowStageRegistry[workspace.product.workflow_stage]} />
        </div>
      </header>

      <FormProvider {...form}>
        <form className="min-w-0 space-y-4" noValidate onKeyDown={handleShortcut} onSubmit={form.handleSubmit(saveWorkspace)}>
          <ErrorSummary errors={summaryErrors} />
          <WorkspaceShell
            ariaLabel="产品事实工作台"
            context={{ label: '产品上下文', content: <ProductContext workspace={workspace} /> }}
            main={{
              label: '事实 Markdown',
              content: (
                <div className="space-y-4 p-4">
                  <FormField<FactWorkspaceFormValues, 'body_markdown'>
                    description="Markdown 是产品事实的唯一可编辑来源。"
                    id={fieldIds.body_markdown}
                    label="事实 Markdown"
                    name="body_markdown"
                    required
                    render={(context) => (
                      <MarkdownEditor
                        aria-describedby={context['aria-describedby']}
                        aria-invalid={context['aria-invalid']}
                        ariaLabel="事实 Markdown"
                        conflict={conflict ? { message: conflict, onReload: () => void reloadCanonical() } : undefined}
                        id={context.inputId}
                        {...(readOnly
                          ? { readOnly: true as const }
                          : { dirty: isDirty, onChange: context.field.onChange })}
                        revision={baseRevision}
                        value={context.field.value}
                      />
                    )}
                  />
                  {!bodyValue.trim() && !readOnly && (
                    <p className="rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm text-text-secondary">
                      当前尚无事实正文。填写非空 Markdown 后即可保存。
                    </p>
                  )}
                </div>
              ),
            }}
            reference={{
              label: '状态与分级',
              content: (
                <div className="space-y-5 p-4">
                  <FormField<FactWorkspaceFormValues, 'classification'>
                    description="事实快照会冻结当前数据级别。"
                    id={fieldIds.classification}
                    label="数据级别"
                    name="classification"
                    required
                    render={(context) => (
                      <Select
                        disabled={readOnly || save.isPending || submit.isPending}
                        items={classificationItems}
                        onValueChange={(value) => value && context.field.onChange(value)}
                        value={context.field.value}
                      >
                        <SelectTrigger
                          aria-describedby={context['aria-describedby']}
                          aria-invalid={context['aria-invalid']}
                          className="w-full"
                          id={context.inputId}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {classificationItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <dl className="space-y-3 border-t border-border-subtle pt-4 text-sm">
                    <Metadata label="工作区 Revision" mono value={String(baseRevision)} />
                    <Metadata label="工作流阶段" value={productWorkflowStageRegistry[workspace.product.workflow_stage].label} />
                    <Metadata label="当前批准" value={<FactVersionSummary fact={workspace.approved_fact} />} />
                    <Metadata label="待审核或待修订" value={<FactVersionSummary fact={workspace.pending_fact} />} />
                  </dl>
                </div>
              ),
            }}
          />
          <StickyActionBar actions={actions} status={<span aria-live="polite">{status}</span>} />
        </form>
      </FormProvider>

      <p aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</p>
      <DirtyGuard when={isDirty} />
      {submitOpen && (
        <SubmitReviewDialog
          key={productId}
          pendingBlocker={pendingBlocker}
          onClose={() => setSubmitOpen(false)}
          onSubmit={submitReview}
          submitting={submit.isPending}
        />
      )}
    </article>
  );
}

function ProductContext({ workspace }: { workspace: FactWorkspace }) {
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
        <Metadata label="产品状态" value={productStatusRegistry[workspace.product.status].label} />
        <Metadata label="当前批准" value={<FactVersionSummary fact={workspace.approved_fact} />} />
        <Metadata label="待审核或待修订" value={<FactVersionSummary fact={workspace.pending_fact} />} />
      </dl>
    </div>
  );
}

function FactVersionSummary({ fact }: { fact: FactWorkspace['approved_fact'] }) {
  if (!fact) return <span className="text-text-muted">暂无</span>;
  const presentation = productFactStatusRegistry[fact.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono">v{fact.version}</span>
      <StatusBadge presentation={presentation} />
    </span>
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

function SubmitReviewDialog({
  onClose,
  onSubmit,
  pendingBlocker,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (values: FactReviewSubmissionValues) => Promise<FactVersion>;
  pendingBlocker?: PendingBlocker;
  submitting: boolean;
}) {
  const [requestId, setRequestId] = useState<string>();
  const [pendingBlocked, setPendingBlocked] = useState(false);
  const form = useForm<FactReviewSubmissionValues>({
    defaultValues: { change_summary: '' },
    resolver: zodResolver(factReviewSubmissionSchema),
  });
  async function submitValues(values: FactReviewSubmissionValues) {
    form.clearErrors();
    setRequestId(undefined);
    try {
      await onSubmit(values);
      form.reset();
    } catch (error) {
      const mapped = mapFactReviewError(error);
      if (mapped.fields.change_summary) {
        form.setError('change_summary', { type: 'server', message: mapped.fields.change_summary });
      }
      if (mapped.formMessage) form.setError('root.server', { type: 'server', message: mapped.formMessage });
      setRequestId(mapped.requestId);
      if (mapped.recovery === 'FACT_REVIEW_PENDING') setPendingBlocked(true);
    }
  }
  const blocked = pendingBlocked || Boolean(pendingBlocker);
  const errors: ErrorSummaryItem[] = [];
  const fieldMessage = form.formState.errors.change_summary?.message;
  if (fieldMessage) errors.push({ id: 'change_summary', fieldId: 'fact-review-change-summary', message: fieldMessage });
  const formMessage = form.formState.errors.root?.server?.message;
  const displayedMessage = formMessage ?? pendingBlocker?.message;
  const displayedRequestId = requestId ?? pendingBlocker?.requestId;
  if (displayedMessage) errors.push({ id: 'form', message: displayedMessage });
  if (displayedRequestId) errors.push({ id: 'request-id', message: `请求 ID：${displayedRequestId}` });

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>提交事实审核</DialogTitle>
          <DialogDescription>
            服务端会从当前已保存工作区创建不可变 PENDING_REVIEW snapshot。提交后仍停留本页面。
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="fact-review-submit-form" noValidate onSubmit={form.handleSubmit(submitValues)}>
            <ErrorSummary errors={errors} />
            <FormField<FactReviewSubmissionValues, 'change_summary'>
              id="fact-review-change-summary"
              label="变更摘要"
              name="change_summary"
              required
              render={(context) => (
                <textarea
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted"
                  disabled={submitting || blocked}
                  id={context.inputId}
                />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose render={<Button disabled={submitting} variant="outline" />}>取消</DialogClose>
          <Button disabled={submitting || blocked} form="fact-review-submit-form" type="submit">
            {submitting ? '提交中…' : '确认提交审核'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FactWorkspaceSkeleton({ productId }: { productId: string }) {
  const panel = <div className="space-y-3 p-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-12" /><Skeleton className="h-20" /></div>;
  return (
    <article className="min-w-0 space-y-4" aria-busy="true" aria-labelledby="fact-workspace-loading-title">
      <header className="space-y-2">
        <p className="type-label text-text-muted">产品事实工作台</p>
        <h1 className="type-page-title" id="fact-workspace-loading-title">正在加载事实工作台</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{productId}</p>
      </header>
      <WorkspaceShell
        ariaLabel="正在加载产品事实工作台"
        context={{ label: '产品上下文', content: panel }}
        main={{ label: '事实 Markdown', content: <div className="p-4"><Skeleton className="h-80" /></div> }}
        reference={{ label: '状态与分级', content: panel }}
      />
    </article>
  );
}

function FactWorkspaceFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = factWorkspaceErrorKind(error);
  const requestId = error instanceof ProductRequestError ? error.detail?.request_id : undefined;
  const content = {
    'not-found': ['未找到产品事实工作台', '该产品不存在，或已被删除。'],
    forbidden: ['无法访问事实工作台', '当前会话没有读取该事实工作台的权限。'],
    generic: ['事实工作台加载失败', error instanceof Error ? error.message : '读取事实工作台时发生未知错误。'],
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

function FactWorkspaceRefreshFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div>
        <p className="font-medium text-danger">刷新事实工作台失败，已保留当前编辑内容</p>
        <p className="mt-1 text-sm text-text-secondary">{error.message}</p>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">重试刷新</Button>
    </section>
  );
}

export { FactWorkspacePage };
export type { FactWorkspacePageProps };
