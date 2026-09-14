import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { MarkdownEditor, MarkdownPreview } from '@/design-system/editor/markdown-editor';
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
import { Input } from '@/design-system/primitives/input';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs';
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import {
  abandonContentVersion,
  ContentRequestError,
  contentEditorContextErrorKind,
  contentEditorContextQueryOptions,
  contentKeys,
  createContentRevision,
  createManualContentVersion,
  deleteContentDraft,
  submitContentVersion,
  updateContentDraft,
} from './content.api';
import { ContentAiProduction } from './content-ai-production';
import {
  contentDraftFormSchema,
  contentEditorFormSchema,
  editorActionKeys,
  editorFormValues,
  editorMode,
  mapContentEditorError,
  toContentCommand,
  toContentDraftUpdate,
  toContentRevisionCreate,
  type ContentEditorContext,
  type ContentEditorBlockerKind,
  type ContentEditorField,
  type ContentEditorFormValues,
  type EditorFormMode,
  type EditorMutationAction,
} from './content-editor.model';

type ContentEditorPageProps = {
  csrfToken: string | null;
  taskId: string;
};

type ContentEditorConflict = {
  blockerKind: ContentEditorBlockerKind;
  code: string;
  message: string;
  requestId?: string;
};

const fieldIds: Record<ContentEditorField, string> = {
  title: 'content-editor-title-input',
  summary: 'content-editor-summary',
  body_markdown: 'content-editor-body',
  tags_text: 'content-editor-tags',
  change_summary: 'content-editor-change-summary',
};

const textareaClass = 'min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 read-only:bg-muted read-only:text-text-secondary disabled:cursor-not-allowed disabled:bg-muted';

function ContentEditorPage({ csrfToken, taskId }: ContentEditorPageProps) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ContentEditorConflict>();
  const query = contentEditorContextQueryOptions(taskId);
  const context = useQuery({
    ...query,
    enabled: !conflict,
    refetchOnWindowFocus: conflict ? false : query.refetchOnWindowFocus,
  });

  function enterConflict(next: ContentEditorConflict) {
    setConflict(next);
    void queryClient.cancelQueries({
      exact: true,
      queryKey: contentKeys.editorContext(taskId),
    });
  }

  async function reloadContext() {
    const result = await context.refetch();
    if (result.isError || !result.data) {
      throw result.error ?? new Error('重新加载内容编辑器失败');
    }
    return result.data;
  }

  if (!context.data && context.isPending) return <ContentEditorSkeleton taskId={taskId} />;
  if (!context.data && context.error) {
    return <ContentEditorFailure error={context.error} onRetry={() => void context.refetch()} />;
  }
  if (!context.data) return <ContentEditorSkeleton taskId={taskId} />;
  return (
    <div className="space-y-4">
      {context.error && !conflict && (
        <ContentEditorRefreshFailure
          error={context.error}
          onRetry={() => void context.refetch()}
        />
      )}
      <ContentEditorWorkspace
        conflict={conflict}
        context={context.data}
        csrfToken={csrfToken}
        key={context.data.current_content?.id ?? 'no-current-content'}
        onClearConflict={() => setConflict(undefined)}
        onConflict={enterConflict}
        onReload={reloadContext}
        refreshError={context.error}
        reloading={context.isFetching}
        taskId={taskId}
      />
    </div>
  );
}

