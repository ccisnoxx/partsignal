import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
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
import { platformKeys, platformListQueryOptions, runPlatformCommand } from './platform.api';
import {
  deletionBlockerLabel,
  hasPlatformFilters,
  normalizePlatformPageSize,
  platformStatusRegistry,
  platformWorkspaceHref,
  readinessRegistry,
  resolvePlatformOverflowActions,
  resolvePlatformPrimaryAction,
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
  csrfToken: string | null;
  onSearchChange: (search: PlatformSearch) => Promise<void> | void;
  search: PlatformSearch;
};

type CommandVariables = { command: PlatformCommand; platform: PlatformProfile };
type BlockerTarget = { platform: PlatformProfile; focusReturn: HTMLElement | null };
type EnableTarget = { platform: PlatformProfile; focusReturn: HTMLElement | null };

function PlatformListPage({ csrfToken, onSearchChange, search }: PlatformListPageProps) {
  const queryClient = useQueryClient();
  const platforms = useQuery(platformListQueryOptions(search));
  const [blockerTarget, setBlockerTarget] = useState<BlockerTarget>();
  const [enableTarget, setEnableTarget] = useState<EnableTarget>();
  const rows = platforms.data?.items ?? [];
  const total = platforms.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const filtered = hasPlatformFilters(search);

  function changeSearch(changes: Partial<PlatformSearch>, resetPage = true) {
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  const mutation = useMutation({
    mutationFn: ({ command, platform }: CommandVariables) => (
      runPlatformCommand(command, platform, csrfToken)
    ),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: platformKeys.lists() });
      if (variables.command === 'delete-platform' && rows.length === 1 && search.page > 1) {
        changeSearch({ page: search.page - 1 }, false);
      }
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
      setBlockerTarget({ platform, focusReturn: focusReturn ?? null });
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
    if (
      command === 'disable-platform'
      || command === 'delete-platform'
    ) {
      mutation.mutate({ command, platform });
      return;
    }
    throw new Error(`平台列表收到未知页面命令：${command}`);
  }

  return (
    <section aria-labelledby="platform-list-title" className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="type-page-title" id="platform-list-title">平台与账号</h1>
        <p className="max-w-3xl text-text-secondary">
          查看平台配置与可用发布账号，并从服务端指定的动作继续管理。
        </p>
      </header>

      {platforms.data && <PlatformSummary summary={platforms.data.summary} />}

      {platforms.data && platforms.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前列表：${errorMessage(platforms.error)}`}
          onAction={() => void platforms.refetch()}
        />
      )}
      {mutation.error && (
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
              const pending = mutation.isPending && mutation.variables?.platform.id === platform.id;
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

      <DeletionBlockersDialog
        onClose={() => setBlockerTarget(undefined)}
        target={blockerTarget}
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

function DeletionBlockersDialog({
  onClose,
  target,
}: {
  onClose: () => void;
  target?: BlockerTarget;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <DialogContent finalFocus={{ current: target?.focusReturn ?? null }}>
        <DialogHeader>
          <DialogTitle>“{target?.platform.name}”当前不能删除</DialogTitle>
          <DialogDescription>以下活动业务必须先处理，服务端会在删除时重新核实。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {target?.platform.deletion?.blockers.map((blocker) => (
            <li className="flex justify-between gap-4" key={blocker.type}>
              <span>{deletionBlockerLabel(blocker)}</span>
              <strong>{blocker.count}</strong>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
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
