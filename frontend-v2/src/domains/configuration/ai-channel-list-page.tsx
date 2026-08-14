import { useMutation, useQuery } from '@tanstack/react-query';
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
import {
  AIChannelRequestError,
  aiChannelListQueryOptions,
  runAIChannelCommand,
} from './ai-channel.api';
import {
  aiChannelWorkspaceHref,
  channelStatusRegistry,
  configurationStatusRegistry,
  connectionStatusRegistry,
  hasAIChannelFilters,
  normalizeAIChannelPageSize,
  providerRegistry,
  resolveAIChannelOverflowActions,
  resolveAIChannelPrimaryAction,
  type AIChannelCommand,
  type AIChannelSearch,
  type AIChannelSummary,
} from './ai-channel-list.model';

const columnRoles = [
  'primary', 'metadata', 'status', 'numeric', 'status', 'status', 'actions',
] as const satisfies readonly ColumnRole[];

type AIChannelListPageProps = {
  csrfToken: string | null;
  onChannelChanged: (kind: 'status' | 'delete', channelId: string) => Promise<void>;
  onSearchChange: (search: AIChannelSearch) => Promise<void> | void;
  search: AIChannelSearch;
};

type CommandVariables = { command: AIChannelCommand; channel: AIChannelSummary };
type EnableTarget = { channel: AIChannelSummary; focusReturn: HTMLElement | null };

