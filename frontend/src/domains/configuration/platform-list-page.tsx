import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { deletePlatformProfile, platformKeys, platformListQueryOptions, runPlatformCommand } from './platform.api';
import {
  deletionBlockerLabel,
  hasPlatformFilters,
  normalizePlatformPageSize,
  platformStatusRegistry,
  platformWorkspaceHref,
  readinessRegistry,
  resolvePlatformOverflowActions,
  resolvePlatformPrimaryAction,
  platformSearchToApiParams,
  type PlatformCommand,
  type PlatformProfile,
  type PlatformProfileList,
  type PlatformSearch,
} from './platform-list.model';

const columnRoles = [
  'primary',
  'metadata',
  'status',
  'numeric',
  'status',
  'date',
  'actions',
] as const satisfies readonly ColumnRole[];

type PlatformListPageProps = {
  canManagePlatformTypes: boolean;
  csrfToken: string | null;
  onPlatformChanged: (kind: 'status' | 'delete', platformId: string) => Promise<void>;
  onSearchChange: (search: PlatformSearch) => Promise<void> | void;
  search: PlatformSearch;
};

type CommandVariables =
  | { command: 'delete-platform'; id: string; expectedRevision: number }
  | { command: Exclude<PlatformCommand, 'delete-platform'>; platform: PlatformProfile };
type DeletionIntent = {
  id: string;
  command: Extract<PlatformCommand, 'delete-platform'> | 'view-delete-conditions';
  focusReturn: HTMLElement | null;
};
type EnableTarget = { platform: PlatformProfile; focusReturn: HTMLElement | null };

