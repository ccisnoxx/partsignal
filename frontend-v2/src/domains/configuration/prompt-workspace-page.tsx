import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { FormProvider, useForm, useWatch, type FieldPath } from 'react-hook-form';

import { MarkdownEditor } from '@/design-system/editor/markdown-editor';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
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
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import type { components } from '@/shared/api/generated/schema';
import {
  createPlatformPrompt,
  deletePlatformPrompt,
  platformPromptDetailQueryOptions,
  platformPromptListQueryOptions,
  promptKeys,
  PromptRequestError,
  updatePlatformPrompt,
} from './prompt.api';
import {
  mapPromptFormError,
  promptDetailErrorKind,
  promptEditorIdentity,
  promptFormSchema,
  promptFormValues,
  resolvePromptActions,
  shouldBlockPromptWorkspaceNavigation,
  toPlatformPromptCreate,
  toPlatformPromptUpdate,
  type PlatformPromptDetail,
  type PromptFormValues,
  type PromptWorkspaceSearch,
} from './prompt-workspace.model';
import { PromptPreview } from './prompt-preview';

type PlatformPromptList = components['schemas']['PlatformPromptList'];
type PlatformPromptListItem = components['schemas']['PlatformPromptListItem'];
type PromptMutationKind = 'create' | 'update' | 'delete';

type PromptWorkspacePageProps = {
  csrfToken: string | null;
  onConsumersChanged: (kind: PromptMutationKind) => Promise<void>;
  onSearchChange: (search: PromptWorkspaceSearch, replace?: boolean) => Promise<void> | void;
  search: PromptWorkspaceSearch;
};

type DeleteTarget = {
  prompt: PlatformPromptDetail;
  focusReturn: HTMLElement | null;
};

