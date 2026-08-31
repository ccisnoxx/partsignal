import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FormProvider, useForm, type FieldPath } from 'react-hook-form';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Button, buttonVariants } from '@/design-system/primitives/button';
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
import type { components } from '@/shared/api/generated/schema';
import {
  createPlatformType,
  deletePlatformType,
  invalidatePlatformTypeConsumers,
  PlatformRequestError,
  platformKeys,
  platformTypeListQueryOptions,
  updatePlatformType,
} from './platform.api';
import {
  errorMessage,
  isPlatformTypeRevisionConflict,
  mapPlatformTypeFormError,
  platformTypeBlockerHref,
  platformTypeFormSchema,
  platformTypeFormValues,
  platformTypeOverflowActions,
  toPlatformTypeCreate,
  toPlatformTypeUpdate,
  type PlatformType,
  type PlatformTypeFormValues,
} from './platform-types.model';

type EditorTarget = { platformType?: PlatformType; focusReturn: HTMLElement | null };
type DeletionIntent = {
  id: string;
  command: 'delete-platform-type' | 'view-platform-type-delete-conditions';
  focusReturn: HTMLElement | null;
};
type PlatformTypeList = components['schemas']['PlatformTypeList'];

type PlatformTypesPageProps = {
  csrfToken: string | null;
};