function ContentEditorWorkspace({
  conflict,
  context,
  csrfToken,
  onClearConflict,
  onConflict,
  onReload,
  refreshError,
  reloading,
  taskId,
}: ContentEditorPageProps & {
  conflict?: ContentEditorConflict;
  context: ContentEditorContext;
  onClearConflict: () => void;
  onConflict: (conflict: ContentEditorConflict) => void;
  onReload: () => Promise<ContentEditorContext>;
  refreshError: unknown;
  reloading: boolean;
}) {
  const queryClient = useQueryClient();
  const initialMode = editorMode(context);
  const [mode, setMode] = useState<EditorFormMode>(initialMode);
  const [baseRevision, setBaseRevision] = useState(context.current_content?.revision ?? 0);
  const [requestId, setRequestId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [saved, setSaved] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTrigger, setSubmitTrigger] = useState<HTMLElement | null>(null);
  const [documentView, setDocumentView] = useState<'document' | 'diff'>('document');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const form = useForm<ContentEditorFormValues>({
    defaultValues: editorFormValues(context.current_content),
    resolver: zodResolver(mode === 'edit' ? contentDraftFormSchema : contentEditorFormSchema),
  });
  const current = context.current_content;
  const isDirty = form.formState.isDirty;
  const bodyValue = useWatch({ control: form.control, name: 'body_markdown' });
  const pendingLabel = '处理中…';
  const createManual = useMutation({
    mutationFn: (values: ContentEditorFormValues) => createManualContentVersion(
      taskId,
      toContentRevisionCreate(values),
      csrfToken,
    ),
  });
  const createRevision = useMutation({
    mutationFn: (values: ContentEditorFormValues) => {
      if (!current) throw new Error('当前没有可修订的内容版本');
      return createContentRevision(current.id, toContentRevisionCreate(values), csrfToken);
    },
  });
  const save = useMutation({
    mutationFn: (values: ContentEditorFormValues) => {
      if (!current) throw new Error('当前没有可保存的内容版本');
      return updateContentDraft(
        current.id,
        toContentDraftUpdate(values, baseRevision),
        csrfToken,
      );
    },
  });
  const submit = useMutation({
    mutationFn: (comment: string) => {
      if (!current) throw new Error('当前没有可提交的内容版本');
      return submitContentVersion(current.id, toContentCommand(baseRevision, comment), csrfToken);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error('当前没有可删除的内容版本');
      await deleteContentDraft(current.id, baseRevision, csrfToken);
    },
  });
  const abandon = useMutation({
    mutationFn: () => {
      if (!current) throw new Error('当前没有可放弃的内容版本');
      return abandonContentVersion(current.id, toContentCommand(baseRevision), csrfToken);
    },
  });
  const pending = createManual.isPending
    || createRevision.isPending
    || save.isPending
    || submit.isPending
    || remove.isPending
    || abandon.isPending;

  useEffect(() => {
    const revision = context.current_content?.revision ?? 0;
    if (conflict || isDirty || revision <= baseRevision) return;
    form.reset(editorFormValues(context.current_content));
    // 只在没有本地修改时接收更高 canonical revision。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRevision(revision);
    setMode(editorMode(context));
    setRequestId(undefined);
    setSaved(false);
  }, [baseRevision, conflict, context, form, isDirty]);

  async function refreshRelated() {
    await Promise.all([
      queryClient.invalidateQueries({ exact: true, queryKey: contentKeys.editorContext(taskId) }),
      queryClient.invalidateQueries({ queryKey: contentKeys.details(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
    ]);
  }

  function resetErrors() {
    form.clearErrors();
    onClearConflict();
    setRequestId(undefined);
    setSaved(false);
  }

  function applyMappedMutationError(mapped: ReturnType<typeof mapContentEditorError>) {
    if (mapped.blockerKind && mapped.code) {
      setRequestId(undefined);
      onConflict({
        blockerKind: mapped.blockerKind,
        code: mapped.code,
        message: mapped.formMessage ?? (
          mapped.blockerKind === 'content-review-pending'
            ? '该任务已有待审核内容版本'
            : '服务端已有更新，请显式重新加载。'
        ),
        requestId: mapped.requestId,
      });
      return;
    }
    for (const [field, message] of Object.entries(mapped.fields)) {
      form.setError(field as ContentEditorField, { type: 'server', message });
    }
    if (mapped.formMessage) {
      form.setError('root.server', { type: 'server', message: mapped.formMessage });
    }
    setRequestId(mapped.requestId);
  }

  function applyMutationError(error: unknown) {
    applyMappedMutationError(mapContentEditorError(error));
  }

  async function createVersion(values: ContentEditorFormValues) {
    resetErrors();
    try {
      const version = mode === 'manual'
        ? await createManual.mutateAsync(values)
        : await createRevision.mutateAsync(values);
      form.reset(editorFormValues(version));
      setAnnouncement(`内容版本 v${version.version} 已创建`);
      await refreshRelated();
    } catch (error) {
      applyMutationError(error);
    }
  }

  async function saveDraft(values: ContentEditorFormValues) {
    resetErrors();
    try {
      const canonical = await save.mutateAsync(values);
      form.reset(editorFormValues(canonical));
      setBaseRevision(canonical.revision);
      setSaved(true);
      setAnnouncement(`内容草稿已保存，Revision ${canonical.revision}`);
      await refreshRelated();
    } catch (error) {
      applyMutationError(error);
    }
  }

  async function submitReview(comment: string) {
    try {
      const canonical = await submit.mutateAsync(comment);
      setSubmitOpen(false);
      setAnnouncement(`内容版本 v${canonical.version} 已提交审核`);
      await refreshRelated();
    } catch (error) {
      const mapped = mapContentEditorError(error);
      if (!mapped.blockerKind) throw error;
      applyMappedMutationError(mapped);
    }
  }

  async function runDestructive(action: 'DELETE' | 'ABANDON') {
    resetErrors();
    try {
      if (action === 'DELETE') await remove.mutateAsync();
      else await abandon.mutateAsync();
      setAnnouncement(action === 'DELETE' ? '内容草稿已删除' : '内容版本已放弃');
      await refreshRelated();
    } catch (error) {
      applyMutationError(error);
    }
  }

  async function reloadCanonical() {
    let canonical: ContentEditorContext;
    try {
      canonical = await onReload();
    } catch {
      setAnnouncement('重新加载失败，当前冲突与本地输入保持不变');
      return;
    }
    form.reset(editorFormValues(canonical.current_content));
    setBaseRevision(canonical.current_content?.revision ?? 0);
    setMode(editorMode(canonical));
    setSubmitOpen(false);
    setRequestId(undefined);
    setSaved(false);
    setAnnouncement(`已重新加载 Revision ${canonical.current_content?.revision ?? 0}`);
    onClearConflict();
  }

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      if (
        conflict
        || mode !== 'edit'
        || !isDirty
        || pending
        || !current?.available_actions.includes('SAVE')
      ) {
        return;
      }
      event.preventDefault();
      void form.handleSubmit(saveDraft)();
    }
    document.addEventListener('keydown', saveShortcut);
    return () => document.removeEventListener('keydown', saveShortcut);
  });

  function openSubmitDialog() {
    setSubmitTrigger(document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
    setSubmitOpen(true);
  }

  const summaryErrors = editorSummaryErrors(form.formState.errors, requestId, mode, conflict);
  const readOnly = mode === 'readonly';
  const actions = resolveStickyActions(
    editorActionKeys(context, mode),
    {
      dirty: isDirty,
      conflicted: Boolean(conflict),
      mode,
      pending,
      pendingLabel,
      onCreate: () => void form.handleSubmit(createVersion)(),
      onDelete: () => void runDestructive('DELETE'),
      onAbandon: () => void runDestructive('ABANDON'),
      onSave: () => void form.handleSubmit(saveDraft)(),
      onStartRevision: () => {
        setMode('revision');
        form.reset(editorFormValues(current));
        setDocumentView('document');
      },
      onSubmit: openSubmitDialog,
    },
  );
  const saveStatus = pending
    ? pendingLabel
    : isDirty
      ? '有未保存修改'
      : saved
        ? `已保存 · Revision ${baseRevision}`
        : readOnly
          ? `只读 · Revision ${baseRevision}`
          : `Revision ${baseRevision}`;

  return (
    <article className="min-w-0 space-y-4 pb-8" aria-labelledby="content-editor-title">
      <header className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-label text-text-muted">Content Editor</p>
            {readOnly && <Badge variant="secondary">只读</Badge>}
            {mode === 'revision' && <Badge variant="warning">新人工修订</Badge>}
            {mode === 'manual' && <Badge variant="info">人工首稿</Badge>}
          </div>
          <h1
            className="break-all font-mono type-page-title"
            id="content-editor-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {context.task.identifier}
          </h1>
          <p className="break-words text-text-secondary">
            {context.product.brand} · {context.product.part_number} · {context.platform.name}
          </p>
        </div>
        <Link className="text-sm font-medium text-primary underline underline-offset-2" params={{ taskId }} to="/content/tasks/$taskId">
          返回任务详情
        </Link>
      </header>

      <ContentAiProduction context={context} csrfToken={csrfToken} taskId={taskId} />

      <FormProvider {...form}>
        <form noValidate onSubmit={(event) => event.preventDefault()}>
          <ErrorSummary className="mb-4" errors={summaryErrors} />
          <WorkspaceShell
            ariaLabel="Content Editor 工作区"
            context={{ label: '上下文', content: <EditorContextPanel context={context} /> }}
            main={{
              label: '内容文档',
              content: (
                <ContentDocumentForm
                  bodyValue={bodyValue}
                  conflict={conflict}
                  documentView={documentView}
                  mode={mode}
                  onDocumentViewChange={setDocumentView}
                  onReload={() => void reloadCanonical()}
                  refreshError={refreshError}
                  reloading={reloading}
                  revision={baseRevision}
                  serverDiff={<ContentDiffView context={context} />}
                />
              ),
            }}
            reference={{ label: '参考', content: <EditorReferencePanel context={context} /> }}
          />
          <StickyActionBar actions={actions} status={<span aria-live="polite">{saveStatus}</span>} />
        </form>
      </FormProvider>

      <p aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</p>
      <DirtyGuard when={isDirty && !readOnly} />
      {submitOpen && current && (
        <SubmitContentDialog
          conflict={conflict}
          finalFocus={() => {
            const trigger = submitTrigger;
            if (
              trigger?.isConnected
              && !trigger.matches(':disabled, [aria-disabled="true"]')
            ) {
              return trigger;
            }
            return headingRef.current;
          }}
          onClose={() => setSubmitOpen(false)}
          onReload={() => void reloadCanonical()}
          onSubmit={submitReview}
          refreshError={refreshError}
          reloading={reloading}
          submitting={submit.isPending}
        />
      )}
    </article>
  );
}

function ContentDocumentForm({
  bodyValue,
  conflict,
  documentView,
  mode,
  onDocumentViewChange,
  onReload,
  refreshError,
  reloading,
  revision,
  serverDiff,
}: {
  bodyValue: string;
  conflict?: ContentEditorConflict;
  documentView: 'document' | 'diff';
  mode: EditorFormMode;
  onDocumentViewChange: (value: 'document' | 'diff') => void;
  onReload: () => void;
  refreshError: unknown;
  reloading: boolean;
  revision: number;
  serverDiff: ReactNode;
}) {
  const readOnly = mode === 'readonly';
  return (
    <div className="space-y-4 p-4">
      {conflict && (
        <ContentEditorConflictNotice
          conflict={conflict}
          id="content-editor-conflict"
          onReload={onReload}
          refreshError={refreshError}
          reloading={reloading}
        />
      )}
      <Tabs onValueChange={(value) => {
        if (value === 'document' || value === 'diff') onDocumentViewChange(value);
      }} value={documentView}>
        <TabsList aria-label="文档视图" variant="line">
          <TabsTrigger value="document">文档</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
        </TabsList>
        <TabsContent className="space-y-4 pt-3" value="document">
          <div className="grid gap-4 lg:grid-cols-2">
            <FormField<ContentEditorFormValues, 'title'>
              id={fieldIds.title}
              label="标题"
              name="title"
              required
              render={(field) => (
                <Input {...field.field} aria-describedby={field['aria-describedby']} aria-invalid={field['aria-invalid']} id={field.inputId} readOnly={readOnly} />
              )}
            />
            <FormField<ContentEditorFormValues, 'tags_text'>
              description="每行一个标签；逗号会保留在标签内容中。"
              id={fieldIds.tags_text}
              label="标签"
              name="tags_text"
              required
              render={(field) => (
                <textarea {...field.field} aria-describedby={field['aria-describedby']} aria-invalid={field['aria-invalid']} className={textareaClass} id={field.inputId} readOnly={readOnly} rows={3} />
              )}
            />
          </div>
          <FormField<ContentEditorFormValues, 'summary'>
            id={fieldIds.summary}
            label="摘要"
            name="summary"
            required
            render={(field) => (
              <textarea {...field.field} aria-describedby={field['aria-describedby']} aria-invalid={field['aria-invalid']} className={textareaClass} id={field.inputId} readOnly={readOnly} />
            )}
          />
          {(mode === 'manual' || mode === 'revision') && (
            <FormField<ContentEditorFormValues, 'change_summary'>
              description="只写入新版本；原地保存不会发送此字段。"
              id={fieldIds.change_summary}
              label="变更说明"
              name="change_summary"
              required
              render={(field) => (
                <textarea {...field.field} aria-describedby={field['aria-describedby']} aria-invalid={field['aria-invalid']} className={textareaClass} id={field.inputId} />
              )}
            />
          )}
          <FormField<ContentEditorFormValues, 'body_markdown'>
            id={fieldIds.body_markdown}
            label="Markdown 正文"
            name="body_markdown"
            required
            render={(field) => (
              readOnly ? (
                <MarkdownEditor ariaLabel="内容 Markdown" readOnly revision={revision} value={field.field.value} />
              ) : (
                <MarkdownEditor
                  aria-describedby={field['aria-describedby']}
                  aria-invalid={field['aria-invalid']}
                  ariaLabel="内容 Markdown"
                  dirty={field.fieldState.isDirty}
                  id={field.inputId}
                  onChange={field.field.onChange}
                  revision={revision}
                  value={field.field.value}
                />
              )
            )}
          />
        </TabsContent>
        <TabsContent className="pt-3" value="diff">{serverDiff}</TabsContent>
      </Tabs>
      <span className="sr-only">当前正文 {bodyValue.length} 字符</span>
    </div>
  );
}

function EditorContextPanel({ context }: { context: ContentEditorContext }) {
  return (
    <div className="space-y-5 p-4 text-sm">
      <PanelSection title="Product">
        <p className="font-medium">{context.product.brand} · {context.product.part_number}</p>
        <p className="text-text-muted">{context.product.category} · {context.product.status}</p>
      </PanelSection>
      <PanelSection title="Platform">
        <p>{context.platform.name}</p>
        {context.platform.website_url && <p className="break-all text-text-muted">{context.platform.website_url}</p>}
      </PanelSection>
      <PanelSection title="Locked FactVersion">
        <p>v{context.locked_fact_version.version} · {context.locked_fact_version.status}</p>
        <p className="text-text-muted">分级：{context.locked_fact_version.classification}</p>
      </PanelSection>
      <PanelSection title="Task">
        <p>{context.task.workflow_stage}</p>
        <code className="break-all text-xs text-text-muted">{context.task.primary_task}</code>
      </PanelSection>
      {context.source && (
        <PanelSection title="Source">
          <p>{context.source.query_topic?.canonical_question ?? '无 Query Topic'}</p>
          {context.source.geo_optimization && <p className="text-text-muted">{context.source.geo_optimization.rule_code}</p>}
          {context.source.published_content_issue && <p className="text-text-muted">{context.source.published_content_issue.kind}</p>}
        </PanelSection>
      )}
    </div>
  );
}

function EditorReferencePanel({ context }: { context: ContentEditorContext }) {
  const content = context.current_content;
  return (
    <div className="space-y-5 p-4 text-sm">
      <PanelSection title="Immutable Fact Markdown">
        <MarkdownPreview className="max-h-72 min-h-32 p-0" value={context.locked_fact_version.body_markdown} />
      </PanelSection>
      <PanelSection title="Quality Issues">
        {content?.quality_issues.length ? (
          <ul className="space-y-2">
            {content.quality_issues.map((issue) => (
              <li className="rounded-lg border border-border-subtle p-2" key={`${issue.code}-${issue.message}`}>
                <Badge variant={issue.severity === 'BLOCKING' ? 'destructive' : 'warning'}>{issue.severity}</Badge>
                <p className="mt-1">{issue.message}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyValue>暂无质量问题</EmptyValue>}
      </PanelSection>
      <PanelSection title="Generation / Lineage">
        {context.latest_generation ? (
          <p>{context.latest_generation.job_type} · {context.latest_generation.status}</p>
        ) : <EmptyValue>无生成作业</EmptyValue>}
        {context.current_lineage ? (
          <div className="mt-2 space-y-1 text-text-muted">
            <p>模型：{context.current_lineage.generation.model.display_name ?? context.current_lineage.generation.model.model_id ?? '历史快照未记录'}</p>
            <p>Prompt：{context.current_lineage.generation.platform_prompt?.name ?? '历史快照未记录'}</p>
            <p>自然化次数：{context.current_lineage.humanizations.length}</p>
          </div>
        ) : null}
      </PanelSection>
      <PanelSection title="Server Diff"><ContentDiffView context={context} compact /></PanelSection>
    </div>
  );
}

function ContentDiffView({ compact = false, context }: { compact?: boolean; context: ContentEditorContext }) {
  if (!context.current_content || !context.comparison_content || !context.diff) {
    return <EmptyValue>暂无可比较版本</EmptyValue>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        v{context.comparison_content.version} → v{context.current_content.version} · 已保存版本差异
      </p>
      <pre className={compact ? 'max-h-64 overflow-auto rounded-lg bg-surface-raised p-2 text-xs' : 'max-h-[36rem] overflow-auto rounded-lg bg-surface-raised p-3 text-xs'}>
        {context.diff.lines.map((line, index) => (
          <span className={line.kind === 'ADD' ? 'text-success' : line.kind === 'DELETE' ? 'text-danger' : 'text-text-secondary'} key={`${line.kind}-${line.old_line}-${line.new_line}-${index}`}>
            {line.kind === 'ADD' ? '+' : line.kind === 'DELETE' ? '-' : ' '}{line.text}{'\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}

function resolveStickyActions(
  keys: EditorMutationAction[],
  options: {
    conflicted: boolean;
    dirty: boolean;
    mode: EditorFormMode;
    pending: boolean;
    pendingLabel: string;
    onCreate: () => void;
    onDelete: () => void;
    onAbandon: () => void;
    onSave: () => void;
    onStartRevision: () => void;
    onSubmit: () => void;
  },
): StickyAction[] {
  const blocked = options.pending || options.conflicted;
  const blockedReason = options.conflicted
    ? '存在待处理的服务端状态，请先重新加载最新版本'
    : '内容请求正在处理';
  return keys.map((key): StickyAction => {
    switch (key) {
      case 'CREATE_MANUAL_VERSION':
        return {
          key,
          label: options.pending ? options.pendingLabel : '创建人工首稿',
          intent: 'primary',
          enabled: !blocked,
          disabledReason: blockedReason,
          onSelect: options.onCreate,
        };
      case 'CREATE_REVISION':
        return {
          key,
          label: options.mode === 'revision' ? (options.pending ? options.pendingLabel : '创建人工修订') : '创建人工修订',
          intent: 'primary',
          enabled: !blocked,
          disabledReason: blockedReason,
          onSelect: options.mode === 'revision' ? options.onCreate : options.onStartRevision,
        };
      case 'SAVE':
        return {
          key,
          label: options.pending ? options.pendingLabel : '保存草稿',
          intent: 'secondary',
          enabled: options.dirty && !blocked,
          disabledReason: blocked
            ? blockedReason
            : '当前没有未保存修改',
          onSelect: options.onSave,
        };
      case 'SUBMIT_REVIEW':
        return {
          key,
          label: options.pending ? options.pendingLabel : '提交审核',
          intent: 'primary',
          enabled: !options.dirty && !blocked,
          disabledReason: blocked ? blockedReason : '请先保存修改',
          onSelect: options.onSubmit,
        };
      case 'DELETE':
        return {
          key,
          label: '删除草稿',
          intent: 'danger',
          enabled: !blocked,
          disabledReason: blockedReason,
          confirmation: {
            title: '删除当前人工草稿？',
            description: '这是符合服务端资格的物理删除。删除后的主线由服务端决定，且无法撤销。',
            confirmLabel: '确认删除草稿',
            intent: 'destructive',
          },
          onSelect: options.onDelete,
        };
      case 'ABANDON':
        return {
          key,
          label: '放弃当前版本',
          intent: 'danger',
          enabled: !blocked,
          disabledReason: blockedReason,
          confirmation: {
            title: '放弃当前内容版本？',
            description: '放弃不会物理删除历史；新的当前主线只采用服务端返回结果。',
            confirmLabel: '确认放弃',
            intent: 'destructive',
          },
          onSelect: options.onAbandon,
        };
      default:
        return assertNever(key);
    }
  });
}

function SubmitContentDialog({
  conflict,
  finalFocus,
  onClose,
  onReload,
  onSubmit,
  refreshError,
  reloading,
  submitting,
}: {
  conflict?: ContentEditorConflict;
  finalFocus: () => HTMLElement | null;
  onClose: () => void;
  onReload: () => void;
  onSubmit: (comment: string) => Promise<void>;
  refreshError: unknown;
  reloading: boolean;
  submitting: boolean;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  async function submit() {
    setError(undefined);
    try {
      await onSubmit(comment);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交内容审核失败');
    }
  }
  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>提交内容审核</DialogTitle>
          <DialogDescription>只提交已保存的 canonical revision；提交后当前版本变为只读。</DialogDescription>
        </DialogHeader>
        {conflict && (
          <ContentEditorConflictNotice
            conflict={conflict}
            id="content-submit-conflict"
            onReload={onReload}
            refreshError={refreshError}
            reloading={reloading}
          />
        )}
        {error && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">{error}</p>}
        <label className="space-y-1.5 text-sm" htmlFor="content-submit-comment">
          <span className="type-label block">备注（可选）</span>
          <textarea
            aria-describedby={conflict ? 'content-submit-conflict' : undefined}
            autoFocus
            className={textareaClass}
            disabled={submitting}
            id="content-submit-comment"
            onChange={(event) => setComment(event.target.value)}
            value={comment}
          />
        </label>
        <DialogFooter>
          <DialogClose render={<Button disabled={submitting} variant="outline" />}>取消</DialogClose>
          <Button disabled={submitting || Boolean(conflict)} onClick={() => void submit()} type="button">{submitting ? '提交中…' : '确认提交审核'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function editorSummaryErrors(
  errors: ReturnType<typeof useForm<ContentEditorFormValues>>['formState']['errors'],
  requestId: string | undefined,
  mode: EditorFormMode,
  conflict?: ContentEditorConflict,
): ErrorSummaryItem[] {
  const fields = (Object.keys(fieldIds) as ContentEditorField[]).filter(
    (field) => field !== 'change_summary' || mode === 'manual' || mode === 'revision',
  );
  const items: ErrorSummaryItem[] = fields.flatMap((field) => {
    const message = errors[field]?.message;
    return typeof message === 'string'
      ? [{ id: field, fieldId: fieldIds[field], message }]
      : [];
  });
  const formMessage = errors.root?.server?.message;
  if (formMessage) items.push({ id: 'form', message: String(formMessage) });
  if (conflict) {
    items.push({ id: 'conflict-code', message: `错误代码：${conflict.code}` });
    items.push({ id: 'conflict-message', message: conflict.message });
    if (conflict.requestId) {
      items.push({ id: 'conflict-request-id', message: `请求 ID：${conflict.requestId}` });
    }
  }
  if (requestId) items.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  return items;
}

function ContentEditorConflictNotice({
  conflict,
  id,
  onReload,
  refreshError,
  reloading,
}: {
  conflict: ContentEditorConflict;
  id: string;
  onReload: () => void;
  refreshError: unknown;
  reloading: boolean;
}) {
  const reloadFailure = refreshError ? contentEditorRequestFailure(refreshError) : undefined;
  return (
    <section
      aria-atomic="true"
      className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm"
      id={id}
      role="alert"
    >
      <div className="space-y-1">
        <p className="font-medium text-danger">
          {conflict.blockerKind === 'content-review-pending'
            ? '提交审核暂不可用'
            : '检测到 revision 冲突'}
        </p>
        <p className="font-mono text-xs text-text-secondary">错误代码：{conflict.code}</p>
        <p className="text-text-secondary">{conflict.message}</p>
        {conflict.requestId && (
          <p className="font-mono text-xs text-text-muted">请求 ID：{conflict.requestId}</p>
        )}
      </div>
      {reloadFailure && (
        <div className="space-y-1 border-t border-danger/20 pt-2">
          <p className="font-medium text-danger">重新加载失败</p>
          {reloadFailure.code && (
            <p className="font-mono text-xs text-text-secondary">错误代码：{reloadFailure.code}</p>
          )}
          <p className="text-text-secondary">{reloadFailure.message}</p>
          {reloadFailure.requestId && (
            <p className="font-mono text-xs text-text-muted">请求 ID：{reloadFailure.requestId}</p>
          )}
        </div>
      )}
      <Button disabled={reloading} onClick={onReload} size="sm" type="button" variant="outline">
        {reloading ? '重新加载中…' : '重新加载最新版本'}
      </Button>
    </section>
  );
}

function ContentEditorRefreshFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const failure = contentEditorRequestFailure(error);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm" role="alert">
      <div className="space-y-1">
        <p>后台刷新失败，当前表单和已加载快照保持不变。</p>
        {failure.code && <p className="font-mono text-xs">错误代码：{failure.code}</p>}
        <p className="text-text-secondary">{failure.message}</p>
        {failure.requestId && <p className="font-mono text-xs text-text-muted">请求 ID：{failure.requestId}</p>}
      </div>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button>
    </div>
  );
}

function contentEditorRequestFailure(error: unknown) {
  if (error instanceof ContentRequestError && error.detail) {
    return {
      code: error.detail.code,
      message: error.detail.message,
      requestId: error.detail.request_id,
    };
  }
  return {
    message: error instanceof Error ? error.message : '重新加载内容编辑器失败',
  };
}

function PanelSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="space-y-2"><h2 className="type-section-title">{title}</h2>{children}</section>;
}

function EmptyValue({ children = '暂无' }: { children?: ReactNode }) {
  return <p className="text-text-muted">{children}</p>;
}

function ContentEditorSkeleton({ taskId }: { taskId: string }) {
  const panel = <div className="space-y-3 p-4"><Skeleton className="h-5 w-24" /><Skeleton className="h-16" /><Skeleton className="h-24" /></div>;
  return (
    <article aria-busy="true" className="space-y-4" aria-labelledby="content-editor-loading">
      <h1 className="type-page-title" id="content-editor-loading">正在加载 Content Editor</h1>
      <p className="break-all font-mono text-sm text-text-muted">{taskId}</p>
      <WorkspaceShell ariaLabel="正在加载 Content Editor" context={{ label: '上下文', content: panel }} main={{ label: '内容文档', content: panel }} reference={{ label: '参考', content: panel }} />
    </article>
  );
}

function ContentEditorFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = contentEditorContextErrorKind(error);
  const copy = {
    'not-found': ['未找到内容任务', '该任务不存在或已删除。'],
    forbidden: ['无法访问 Content Editor', '当前会话没有读取该内容任务的权限。'],
    generic: ['Content Editor 加载失败', error instanceof Error ? error.message : '读取编辑器时发生未知错误。'],
  }[kind];
  const requestId = error instanceof ContentRequestError ? error.detail?.request_id : undefined;
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{copy[0]}</h1>
      <p className="text-text-secondary">{copy[1]}</p>
      {requestId && <p className="font-mono text-xs text-text-muted">请求 ID：{requestId}</p>}
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href="/content/tasks">返回内容任务</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Content Editor 收到未知动作：${String(value)}`);
}

export { ContentEditorPage };
export type { ContentEditorPageProps };