function PromptWorkspacePage({
  csrfToken,
  onConsumersChanged,
  onSearchChange,
  search,
}: PromptWorkspacePageProps) {
  const queryClient = useQueryClient();
  const list = useQuery(platformPromptListQueryOptions());
  const promptId = search.new === 1 ? undefined : search.promptId;
  const detail = useQuery(platformPromptDetailQueryOptions(promptId ?? '', Boolean(promptId)));
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [deleteMessage, setDeleteMessage] = useState<string>();
  const [discardedPromptId, setDiscardedPromptId] = useState<string>();
  const remove = useMutation({
    mutationFn: (prompt: PlatformPromptDetail) => deletePlatformPrompt(prompt, csrfToken),
  });
  const normalizedQuery = search.q?.toLocaleLowerCase() ?? '';
  const rows = (list.data?.items ?? []).filter((prompt) => (
    prompt.name.toLocaleLowerCase().includes(normalizedQuery)
  ));
  const editorIdentity = promptEditorIdentity(search);
  const creating = search.new === 1;
  const [editorState, setEditorState] = useState({ dirty: false, identity: editorIdentity });
  const editorDirty = editorState.identity === editorIdentity && editorState.dirty;
  const onEditorDirtyChange = useCallback((dirty: boolean) => {
    setEditorState((current) => (
      current.identity === editorIdentity && current.dirty === dirty
        ? current
        : { dirty, identity: editorIdentity }
    ));
  }, [editorIdentity]);

  async function openDelete() {
    const result = await detail.refetch();
    if (!result.data) return;
    const activeElement = document.activeElement;
    setDeleteMessage(undefined);
    remove.reset();
    setDeleteTarget({
      prompt: result.data,
      focusReturn: deleteButtonRef.current
        ?? (activeElement instanceof HTMLElement ? activeElement : null),
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.prompt);
    } catch {
      // 保留确认上下文和服务端错误；revision 冲突只能显式重新加载后再确认。
      return;
    }
    const deletedId = deleteTarget.prompt.id;
    flushSync(() => setDiscardedPromptId(deletedId));
    queryClient.setQueryData<PlatformPromptList>(promptKeys.list(), (current) => current ? {
      ...current,
      items: current.items.filter((item) => item.id !== deletedId),
    } : current);
    await onSearchChange(search.q ? { q: search.q } : {}, true);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: promptKeys.detail(deletedId),
        refetchType: 'none',
      }),
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() }),
      onConsumersChanged('delete'),
    ]);
    setDeleteTarget(undefined);
    setDiscardedPromptId(undefined);
  }

  async function reloadDeleteTarget() {
    setDeleteMessage(undefined);
    const result = await detail.refetch();
    if (result.error) {
      setDeleteMessage(errorMessage(result.error));
      return;
    }
    if (!result.data) {
      setDeleteMessage('该 Prompt 已不存在。');
      return;
    }
    const prompt = result.data;
    remove.reset();
    setDeleteTarget((current) => current ? { ...current, prompt } : current);
    setDeleteMessage(`已加载 Revision ${prompt.revision}，请重新确认。`);
  }

  const detailActions = detail.data ? resolvePromptActions(detail.data) : undefined;
  return (
    <article aria-labelledby="prompt-workspace-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">业务配置</p>
          <h1 className="type-page-title" id="prompt-workspace-title">Prompt 管理</h1>
          <p className="max-w-3xl text-text-secondary">
            维护平台共用的 Markdown Prompt；绑定关系和可用动作以服务端投影为准。
          </p>
        </div>
        <Button
          onClick={() => void onSearchChange({ ...(search.q ? { q: search.q } : {}), new: 1 })}
          type="button"
        >
          新建 Prompt
        </Button>
      </header>

      {list.data && list.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新 Prompt Library 失败，已保留当前列表：${errorMessage(list.error)}`}
          onAction={() => void list.refetch()}
        />
      )}
      {detail.data && detail.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新 Prompt 详情失败，已保留当前编辑上下文：${errorMessage(detail.error)}`}
          onAction={() => void detail.refetch()}
        />
      )}

      <WorkspaceShell
        ariaLabel="Prompt 管理工作区"
        context={{
          label: 'Prompt Library',
          content: (
            <PromptLibrary
              error={list.data ? undefined : list.error}
              loading={list.isPending}
              onRetry={() => void list.refetch()}
              onSearch={(q) => void onSearchChange({
                ...(q ? { q } : {}),
                ...(creating ? { new: 1 as const } : promptId ? { promptId } : {}),
              }, true)}
              onSelect={(nextPromptId) => void onSearchChange({
                ...(search.q ? { q: search.q } : {}),
                promptId: nextPromptId,
              })}
              query={search.q ?? ''}
              rows={rows}
              selectedId={promptId}
              total={list.data?.items.length ?? 0}
            />
          ),
        }}
        main={{
          label: creating ? '新建 Prompt' : 'Prompt Editor',
          content: (
            <PromptEditorSurface
              creating={creating}
              csrfToken={csrfToken}
              detail={detail}
              editorIdentity={editorIdentity}
              onDirtyChange={onEditorDirtyChange}
              onConsumersChanged={onConsumersChanged}
              onCreated={(canonical) => onSearchChange({
                ...(search.q ? { q: search.q } : {}),
                promptId: canonical.id,
              }, true)}
              promptId={discardedPromptId === promptId ? undefined : promptId}
            />
          ),
        }}
        reference={{
          label: '绑定平台',
          content: (
            <>
              <PromptPreview csrfToken={csrfToken} dirty={editorDirty} prompt={detail.data} />
              <PromptReferencePane
                canDelete={Boolean(detailActions?.canDelete)}
                creating={creating}
                deleteButtonRef={deleteButtonRef}
                error={!detail.data ? detail.error : undefined}
                loading={Boolean(promptId) && detail.isPending}
                onDelete={() => void openDelete()}
                prompt={detail.data}
                selected={Boolean(promptId)}
              />
            </>
          ),
        }}
      />

      <DeletePromptDialog
        error={remove.error}
        message={deleteMessage}
        onClose={() => {
          if (remove.isPending) return;
          setDeleteTarget(undefined);
          setDeleteMessage(undefined);
          remove.reset();
        }}
        onConfirm={() => void confirmDelete()}
        onReload={() => void reloadDeleteTarget()}
        pending={remove.isPending}
        target={deleteTarget}
      />
    </article>
  );
}