function AIChannelListPage({
  csrfToken,
  onChannelChanged,
  onSearchChange,
  search,
}: AIChannelListPageProps) {
  const channels = useQuery(aiChannelListQueryOptions(search));
  const [enableTarget, setEnableTarget] = useState<EnableTarget>();
  const rows = channels.data?.items ?? [];
  const total = channels.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const filtered = hasAIChannelFilters(search);

  function changeSearch(changes: Partial<AIChannelSearch>, resetPage = true) {
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  const mutation = useMutation({
    mutationFn: ({ command, channel }: CommandVariables) => (
      runAIChannelCommand(command, channel, csrfToken)
    ),
    onSuccess: async (_result, variables) => {
      await onChannelChanged(
        variables.command === 'delete-channel' ? 'delete' : 'status',
        variables.channel.id,
      );
      if (variables.command === 'delete-channel' && rows.length === 1 && search.page > 1) {
        changeSearch({ page: search.page - 1 }, false);
      }
    },
  });

  function handleCommand(
    command: string,
    channel: AIChannelSummary,
    focusReturn?: HTMLElement | null,
  ) {
    if (command === 'enable-channel' && channel.primary_task === 'ENABLE_CHANNEL') {
      setEnableTarget({
        channel,
        focusReturn: focusReturn
          ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      });
      return;
    }
    if (command === 'enable-channel' || command === 'disable-channel' || command === 'delete-channel') {
      mutation.mutate({ command, channel });
      return;
    }
    throw new Error(`AI 渠道列表收到未知页面命令：${command}`);
  }

  const conflict = mutation.error instanceof AIChannelRequestError
    && mutation.error.detail?.code === 'REVISION_CONFLICT';

  return (
    <section aria-labelledby="ai-channel-list-title" className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="type-page-title" id="ai-channel-list-title">AI 渠道</h1>
        <p className="max-w-3xl text-text-secondary">
          查看渠道、模型与连接状态，并按服务端提供的动作继续管理。
        </p>
      </header>

      {channels.data && channels.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前列表：${errorMessage(channels.error)}`}
          onAction={() => void channels.refetch()}
        />
      )}
      {mutation.error && (
        <Notice
          actionLabel={conflict ? '重新加载列表' : '关闭'}
          message={errorMessage(mutation.error)}
          onAction={() => {
            mutation.reset();
            if (conflict) void channels.refetch();
          }}
        />
      )}

      <TableToolbar>
        <AIChannelFilters
          key={`${search.q ?? ''}-${search.provider ?? ''}-${search.status ?? ''}-${search.sort ?? ''}`}
          onChange={(changes) => changeSearch(changes)}
          search={search}
        />
      </TableToolbar>

      <TableShell className="ai-channel-list-table" regionLabel="AI 渠道列表">
        <thead>
          <tr>
            <th data-column-role="primary" scope="col">渠道</th>
            <th data-ai-column="provider" data-column-role="metadata" scope="col">Provider / Protocol</th>
            <th data-column-role="status" scope="col">状态</th>
            <th data-ai-column="models" data-column-role="numeric" scope="col">模型</th>
            <th data-ai-column="connection" data-column-role="status" scope="col">连接</th>
            <th data-ai-column="configuration" data-column-role="status" scope="col">配置</th>
            <th data-column-role="actions" scope="col">操作</th>
          </tr>
        </thead>
        {channels.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : channels.error && !channels.data ? (
          <EmptyTable
            action={<Button onClick={() => void channels.refetch()} variant="outline">重试</Button>}
            colSpan={columnRoles.length}
            description={errorMessage(channels.error)}
            kind="error"
            title="AI 渠道列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? (
              <Button
                onClick={() => changeSearch({
                  q: undefined,
                  status: undefined,
                  provider: undefined,
                  sort: undefined,
                })}
                variant="outline"
              >
                清除筛选
              </Button>
            ) : undefined}
            colSpan={columnRoles.length}
            description={filtered ? '没有符合当前条件的 AI 渠道。' : '当前还没有 AI 渠道。'}
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配渠道' : '暂无 AI 渠道'}
          />
        ) : rows.length === 0 ? (
          <EmptyTable
            action={<Button onClick={() => changeSearch({ page: pageCount }, false)} variant="outline">返回最后一页</Button>}
            colSpan={columnRoles.length}
            description="URL 指定的页码已超过当前结果范围。"
            kind="filtered-empty"
            title="当前页已超出范围"
          />
        ) : (
          <tbody>
            {rows.map((channel) => {
              const pending = mutation.isPending && mutation.variables?.channel.id === channel.id;
              return (
                <tr key={channel.id}>
                  <td data-column-role="primary"><ChannelIdentity channel={channel} /></td>
                  <td data-ai-column="provider" data-column-role="metadata"><ProviderProtocol channel={channel} /></td>
                  <td data-column-role="status"><ChannelStatusBadge channel={channel} /></td>
                  <td data-ai-column="models" data-column-role="numeric">{channel.enabled_model_count} / {channel.model_count}</td>
                  <td data-ai-column="connection" data-column-role="status"><ConnectionBadge channel={channel} /></td>
                  <td data-ai-column="configuration" data-column-role="status"><ConfigurationBadge channel={channel} /></td>
                  <td data-column-role="actions">
                    <RowActions
                      objectLabel={channel.name}
                      onCommand={(command, focusReturn) => handleCommand(command, channel, focusReturn)}
                      overflow={resolveAIChannelOverflowActions(channel, pending)}
                      primary={resolveAIChannelPrimaryAction(channel)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
      </TableShell>

      {!channels.isPending && !(channels.error && !channels.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({ pageSize: normalizeAIChannelPageSize(pageSize) })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}

      <EnableChannelDialog
        onClose={() => setEnableTarget(undefined)}
        onConfirm={() => {
          if (enableTarget) mutation.mutate({ command: 'enable-channel', channel: enableTarget.channel });
          setEnableTarget(undefined);
        }}
        target={enableTarget}
      />
    </section>
  );
}

function AIChannelFilters({
  onChange,
  search,
}: {
  onChange: (changes: Partial<AIChannelSearch>) => void;
  search: AIChannelSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');
  return (
    <FilterBar
      filters={(
        <>
          <ChannelFilterSelect
            ariaLabel="启用状态"
            items={[
              { value: 'ALL', label: '全部状态' },
              { value: 'ENABLED', label: 'Enabled' },
              { value: 'DISABLED', label: 'Disabled' },
            ]}
            onChange={(value) => onChange({ status: value === 'ALL' ? undefined : value as AIChannelSearch['status'] })}
            value={search.status ?? 'ALL'}
          />
          <ChannelFilterSelect
            ariaLabel="Provider"
            items={[
              { value: 'ALL', label: '全部 Provider' },
              ...Object.entries(providerRegistry).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => onChange({ provider: value === 'ALL' ? undefined : value as AIChannelSearch['provider'] })}
            value={search.provider ?? 'ALL'}
          />
          <ChannelFilterSelect
            ariaLabel="排序"
            items={[
              { value: 'DEFAULT', label: '默认排序' },
              { value: 'NAME_ASC', label: '名称升序' },
              { value: 'NAME_DESC', label: '名称降序' },
              { value: 'UPDATED_DESC', label: '最近更新' },
              { value: 'LAST_TESTED_DESC', label: '最近测试' },
            ]}
            onChange={(value) => onChange({ sort: value === 'DEFAULT' ? undefined : value as AIChannelSearch['sort'] })}
            value={search.sort ?? 'DEFAULT'}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => {
        setQuery('');
        onChange({ q: undefined, status: undefined, provider: undefined, sort: undefined });
      }}
      onSubmit={() => onChange({ q: query.trim() || undefined })}
      placeholder="搜索渠道名称或描述"
      query={query}
      resetDisabled={!query && !hasAIChannelFilters(search)}
      searchLabel="搜索 AI 渠道"
    />
  );
}

function ChannelFilterSelect({
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
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ChannelIdentity({ channel }: { channel: AIChannelSummary }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span
        aria-label={providerRegistry[channel.provider_brand]}
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-text-secondary"
        role="img"
      >
        {providerRegistry[channel.provider_brand].slice(0, 2)}
      </span>
      <div className="min-w-0">
        <a
          className="table-cell-ellipsis rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={aiChannelWorkspaceHref(channel.id, 'basic')}
        >
          {channel.name}
        </a>
        {channel.description && <p className="table-cell-ellipsis text-xs text-text-muted">{channel.description}</p>}
        <div className="ai-channel-mobile-summary text-xs text-text-secondary">
          <span>{providerRegistry[channel.provider_brand]} · {channel.protocol_type}</span>
          <span>模型 {channel.enabled_model_count}/{channel.model_count}</span>
          <span>连接 {connectionStatusRegistry[channel.latest_test_status].label}</span>
          <span>配置 {configurationStatusRegistry[channel.configuration_status].label}</span>
        </div>
      </div>
    </div>
  );
}

function ProviderProtocol({ channel }: { channel: AIChannelSummary }) {
  return <span>{providerRegistry[channel.provider_brand]}<small className="block text-text-muted">{channel.protocol_type}</small></span>;
}

function ChannelStatusBadge({ channel }: { channel: AIChannelSummary }) {
  const presentation = channelStatusRegistry[channel.is_enabled ? 'ENABLED' : 'DISABLED'];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function ConnectionBadge({ channel }: { channel: AIChannelSummary }) {
  const presentation = connectionStatusRegistry[channel.latest_test_status];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function ConfigurationBadge({ channel }: { channel: AIChannelSummary }) {
  const presentation = configurationStatusRegistry[channel.configuration_status];
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function EnableChannelDialog({
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
          <DialogTitle>启用渠道“{target?.channel.name}”？</DialogTitle>
          <DialogDescription>服务端会重新校验模型测试结果与当前修订。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={onConfirm} type="button">启用渠道</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI 渠道列表发生未知错误';
}

export { AIChannelListPage };
export type { AIChannelListPageProps };