function PlatformTypesPage({ csrfToken }: PlatformTypesPageProps) {
  const queryClient = useQueryClient();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const types = useQuery(platformTypeListQueryOptions());
  const [editor, setEditor] = useState<EditorTarget>();
  const [deletionIntent, setDeletionIntent] = useState<DeletionIntent>();
  const rows = types.data?.items ?? [];

  function handleCommand(
    command: string,
    platformType: PlatformType,
    focusReturn?: HTMLElement | null,
  ) {
    const target = { platformType, focusReturn: focusReturn ?? null };
    if (command === 'edit-platform-type') {
      setEditor(target);
      return;
    }
    if (command === 'view-platform-type-delete-conditions') {
      setDeletionIntent({ id: platformType.id, command, focusReturn: target.focusReturn });
      return;
    }
    if (command === 'delete-platform-type') {
      setDeletionIntent({ id: platformType.id, command, focusReturn: target.focusReturn });
      return;
    }
    throw new Error(`Platform Type Settings 收到未知页面命令：${command}`);
  }

  async function reloadCanonical(platformTypeId: string) {
    const result = await types.refetch();
    if (result.error) throw result.error;
    const current = result.data?.items.find((item) => item.id === platformTypeId);
    if (!current) throw new Error('该平台类型已不存在');
    return current;
  }

  async function saved() {
    await invalidatePlatformTypeConsumers(queryClient);
  }

  useEffect(() => {
    if (deletionIntent && types.data && !types.data.items.some((item) => item.id === deletionIntent.id)) {
      // 当前活动列表已确认目标消失，删除意图不能跨缓存复活。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeletionIntent(undefined);
    }
  }, [deletionIntent, types.data]);

  return (
    <section aria-labelledby="platform-types-title" className="min-w-0 space-y-4">
      <a
        className="inline-flex min-h-8 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="/settings/platforms?page=1&pageSize=20"
      >
        返回平台与账号
      </a>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="type-page-title" id="platform-types-title">平台类型</h1>
          <p className="max-w-3xl text-text-secondary">
            管理平台与账号使用的分类；平台数量与可用操作均由服务端提供。
          </p>
        </div>
        <Button
          onClick={() => setEditor({ focusReturn: createButtonRef.current })}
          ref={createButtonRef}
          type="button"
        >
          新建平台类型
        </Button>
      </header>

      {types.data && types.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前列表：${errorMessage(types.error)}`}
          onAction={() => void types.refetch()}
        />
      )}

      <div className="hidden sm:block">
        <TableShell regionLabel="平台类型列表">
          <thead>
            <tr>
              <th data-column-role="primary" scope="col">名称</th>
              <th data-column-role="metadata" scope="col">Slug</th>
              <th data-column-role="numeric" scope="col">平台数量</th>
              <th data-column-role="actions" scope="col">操作</th>
            </tr>
          </thead>
          {types.isPending ? (
            <TableSkeleton columnRoles={['primary', 'metadata', 'numeric', 'actions']} />
          ) : types.error && !types.data ? (
            <EmptyTable
              action={<Button onClick={() => void types.refetch()} variant="outline">重试</Button>}
              colSpan={4}
              description={errorMessage(types.error)}
              kind="error"
              title="平台类型列表加载失败"
            />
          ) : rows.length === 0 ? (
            <EmptyTable
              colSpan={4}
              description="当前还没有平台类型。"
              kind="empty"
              title="暂无平台类型"
            />
          ) : (
            <tbody>
              {rows.map((platformType) => (
                <tr key={platformType.id}>
                  <td className="break-words font-medium" data-column-role="primary">
                    {platformType.name}
                  </td>
                  <td className="break-all font-mono" data-column-role="metadata">
                    {platformType.slug}
                  </td>
                  <td className="tabular-nums" data-column-role="numeric">
                    {platformType.platform_count}
                  </td>
                  <td data-column-role="actions">
                    <PlatformTypeActions platformType={platformType} onCommand={handleCommand} />
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </TableShell>
      </div>

      <div className="sm:hidden">
        {types.isPending ? (
          <div aria-busy="true" aria-label="正在加载平台类型" className="space-y-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : types.error && !types.data ? (
          <MobileState
            action={<Button onClick={() => void types.refetch()} variant="outline">重试</Button>}
            error
            message={errorMessage(types.error)}
            title="平台类型列表加载失败"
          />
        ) : rows.length === 0 ? (
          <MobileState message="当前还没有平台类型。" title="暂无平台类型" />
        ) : (
          <ul className="space-y-3">
            {rows.map((platformType) => (
              <li className="min-w-0 rounded-lg border border-border-subtle p-3" key={platformType.id}>
                <p className="break-words font-medium text-text-primary">{platformType.name}</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-text-muted">Slug</dt>
                  <dd className="min-w-0 break-all text-right font-mono">{platformType.slug}</dd>
                  <dt className="text-text-muted">平台数量</dt>
                  <dd className="text-right tabular-nums">{platformType.platform_count}</dd>
                </dl>
                <div className="mt-3 border-t border-border-subtle pt-2">
                  <PlatformTypeActions platformType={platformType} onCommand={handleCommand} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editor && (
        <PlatformTypeEditorDialog
          csrfToken={csrfToken}
          onClose={() => setEditor(undefined)}
          onReload={reloadCanonical}
          onSaved={async () => {
            await saved();
            setEditor(undefined);
          }}
          target={editor}
        />
      )}
      <PlatformTypeDeletionDialog
        csrfToken={csrfToken}
        key={deletionIntent?.id ?? 'none'}
        intent={deletionIntent}
        onClose={() => setDeletionIntent(undefined)}
        onDeleted={async () => {
          await saved();
          setDeletionIntent(undefined);
        }}
        onReload={async () => {
          if (!deletionIntent) throw new Error('未找到待删除的平台类型');
          return reloadCanonical(deletionIntent.id);
        }}
        queryClient={queryClient}
        queryError={types.error}
        queryFetching={types.isFetching}
        types={types.data}
      />
    </section>
  );
}

function PlatformTypeActions({
  onCommand,
  platformType,
}: {
  onCommand: (
    command: string,
    platformType: PlatformType,
    focusReturn?: HTMLElement | null,
  ) => void;
  platformType: PlatformType;
}) {
  return (
    <RowActions
      objectLabel={platformType.name}
      onCommand={(command, focusReturn) => onCommand(command, platformType, focusReturn)}
      overflow={platformTypeOverflowActions(platformType)}
    />
  );
}

function PlatformTypeEditorDialog({
  csrfToken,
  onClose,
  onReload,
  onSaved,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onReload: (platformTypeId: string) => Promise<PlatformType>;
  onSaved: () => Promise<void>;
  target: EditorTarget;
}) {
  const [revision, setRevision] = useState(target.platformType?.revision ?? 0);
  const [requestId, setRequestId] = useState<string>();
  const [reloadError, setReloadError] = useState<string>();
  const form = useForm<PlatformTypeFormValues>({
    defaultValues: platformTypeFormValues(target.platformType),
    resolver: zodResolver(platformTypeFormSchema),
  });
  const save = useMutation({
    mutationFn: (values: PlatformTypeFormValues) => target.platformType
      ? updatePlatformType(
        target.platformType.id,
        toPlatformTypeUpdate(values, revision),
        csrfToken,
      )
      : createPlatformType(toPlatformTypeCreate(values), csrfToken),
  });

  async function submit(values: PlatformTypeFormValues) {
    form.clearErrors();
    save.reset();
    setRequestId(undefined);
    try {
      await save.mutateAsync(values);
      await onSaved();
    } catch (error) {
      const mapped = mapPlatformTypeFormError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<PlatformTypeFormValues>, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
    }
  }

  async function reloadCanonical() {
    if (!target.platformType) return;
    setReloadError(undefined);
    try {
      const current = await onReload(target.platformType.id);
      platformTypeOverflowActions(current);
      form.reset(platformTypeFormValues(current));
      setRevision(current.revision);
      form.clearErrors();
      save.reset();
      setRequestId(undefined);
    } catch (error) {
      setReloadError(errorMessage(error));
    }
  }

  const conflict = isPlatformTypeRevisionConflict(save.error);
  const errors = platformTypeFormSummary(form.formState.errors, requestId);
  return (
    <Dialog onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }} open>
      <DialogContent
        className="sm:max-w-md"
        finalFocus={() => target.focusReturn}
        showCloseButton={!save.isPending}
      >
        <DialogHeader>
          <DialogTitle>{target.platformType ? '编辑平台类型' : '新建平台类型'}</DialogTitle>
          <DialogDescription>只维护名称与 Slug；更新使用当前 revision。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="platform-type-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={errors} />
            {conflict && target.platformType && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
                <p>该平台类型已被其他请求修改。当前输入已保留，不会自动重放。</p>
                <Button onClick={() => void reloadCanonical()} type="button" variant="outline">
                  重新读取服务端版本
                </Button>
                {reloadError && <p className="text-sm text-destructive">{reloadError}</p>}
              </div>
            )}
            <FormField<PlatformTypeFormValues, 'name'>
              id="platform-type-name"
              label="Name"
              name="name"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  autoFocus
                  disabled={save.isPending}
                  id={context.inputId}
                />
              )}
            />
            <FormField<PlatformTypeFormValues, 'slug'>
              id="platform-type-slug"
              label="Slug"
              name="slug"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={save.isPending}
                  id={context.inputId}
                  spellCheck={false}
                />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={save.isPending || conflict} form="platform-type-form" type="submit">
            {save.isPending ? '保存中…' : target.platformType ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformTypeDeletionDialog({
  csrfToken,
  intent,
  onClose,
  onDeleted,
  onReload,
  queryClient,
  queryError,
  queryFetching,
  types,
}: {
  csrfToken: string | null;
  intent?: DeletionIntent;
  onClose: () => void;
  onDeleted: () => Promise<void>;
  onReload: () => Promise<PlatformType>;
  queryClient: ReturnType<typeof useQueryClient>;
  queryError: unknown;
  queryFetching: boolean;
  types?: PlatformTypeList;
}) {
  const [reloadMessage, setReloadMessage] = useState<string>();
  const remove = useMutation({
    mutationFn: (variables: { id: string; expectedRevision: number }) => deletePlatformType(variables, csrfToken),
  });
  if (!intent) return null;
  const activeIntent = intent;
  const current = types?.items.find((item) => item.id === activeIntent.id);
  if (!current) return null;
  const blockers = current.deletion?.blockers ?? [];
  const hasDeleteProjection = current.deletion !== null && current.available_actions.includes('DELETE');
  const errorBlockerCount = platformTypeDeleteBlockerCount(remove.error);
  const conflict = remove.error instanceof PlatformRequestError && remove.error.status === 409;
  const stale = Boolean(queryError);
  const canDelete = !queryFetching
    && !stale
    && !conflict
    && hasDeleteProjection
    && blockers.length === 0;

  async function confirm() {
    if (!canDelete) return;
    const exactKey = platformKeys.types();
    const queryState = queryClient.getQueryState(exactKey);
    if (!queryState || queryState.fetchStatus === 'fetching' || queryState.error) return;
    const latest = queryClient.getQueryData<PlatformTypeList>(exactKey)
      ?.items.find((item) => item.id === activeIntent.id);
    if (!latest || queryFetching || queryError) return;
    platformTypeOverflowActions(latest);
    if (latest.deletion === null || !latest.available_actions.includes('DELETE') || latest.deletion.blockers.length > 0) return;
    try {
      await remove.mutateAsync({ id: latest.id, expectedRevision: latest.revision });
      await onDeleted();
    } catch {
      // mutation.error 负责展示结构化错误，Dialog 保持打开。
    }
  }

  async function reloadCanonical() {
    setReloadMessage(undefined);
    try {
      const fresh = await onReload();
      remove.reset();
      setReloadMessage(`已读取 revision ${fresh.revision}，请重新确认。`);
    } catch (error) {
      setReloadMessage(errorMessage(error));
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }} open>
      <DialogContent
        finalFocus={() => activeIntent.focusReturn?.isConnected ? activeIntent.focusReturn : null}
        showCloseButton={!remove.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {blockers.length
              ? '平台类型暂时不能删除'
              : hasDeleteProjection
                ? '删除平台类型？'
                : `“${current.name}”当前不可删除`}
          </DialogTitle>
          <DialogDescription>
            {blockers.length
              ? `“${current.name}”仍被具体平台引用；删除时服务端会再次校验。`
              : hasDeleteProjection
                ? `将删除“${current.name}”。服务端会校验当前 revision 与平台引用。`
                : '服务端当前未提供删除资格，请刷新列表后再试。'}
          </DialogDescription>
        </DialogHeader>
        {(blockers.length > 0 || errorBlockerCount !== undefined) && (
          <a className={buttonVariants({ variant: 'outline' })} href={platformTypeBlockerHref(current.id)}>
            查看引用平台（{blockers[0]?.count ?? errorBlockerCount ?? 0}）
          </a>
        )}
        {queryFetching && <p className="text-sm text-text-secondary" role="status">正在同步平台类型投影…</p>}
        {stale && <p className="text-sm text-destructive" role="alert">当前列表刷新失败，无法确认最新删除资格。</p>}
        {remove.error && <p className="text-sm text-destructive" role="alert">{errorMessage(remove.error)}</p>}
        {conflict && (
          <Button onClick={() => void reloadCanonical()} type="button" variant="outline">
            重新读取服务端版本
          </Button>
        )}
        {reloadMessage && <p className="text-sm text-text-secondary" role="status">{reloadMessage}</p>}
        <DialogFooter>
          <DialogClose disabled={remove.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          {hasDeleteProjection && blockers.length === 0 && <Button disabled={remove.isPending || !canDelete} onClick={() => void confirm()} type="button" variant="destructive">
            {remove.isPending ? '删除中…' : '确认删除'}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function platformTypeDeleteBlockerCount(error: unknown) {
  if (!(error instanceof PlatformRequestError) || error.detail?.code !== 'PLATFORM_TYPE_IN_USE') {
    return undefined;
  }
  const references = error.detail.details.references;
  if (!Array.isArray(references) || references.length !== 1) {
    throw new Error('PLATFORM_TYPE_IN_USE 未返回唯一 PlatformProfile 引用');
  }
  const reference = references[0];
  if (!reference || typeof reference !== 'object') throw new Error('PLATFORM_TYPE_IN_USE 返回了无效引用');
  const type = 'type' in reference ? reference.type : undefined;
  const count = 'count' in reference ? reference.count : undefined;
  if (type !== 'PLATFORM_PROFILE' || !Number.isInteger(count) || Number(count) <= 0) {
    throw new Error('PLATFORM_TYPE_IN_USE 返回了未知引用');
  }
  return Number(count);
}

function platformTypeFormSummary(
  errors: ReturnType<typeof useForm<PlatformTypeFormValues>>['formState']['errors'],
  requestId?: string,
) {
  const summary: ErrorSummaryItem[] = [];
  if (errors.name?.message) {
    summary.push({ id: 'name', fieldId: 'platform-type-name', message: errors.name.message });
  }
  if (errors.slug?.message) {
    summary.push({ id: 'slug', fieldId: 'platform-type-slug', message: errors.slug.message });
  }
  if (errors.root?.server?.message) {
    summary.push({ id: 'form', message: errors.root.server.message });
  }
  if (requestId) summary.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  return summary;
}

function Notice({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel: string;
  message: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      <span>{message}</span>
      <Button onClick={onAction} size="sm" variant="outline">{actionLabel}</Button>
    </div>
  );
}

function MobileState({
  action,
  error = false,
  message,
  title,
}: {
  action?: ReactNode;
  error?: boolean;
  message: string;
  title: string;
}) {
  return (
    <div
      className="space-y-2 rounded-lg border border-dashed border-border-default p-6 text-center"
      role={error ? 'alert' : 'status'}
    >
      <strong className="block text-text-primary">{title}</strong>
      <p className="text-sm text-text-secondary">{message}</p>
      {action}
    </div>
  );
}

export { PlatformTypesPage };
export type { PlatformTypesPageProps };