function PromptLibrary({
  error,
  loading,
  onRetry,
  onSearch,
  onSelect,
  query,
  rows,
  selectedId,
  total,
}: {
  error: unknown;
  loading: boolean;
  onRetry: () => void;
  onSearch: (query: string) => void;
  onSelect: (promptId: string) => void;
  query: string;
  rows: PlatformPromptListItem[];
  selectedId?: string;
  total: number;
}) {
  return (
    <section className="space-y-4 p-4">
      <div className="space-y-1">
        <h2 className="type-section-title">Prompt Library</h2>
        <p className="text-sm text-text-muted">按名称过滤已加载的完整模板集合。</p>
      </div>
      <Input
        aria-label="搜索 Prompt 名称"
        maxLength={200}
        onChange={(event) => onSearch(event.currentTarget.value)}
        placeholder="搜索名称"
        type="search"
        value={query}
      />
      {loading ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : error ? (
        <Notice actionLabel="重试" message={errorMessage(error)} onAction={onRetry} />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default p-4 text-sm text-text-muted">
          {total === 0 ? '当前还没有 Prompt。' : '没有匹配当前搜索的 Prompt。'}
        </p>
      ) : (
        <ul aria-label="Prompt 列表" className="space-y-2">
          {rows.map((prompt) => (
            <li key={prompt.id}>
              <button
                aria-current={selectedId === prompt.id ? 'true' : undefined}
                className="w-full min-w-0 rounded-lg border border-border-subtle p-3 text-left outline-none hover:bg-surface-raised focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 aria-[current=true]:border-primary aria-[current=true]:bg-primary/5"
                onClick={() => onSelect(prompt.id)}
                type="button"
              >
                <span className="block break-words font-medium text-text-primary">{prompt.name}</span>
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span className="font-mono">Revision {prompt.revision}</span>
                  <span>{prompt.bound_platform_count} 个绑定平台</span>
                  <time dateTime={prompt.updated_at}>{formatTime(prompt.updated_at)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PromptEditorSurface({
  creating,
  csrfToken,
  detail,
  editorIdentity,
  onDirtyChange,
  onConsumersChanged,
  onCreated,
  promptId,
}: {
  creating: boolean;
  csrfToken: string | null;
  detail: UseQueryResult<PlatformPromptDetail, Error>;
  editorIdentity: string;
  onDirtyChange: (dirty: boolean) => void;
  onConsumersChanged: (kind: PromptMutationKind) => Promise<void>;
  onCreated: (prompt: PlatformPromptDetail) => Promise<void> | void;
  promptId?: string;
}) {
  if (creating) {
    return (
      <PromptEditor
        creating
        csrfToken={csrfToken}
        key={editorIdentity}
        onDirtyChange={onDirtyChange}
        onConsumersChanged={onConsumersChanged}
        onCreated={onCreated}
      />
    );
  }
  if (!promptId) return <EditorEmpty />;
  if (!detail.data && detail.isPending) return <EditorSkeleton />;
  if (!detail.data && detail.error) {
    return <PromptDetailFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (!detail.data) return <EditorSkeleton />;
  return (
    <PromptEditor
      csrfToken={csrfToken}
      key={editorIdentity}
      onDirtyChange={onDirtyChange}
      onConsumersChanged={onConsumersChanged}
      onCreated={onCreated}
      onReload={async () => (await detail.refetch()).data}
      prompt={detail.data}
    />
  );
}

function PromptEditor({
  creating = false,
  csrfToken,
  onConsumersChanged,
  onCreated,
  onDirtyChange,
  onReload,
  prompt,
}: {
  creating?: boolean;
  csrfToken: string | null;
  onConsumersChanged: (kind: PromptMutationKind) => Promise<void>;
  onCreated: (prompt: PlatformPromptDetail) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onReload?: () => Promise<PlatformPromptDetail | undefined>;
  prompt?: PlatformPromptDetail;
}) {
  const queryClient = useQueryClient();
  const [baseRevision, setBaseRevision] = useState(prompt?.revision);
  const [conflict, setConflict] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [impact, setImpact] = useState<{
    focusReturn: HTMLElement | null;
    prompt: PlatformPromptDetail;
    values: PromptFormValues;
  }>();
  const form = useForm<PromptFormValues>({
    defaultValues: promptFormValues(prompt),
    mode: 'onChange',
    resolver: zodResolver(promptFormSchema),
  });
  const save = useMutation({
    mutationFn: (values: PromptFormValues) => {
      if (creating) return createPlatformPrompt(toPlatformPromptCreate(values), csrfToken);
      if (!prompt || baseRevision === undefined) throw new Error('Prompt 编辑器缺少 canonical revision');
      return updatePlatformPrompt(
        prompt.id,
        toPlatformPromptUpdate(values, baseRevision),
        csrfToken,
      );
    },
  });
  const markdown = useWatch({ control: form.control, name: 'template_markdown' });
  const isDirty = form.formState.isDirty;
  const actions = prompt ? resolvePromptActions(prompt) : { canDelete: false, canUpdate: true };

  useEffect(() => {
    if (!prompt || isDirty || prompt.revision === baseRevision) return;
    form.reset(promptFormValues(prompt));
    // 只有 clean 表单接收后台 canonical revision，dirty 草稿必须显式 reload。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseRevision(prompt.revision);
  }, [baseRevision, form, isDirty, prompt]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  async function submit(values: PromptFormValues) {
    form.clearErrors();
    setConflict(undefined);
    setRequestId(undefined);
    try {
      if (prompt) {
        await queryClient.cancelQueries({ exact: true, queryKey: promptKeys.detail(prompt.id) });
      }
      const canonical = await save.mutateAsync(values);
      queryClient.setQueryData(promptKeys.detail(canonical.id), canonical);
      flushSync(() => {
        form.reset(promptFormValues(canonical));
        setBaseRevision(canonical.revision);
      });
      await queryClient.invalidateQueries({ queryKey: promptKeys.lists() });
      if (creating) await onCreated(canonical);
      else await onConsumersChanged('update');
    } catch (error) {
      const mapped = mapPromptFormError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<PromptFormValues>, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
      if (mapped.code === 'REVISION_CONFLICT') {
        setConflict(mapped.formMessage ?? '服务端 Prompt 已有更新。');
      }
    }
  }

  async function requestSave(values: PromptFormValues) {
    if (!prompt || !onReload) {
      await submit(values);
      return;
    }
    const result = await onReload();
    if (!result) {
      form.setError('root.server', { type: 'server', message: '无法刷新 Prompt 影响范围，请重试。' });
      return;
    }
    if (result.revision !== baseRevision) {
      const message = `服务端已更新到 Revision ${result.revision}，当前草稿仍基于 Revision ${baseRevision}。`;
      setConflict(message);
      form.setError('root.server', { type: 'server', message });
      return;
    }
    if (result.bound_platforms.length > 0) {
      setImpact({
        focusReturn: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        prompt: result,
        values,
      });
      return;
    }
    await submit(values);
  }

  async function reloadCanonical() {
    if (!onReload) return;
    const canonical = await onReload();
    if (!canonical) return;
    form.reset(promptFormValues(canonical));
    setBaseRevision(canonical.revision);
    setConflict(undefined);
    setRequestId(undefined);
    save.reset();
  }

  const summary: ErrorSummaryItem[] = [];
  if (form.formState.errors.name?.message) {
    summary.push({ id: 'name', fieldId: 'prompt-name', message: form.formState.errors.name.message });
  }
  if (form.formState.errors.template_markdown?.message) {
    summary.push({ id: 'markdown', fieldId: 'prompt-markdown', message: form.formState.errors.template_markdown.message });
  }
  if (form.formState.errors.root?.server?.message) {
    summary.push({ id: 'server', message: form.formState.errors.root.server.message });
  }
  if (requestId) summary.push({ id: 'request', message: `请求 ID：${requestId}` });

  const canSave = actions.canUpdate && isDirty && form.formState.isValid && !save.isPending && !conflict;
  const stickyActions: StickyAction[] = [{
    key: creating ? 'CREATE' : 'UPDATE',
    label: save.isPending ? '保存中…' : creating ? '创建 Prompt' : '保存 Prompt',
    intent: 'primary',
    enabled: canSave,
    disabledReason: !actions.canUpdate
      ? '服务端未提供 UPDATE 动作'
      : conflict
        ? '请先重新加载服务端版本'
        : !isDirty
          ? '当前没有未保存修改'
          : !form.formState.isValid
            ? '请先修正表单错误'
            : '正在保存',
    onSelect: () => void form.handleSubmit(requestSave)(),
  }];
  const status = conflict
    ? 'Revision 冲突 · 本地草稿已保留'
    : save.isPending
      ? '保存中…'
      : isDirty
        ? `有未保存修改${baseRevision === undefined ? '' : ` · 基于 Revision ${baseRevision}`}`
        : baseRevision === undefined
          ? '尚未创建'
          : `未修改 · Revision ${baseRevision}`;

  function handleShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 's') return;
    event.preventDefault();
    if (canSave) void form.handleSubmit(requestSave)();
  }

  return (
    <FormProvider {...form}>
      <form className="min-w-0" noValidate onKeyDown={handleShortcut} onSubmit={form.handleSubmit(requestSave)}>
        <div className="space-y-4 p-4">
          <ErrorSummary errors={summary} />
          <FormField<PromptFormValues, 'name'>
            id="prompt-name"
            label="Prompt 名称"
            name="name"
            required
            render={(context) => (
              <Input
                {...context.field}
                aria-describedby={context['aria-describedby']}
                aria-invalid={context['aria-invalid']}
                disabled={save.isPending || (!creating && !actions.canUpdate)}
                id={context.inputId}
                maxLength={300}
              />
            )}
          />
          <FormField<PromptFormValues, 'template_markdown'>
            description="Markdown 是 Prompt 正文的唯一可编辑来源。"
            id="prompt-markdown"
            label="Prompt Markdown"
            name="template_markdown"
            required
            render={(context) => (
              <MarkdownEditor
                aria-describedby={context['aria-describedby']}
                aria-invalid={context['aria-invalid']}
                ariaLabel="Prompt Markdown"
                conflict={conflict ? { message: conflict, onReload: () => void reloadCanonical() } : undefined}
                id={context.inputId}
                {...(!creating && !actions.canUpdate
                  ? { readOnly: true as const }
                  : { dirty: isDirty, onChange: context.field.onChange })}
                revision={baseRevision}
                value={markdown}
              />
            )}
          />
        </div>
        <StickyActionBar actions={stickyActions} status={<span aria-live="polite">{status}</span>} />
        <DirtyGuard
          shouldBlockNavigation={({ current, next }) => (
            shouldBlockPromptWorkspaceNavigation(current, next)
          )}
          when={isDirty}
        />
      </form>

      <Dialog onOpenChange={(open) => !open && !save.isPending && setImpact(undefined)} open={Boolean(impact)}>
        <DialogContent finalFocus={() => impact?.focusReturn ?? null}>
          <DialogHeader>
            <DialogTitle>保存将影响绑定平台</DialogTitle>
            <DialogDescription>
              以下平台的新生成会使用更新后的 Prompt；历史生成快照和内容版本保持不变。
            </DialogDescription>
          </DialogHeader>
          <BoundPlatformList platforms={impact?.prompt.bound_platforms ?? []} />
          <DialogFooter>
            <DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose>
            <Button
              disabled={save.isPending}
              onClick={() => {
                const values = impact?.values;
                setImpact(undefined);
                if (values) void submit(values);
              }}
              type="button"
            >
              确认保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormProvider>
  );
}

function PromptReferencePane({
  canDelete,
  creating,
  deleteButtonRef,
  error,
  loading,
  onDelete,
  prompt,
  selected,
}: {
  canDelete: boolean;
  creating: boolean;
  deleteButtonRef: RefObject<HTMLButtonElement | null>;
  error: unknown;
  loading: boolean;
  onDelete: () => void;
  prompt?: PlatformPromptDetail;
  selected: boolean;
}) {
  if (creating) {
    return <p className="p-4 text-sm text-text-muted">创建后可查看绑定平台。</p>;
  }
  if (!selected) {
    return <p className="p-4 text-sm text-text-muted">选择 Prompt 后查看当前绑定平台。</p>;
  }
  if (loading) return <div className="space-y-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (!prompt && error) return <p className="p-4 text-sm text-danger" role="alert">{errorMessage(error)}</p>;
  if (!prompt) return null;
  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="type-label text-text-muted">当前绑定</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
          {prompt.bound_platform_count}
        </p>
      </div>
      <BoundPlatformList platforms={prompt.bound_platforms} />
      <div className="rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm text-text-secondary">
        修改或删除只影响当前配置与未来生成；历史生成快照和内容版本保持不可变。
      </div>
      {canDelete && (
        <Button onClick={onDelete} ref={deleteButtonRef} type="button" variant="destructive">
          删除 Prompt
        </Button>
      )}
    </div>
  );
}

function BoundPlatformList({
  platforms,
}: {
  platforms: PlatformPromptDetail['bound_platforms'];
}) {
  if (platforms.length === 0) {
    return <p className="text-sm text-text-muted">当前没有绑定平台。</p>;
  }
  return (
    <ul className="space-y-2">
      {platforms.map((platform) => (
        <li className="rounded-lg border border-border-subtle p-3" key={platform.id}>
          <a
            className="break-words font-medium text-primary underline-offset-4 hover:underline"
            href={`/settings/platforms/${platform.id}?tab=generation`}
          >
            {platform.name}
          </a>
          <p className="mt-1 break-all font-mono text-xs text-text-muted">{platform.slug}</p>
        </li>
      ))}
    </ul>
  );
}

function DeletePromptDialog({
  error,
  message,
  onClose,
  onConfirm,
  onReload,
  pending,
  target,
}: {
  error: unknown;
  message?: string;
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => void;
  pending: boolean;
  target?: DeleteTarget;
}) {
  const conflict = error instanceof PromptRequestError && error.detail?.code === 'REVISION_CONFLICT';
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <DialogContent finalFocus={() => target?.focusReturn ?? null} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>删除 Prompt“{target?.prompt.name}”？</DialogTitle>
          <DialogDescription>
            服务端会原子解除全部当前平台绑定并删除 Prompt；历史生成快照和内容版本不会改变。
          </DialogDescription>
        </DialogHeader>
        <BoundPlatformList platforms={target?.prompt.bound_platforms ?? []} />
        {error ? <p className="text-sm text-danger" role="alert">{errorMessage(error)}</p> : null}
        {conflict && <Button onClick={onReload} type="button" variant="outline">重新加载服务端版本</Button>}
        {message && <p className="text-sm text-text-secondary" role="status">{message}</p>}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={pending || conflict} onClick={onConfirm} type="button" variant="destructive">
            {pending ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorEmpty() {
  return (
    <div className="flex min-h-[32rem] items-center justify-center p-6 text-center text-text-muted">
      从 Prompt Library 选择一项，或新建 Prompt。
    </div>
  );
}

function EditorSkeleton() {
  return <div aria-busy="true" className="space-y-4 p-4"><Skeleton className="h-12" /><Skeleton className="h-80" /></div>;
}

function PromptDetailFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = promptDetailErrorKind(error);
  const content = {
    'not-found': ['未找到 Prompt', 'URL 中的 Prompt 不存在，或已被删除。'],
    forbidden: ['无法访问 Prompt', '当前会话没有读取该 Prompt 的权限。'],
    generic: ['Prompt 详情加载失败', errorMessage(error)],
  }[kind];
  return (
    <section className="space-y-3 p-4" role="alert">
      <h2 className="type-section-title">{content[0]}</h2>
      <p className="text-sm text-text-secondary">{content[1]}</p>
      {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
    </section>
  );
}

function Notice({ actionLabel, message, onAction }: { actionLabel: string; message: string; onAction: () => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <p className="text-sm text-text-primary">{message}</p>
      <Button onClick={onAction} size="sm" type="button" variant="outline">{actionLabel}</Button>
    </section>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误';
}

export { PromptWorkspacePage };
export type { PromptMutationKind, PromptWorkspacePageProps };