function PlatformListPage({
  canManagePlatformTypes,
  csrfToken,
  onPlatformChanged,
  onSearchChange,
  search,
}: PlatformListPageProps) {
  const queryClient = useQueryClient();
  const platforms = useQuery(platformListQueryOptions(search));
  const activeListKey = JSON.stringify(platformSearchToApiParams(search));
  const previousListKey = useRef(activeListKey);
  const [deletionIntent, setDeletionIntent] = useState<DeletionIntent>();
  const [enableTarget, setEnableTarget] = useState<EnableTarget>();
  const rows = platforms.data?.items ?? [];
  const total = platforms.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const filtered = hasPlatformFilters(search);

  useEffect(() => {
    if (previousListKey.current !== activeListKey) {
      previousListKey.current = activeListKey;
      // 搜索、分页或分页大小改变后，旧删除意图不得在新 query key 中复活。
      setDeletionIntent(undefined);
    }
  }, [activeListKey]);

  useEffect(() => {
    if (deletionIntent && platforms.data && !platforms.data.items.some((item) => item.id === deletionIntent.id)) {
      // 当前活动列表已确认目标消失，删除意图不能跨筛选/分页缓存复活。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeletionIntent(undefined);
    }
  }, [deletionIntent, platforms.data]);

  function changeSearch(changes: Partial<PlatformSearch>, resetPage = true) {
    setDeletionIntent(undefined);
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  const mutation = useMutation({
    mutationFn: async (variables: CommandVariables) => {
      if (variables.command === 'delete-platform') {
        await deletePlatformProfile(variables, csrfToken);
        return;
      }
      await runPlatformCommand(variables.command, variables.platform, csrfToken);
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: platformKeys.detail('platform' in variables ? variables.platform.id : variables.id) }),
        queryClient.invalidateQueries({ queryKey: platformKeys.accounts('platform' in variables ? variables.platform.id : variables.id) }),
        onPlatformChanged(
          variables.command === 'delete-platform' ? 'delete' : 'status',
          'platform' in variables ? variables.platform.id : variables.id,
        ),
      ]);
      if (variables.command === 'delete-platform') {
        queryClient.removeQueries({ queryKey: platformKeys.detail(variables.id) });
        queryClient.removeQueries({ queryKey: platformKeys.accounts(variables.id) });
      }
      if (variables.command === 'delete-platform' && rows.length === 1 && search.page > 1) {
        changeSearch({ page: search.page - 1 }, false);
      }
      if (variables.command === 'delete-platform') setDeletionIntent(undefined);
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKeys.lists() });
    },
  });

  function handleCommand(
    command: string,
    platform: PlatformProfile,
    focusReturn?: HTMLElement | null,
  ) {
    if (command === 'view-delete-conditions') {
      setDeletionIntent({ id: platform.id, command: 'view-delete-conditions', focusReturn: focusReturn ?? null });
      return;
    }
    if (command === 'enable-platform') {
      setEnableTarget({
        platform,
        focusReturn: focusReturn
          ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      });
      return;
    }
    if (command === 'disable-platform') {
      mutation.mutate({ command: 'disable-platform', platform });
      return;
    }
    if (command === 'delete-platform') {
      setDeletionIntent({
        id: platform.id,
        command,
        focusReturn: focusReturn ?? null,
      });
      return;
    }
    throw new Error(`平台列表收到未知页面命令：${command}`);
  }

  function confirmDelete() {
    if (!deletionIntent || platforms.isFetching || platforms.error) return;
    const exactKey = platformKeys.list(platformSearchToApiParams(search));
    const queryState = queryClient.getQueryState(exactKey);
    if (!queryState || queryState.fetchStatus === 'fetching' || queryState.error) return;
    const current = queryClient.getQueryData<PlatformProfileList>(exactKey)
      ?.items.find((item) => item.id === deletionIntent.id);
    if (!current) return;
    resolvePlatformOverflowActions(current, false);
    if (current.deletion === null || !current.available_actions.includes('DELETE') || current.deletion.blockers.length > 0) return;
    mutation.mutate({ command: 'delete-platform', id: current.id, expectedRevision: current.revision });
  }

  return (
    <section aria-labelledby="platform-list-title" className="min-w-0 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="type-page-title" id="platform-list-title">平台与账号</h1>
          <p className="max-w-3xl text-text-secondary">
            查看平台配置与可用发布账号，并从服务端指定的动作继续管理。
          </p>
        </div>
        {canManagePlatformTypes && (
          <a className={buttonVariants({ variant: 'outline' })} href="/settings/platforms/types">
            管理平台类型
          </a>
        )}
      </header>

      {platforms.data && <PlatformSummary summary={platforms.data.summary} />}

      {platforms.data && platforms.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前列表：${errorMessage(platforms.error)}`}
          onAction={() => void platforms.refetch()}
        />
      )}
      {mutation.error && mutation.variables?.command !== 'delete-platform' && (
        <Notice
          actionLabel="关闭"
          message={errorMessage(mutation.error)}
          onAction={() => mutation.reset()}
        />
      )}

      <TableToolbar>
        <PlatformFilters
          key={`${search.q ?? ''}-${platforms.data?.platform_type_options.length ?? 0}`}
          onChange={(changes) => changeSearch(changes)}
          options={platforms.data?.platform_type_options ?? []}
          search={search}
        />
      </TableToolbar>

      <TableShell className="platform-list-table" regionLabel="平台列表">
        <thead>
          <tr>
            <th data-column-role="primary" scope="col">平台</th>
            <th data-column-role="metadata" scope="col">类型</th>
            <th data-column-role="status" scope="col">配置状态</th>
            <th data-column-role="numeric" scope="col">发布账号</th>
            <th data-column-role="status" scope="col">状态</th>
            <th data-column-role="date" scope="col">更新时间</th>
            <th data-column-role="actions" scope="col">操作</th>
          </tr>
        </thead>
        {platforms.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : platforms.error && !platforms.data ? (
          <EmptyTable
            action={<Button onClick={() => void platforms.refetch()} variant="outline">重试</Button>}
            colSpan={columnRoles.length}
            description={errorMessage(platforms.error)}
            kind="error"
            title="平台列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? (
              <Button
                onClick={() => changeSearch({
                  q: undefined,
                  platformTypeId: undefined,
                  status: undefined,
                  configurationStatus: undefined,
                })}
                variant="outline"
              >
                清除筛选
              </Button>
            ) : undefined}
            colSpan={columnRoles.length}
            description={filtered ? '没有符合当前搜索与筛选条件的平台。' : '当前还没有平台配置。'}
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配平台' : '暂无平台'}
          />
        ) : rows.length === 0 ? (
          <EmptyTable
            action={(
              <Button onClick={() => changeSearch({ page: pageCount }, false)} variant="outline">
                返回最后一页
              </Button>
            )}
            colSpan={columnRoles.length}
            description="URL 指定的页码已超过当前结果范围。"
            kind="filtered-empty"
            title="当前页已超出范围"
          />
        ) : (
          <tbody>
            {rows.map((platform) => {
              const pendingTargetId = mutation.variables?.command === 'delete-platform'
                ? mutation.variables.id
                : mutation.variables?.platform.id;
              const pending = mutation.isPending && pendingTargetId === platform.id;
              return (
                <tr key={platform.id}>
                  <td data-column-role="primary"><PlatformIdentity platform={platform} /></td>
                  <td data-column-role="metadata">{platform.platform_type?.name ?? '未归类'}</td>
                  <td data-column-role="status"><ReadinessBadge platform={platform} /></td>
                  <td data-column-role="numeric">{platform.enabled_platform_account_count} 个可用</td>
                  <td data-column-role="status"><PlatformStatusBadge platform={platform} /></td>
                  <td data-column-role="date"><UpdatedTime value={platform.updated_at} /></td>
                  <td data-column-role="actions">
                    {platform.primary_task === null
                      && platform.available_actions.length === 0
                      && platform.deletion === null ? (
                        <span className="block text-right text-sm text-text-muted">无可用操作</span>
                      ) : (
                        <RowActions
                          objectLabel={platform.name}
                          onCommand={(command, focusReturn) => (
                            handleCommand(command, platform, focusReturn)
                          )}
                          overflow={resolvePlatformOverflowActions(platform, pending)}
                          primary={resolvePlatformPrimaryAction(platform)}
                        />
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
      </TableShell>

      {!platforms.isPending && !(platforms.error && !platforms.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({
            pageSize: normalizePlatformPageSize(pageSize),
          })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}

      <PlatformDeletionDialog
        key={deletionIntent?.id ?? 'none'}
        intent={deletionIntent}
        mutation={mutation}
        onConfirm={confirmDelete}
        onClose={() => { if (!mutation.isPending) { setDeletionIntent(undefined); mutation.reset(); } }}
        onReload={async () => {
          const result = await platforms.refetch();
          if (result.error) throw result.error;
          if (deletionIntent && !result.data?.items.some((item) => item.id === deletionIntent.id)) {
            setDeletionIntent(undefined);
          }
          mutation.reset();
        }}
        platforms={platforms.data}
        queryError={platforms.error}
        queryFetching={platforms.isFetching}
      />
      <EnablePlatformDialog
        onClose={() => setEnableTarget(undefined)}
        onConfirm={() => {
          if (enableTarget) {
            mutation.mutate({ command: 'enable-platform', platform: enableTarget.platform });
          }
          setEnableTarget(undefined);
        }}
        target={enableTarget}
      />
    </section>
  );
}

function EnablePlatformDialog({
  onClose,
  onConfirm,
  target,
}: {
  onClose: () => void;
  onConfirm: () => void;
  target?: EnableTarget;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <DialogContent finalFocus={{ current: target?.focusReturn ?? null }}>
        <DialogHeader>
          <DialogTitle>启用平台“{target?.platform.name}”？</DialogTitle>
          <DialogDescription>启用不会自动补齐 Prompt 或发布账号。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={onConfirm} type="button">启用平台</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformSummary({ summary }: { summary: PlatformProfileList['summary'] }) {
  const items = [
    { label: '平台总数', value: summary.platform_total },
    { label: '已启用', value: summary.enabled_total },
    { label: '配置完整', value: summary.readiness_complete_total },
  ];
  return (
    <div aria-label="全部平台摘要" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="region">
      {items.map((item) => (
        <dl className="rounded-lg border border-border-subtle bg-surface-panel p-3" key={item.label}>
          <dt className="text-sm text-text-secondary">{item.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</dd>
        </dl>
      ))}
      <dl className="rounded-lg border border-border-subtle bg-surface-panel p-3">
        <dt className="text-sm text-text-secondary">待补配置</dt>
        <dd className="mt-1 text-sm font-medium">
          缺 Prompt {summary.missing_prompt_total} · 缺账号 {summary.missing_account_total}
        </dd>
      </dl>
    </div>
  );
}

function PlatformFilters({
  onChange,
  options,
  search,
}: {
  onChange: (changes: Partial<PlatformSearch>) => void;
  options: { id: string; name: string }[];
  search: PlatformSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');
  return (
    <FilterBar
      filters={(
        <>
          <PlatformFilterSelect
            ariaLabel="平台类型"
            items={[
              { value: 'ALL', label: '全部类型' },
              ...options.map((option) => ({ value: option.id, label: option.name })),
            ]}
            onChange={(value) => onChange({
              platformTypeId: value === 'ALL' ? undefined : value,
            })}
            value={search.platformTypeId ?? 'ALL'}
          />
          <PlatformFilterSelect
            ariaLabel="启用状态"
            items={[
              { value: 'ALL', label: '全部状态' },
              { value: 'ENABLED', label: 'Enabled' },
              { value: 'DISABLED', label: 'Disabled' },
            ]}
            onChange={(value) => onChange({
              status: value === 'ALL' ? undefined : value as PlatformSearch['status'],
            })}
            value={search.status ?? 'ALL'}
          />
          <PlatformFilterSelect
            ariaLabel="配置状态"
            items={[
              { value: 'ALL', label: '全部配置' },
              { value: 'COMPLETE', label: '完整' },
              { value: 'MISSING_PROMPT', label: '缺 Prompt' },
              { value: 'MISSING_ACCOUNT', label: '缺账号' },
            ]}
            onChange={(value) => onChange({
              configurationStatus: value === 'ALL'
                ? undefined
                : value as PlatformSearch['configurationStatus'],
            })}
            value={search.configurationStatus ?? 'ALL'}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => {
        setQuery('');
        onChange({
          q: undefined,
          platformTypeId: undefined,
          status: undefined,
          configurationStatus: undefined,
        });
      }}
      onSubmit={() => onChange({ q: query.trim() || undefined })}
      placeholder="搜索平台或类型"
      query={query}
      resetDisabled={!query && !hasPlatformFilters(search)}
      searchLabel="搜索平台"
    />
  );
}

function PlatformFilterSelect({
  ariaLabel,
  items,
  onChange,
  value,
}: {
  ariaLabel: string;
  items: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select items={items} onValueChange={(next) => next && onChange(next)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PlatformIdentity({ platform }: { platform: PlatformProfile }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {platform.logo ? (
        <img alt="" className="size-8 shrink-0 rounded-md object-cover" src={platform.logo.url} />
      ) : (
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-sm font-semibold text-text-secondary">
          {platform.name.slice(0, 1)}
        </span>
      )}
      <a
        className="table-cell-ellipsis rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={platformWorkspaceHref(platform.id)}
      >
        {platform.name}
      </a>
    </div>
  );
}

function ReadinessBadge({ platform }: { platform: PlatformProfile }) {
  const presentation = readinessRegistry[platform.readiness_status];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function PlatformStatusBadge({ platform }: { platform: PlatformProfile }) {
  const status = platform.is_active ? 'ENABLED' : 'DISABLED';
  const presentation = platformStatusRegistry[status];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function UpdatedTime({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`平台列表收到非法更新时间：${value}`);
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)}
    </time>
  );
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

function PlatformDeletionDialog({
  intent,
  mutation,
  onClose,
  onConfirm,
  onReload,
  platforms,
  queryError,
  queryFetching,
}: {
  intent?: DeletionIntent;
  mutation: { error: unknown; isPending: boolean; variables?: CommandVariables };
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => Promise<void>;
  platforms?: PlatformProfileList;
  queryError: unknown;
  queryFetching: boolean;
}) {
  const [reloadMessage, setReloadMessage] = useState<string>();
  if (!intent) return null;
  const current = platforms?.items.find((item) => item.id === intent.id);
  if (!current) return null;
  const blockers = current.deletion?.blockers ?? [];
  const hasDeleteProjection = current.deletion !== null && current.available_actions.includes('DELETE');
  const deletionError = mutation.variables?.command === 'delete-platform' ? mutation.error : null;
  const conflict = deletionError instanceof Error
    && 'status' in deletionError
    && deletionError.status === 409;
  const stale = Boolean(queryError);
  const canDelete = !queryFetching
    && !stale
    && !conflict
    && hasDeleteProjection
    && blockers.length === 0;

  async function reload() {
    setReloadMessage(undefined);
    try {
      await onReload();
      setReloadMessage('已读取当前平台投影，请重新确认。');
    } catch (error) {
      setReloadMessage(errorMessage(error));
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && !mutation.isPending && onClose()} open>
      <DialogContent
        finalFocus={() => intent.focusReturn?.isConnected ? intent.focusReturn : null}
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {blockers.length > 0
              ? `“${current.name}”当前不能删除`
              : hasDeleteProjection ? `确认删除平台“${current.name}”` : `“${current.name}”当前不可删除`}
          </DialogTitle>
          <DialogDescription>
            {blockers.length > 0
              ? '以下活动业务必须先处理，服务端会在删除时重新核实。'
              : hasDeleteProjection
                ? `将删除平台配置及 ${current.platform_account_count} 个平台账号；服务端会校验当前 revision。`
                : '服务端当前未提供删除资格，请刷新列表后再试。'}
          </DialogDescription>
        </DialogHeader>
        {blockers.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {blockers.map((blocker) => (
              <li className="flex justify-between gap-4" key={blocker.type}>
                <span>{deletionBlockerLabel(blocker)}</span>
                <strong>{blocker.count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          hasDeleteProjection && <p className="text-sm text-text-secondary">当前 revision：{current.revision}</p>
        )}
        {queryFetching && <p className="text-sm text-text-secondary" role="status">正在同步当前平台投影…</p>}
        {stale && <p className="text-sm text-destructive" role="alert">当前列表刷新失败，无法确认最新删除资格。</p>}
        {Boolean(deletionError) && <p className="text-sm text-destructive" role="alert">{errorMessage(deletionError)}</p>}
        {hasDeleteProjection && blockers.length === 0 && conflict && (
          <Button onClick={() => void reload()} type="button" variant="outline">重新加载当前列表</Button>
        )}
        {reloadMessage && <p className="text-sm text-text-secondary" role="status">{reloadMessage}</p>}
        <DialogFooter>
          <DialogClose disabled={mutation.isPending} render={<Button variant="outline" />}>关闭</DialogClose>
          {hasDeleteProjection && blockers.length === 0 && (
            <Button disabled={!canDelete || mutation.isPending} onClick={onConfirm} type="button" variant="destructive">
              {mutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '平台列表发生未知错误';
}

export { PlatformListPage };
export type { PlatformListPageProps };
