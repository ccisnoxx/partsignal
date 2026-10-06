import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ActionConfirmation, ColumnRole } from '@/design-system/data-table/types';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
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
  aiChannelKeys,
  createAIChannel,
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
  type AIChannelList,
  type AIChannelSearch,
  type AIChannelSummary,
} from './ai-channel-list.model';
import {
  aiChannelCreateFormSchema,
  aiChannelCreateFormValues,
  providerValues,
  toAIChannelCreate,
  type AIChannel,
  type AIChannelCreateFormValues,
} from './ai-channel-workspace.model';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';

const columnRoles = [
  'primary', 'metadata', 'status', 'numeric', 'status', 'status', 'actions',
] as const satisfies readonly ColumnRole[];

type AIChannelListPageProps = {
  csrfToken: string | null;
  onChannelChanged: (
    kind: 'status' | 'delete',
    channelId: string,
    continuation: PrincipalContinuation,
  ) => Promise<void>;
  onCreated: (channel: AIChannel, continuation: PrincipalContinuation) => Promise<void> | void;
  onSearchChange: (search: AIChannelSearch) => Promise<void> | void;
  search: AIChannelSearch;
};

type CommandVariables = { command: AIChannelCommand; channel: Pick<AIChannelSummary, 'id' | 'revision'> };
type CommandIntent = { id: string; command: AIChannelCommand; scope: string; focusReturn: HTMLElement | null };

function AIChannelListPage({
  csrfToken,
  onChannelChanged,
  onCreated,
  onSearchChange,
  search,
}: AIChannelListPageProps) {
  const queryClient = useQueryClient();
  const queryOptions = aiChannelListQueryOptions(search);
  const scope = JSON.stringify(queryOptions.queryKey);
  const channels = useQuery(queryOptions);
  const [intent, setIntent] = useState<CommandIntent>();
  const [processing, setProcessing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const working = useRef(false);
  const activeScope = useRef(scope);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { activeScope.current = scope; }, [scope]);
  if (intent && intent.scope !== scope) setIntent(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
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
  });
  const conflict = mutation.error instanceof AIChannelRequestError && mutation.error.status === 409;
  const blocked = processing || conflict || reloading || channels.isFetching || channels.isError || Boolean(refreshError);
  const currentTarget = intent?.scope === scope ? rows.find((row) => row.id === intent.id) : undefined;
  const confirmation = currentTarget && intent ? commandConfirmation(currentTarget, intent.command) : undefined;

  function currentCommandTarget(command: AIChannelCommand, id: string) {
    if (working.current || blocked) return;
    const current = queryClient.getQueryState<AIChannelList>(queryOptions.queryKey);
    if (current?.status !== 'success' || current.fetchStatus !== 'idle') return;
    const target = current.data?.items.find((row) => row.id === id);
    return target && commandConfirmation(target, command) ? target : undefined;
  }

  function handleCommand(command: string, channel: AIChannelSummary, focusReturn?: HTMLElement | null) {
    if (command !== 'enable-channel' && command !== 'disable-channel' && command !== 'delete-channel') {
      throw new Error(`AI 渠道列表收到未知页面命令：${command}`);
    }
    if (!currentCommandTarget(command, channel.id)) return;
    setIntent({
      id: channel.id,
      command,
      scope,
      focusReturn: focusReturn ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    });
  }

  async function confirmCommand() {
    if (!intent || intent.scope !== scope) return;
    const target = currentCommandTarget(intent.command, intent.id);
    if (!target) return;
    working.current = true;
    setProcessing(true);
    setRefreshError(undefined);
    setIntent(undefined);
    const command = intent.command;
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await mutation.mutateAsync({ command, channel: { id: target.id, revision: target.revision } });
    } catch {
      if (!continuation.isCurrent()) return;
      working.current = false;
      setProcessing(false);
      return;
    }
    if (!continuation.isCurrent()) return;
    try {
      if (command === 'delete-channel') {
        // 先结束旧读取并投影已确认删除，再让服务端刷新集合。
        await queryClient.cancelQueries({ queryKey: aiChannelKeys.lists() });
        if (!continuation.isCurrent()) return;
        queryClient.setQueriesData<AIChannelList>({ queryKey: aiChannelKeys.lists() }, (current) => {
          if (!current?.items.some((row) => row.id === target.id)) return current;
          return { ...current, items: current.items.filter((row) => row.id !== target.id), total: current.total - 1 };
        });
      }
      await onChannelChanged(command === 'delete-channel' ? 'delete' : 'status', target.id, continuation);
      if (!continuation.isCurrent()) return;
      if (command === 'delete-channel' && rows.length === 1 && search.page > 1 && mounted.current && activeScope.current === scope) {
        changeSearch({ page: search.page - 1 }, false);
      }
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setRefreshError(`命令已成功，刷新相关数据失败：${errorMessage(error)}`);
    } finally {
      if (continuation.isCurrent()) {
        working.current = false;
        setProcessing(false);
      }
    }
  }

  async function reload() {
    if (working.current || reloading) return;
    setReloading(true);
    const result = await channels.refetch();
    if (activeScope.current === scope && result.isSuccess && !result.isFetching) {
      mutation.reset();
      setRefreshError(undefined);
      setIntent(undefined);
    }
    setReloading(false);
  }

  return (
    <section aria-labelledby="ai-channel-list-title" className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="type-page-title" id="ai-channel-list-title" ref={titleRef} tabIndex={-1}>AI 渠道</h1>
          <p className="max-w-3xl text-text-secondary">
            查看渠道、模型与连接状态，并按服务端提供的动作继续管理。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} ref={createTrigger} type="button">创建渠道</Button>
      </header>

      {channels.data && channels.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前列表：${errorMessage(channels.error)}`}
          onAction={() => void reload()}
        />
      )}
      {mutation.error && (
        <Notice
          actionLabel={conflict ? '重新加载列表' : '关闭'}
          message={errorMessage(mutation.error)}
          onAction={() => { if (conflict) void reload(); else mutation.reset(); }}
        />
      )}

      {refreshError && <Notice actionLabel="重试刷新" message={refreshError} onAction={() => void reload()} />}

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
              const primary = resolveAIChannelPrimaryAction(channel);
              const resolvedPrimary = primary.command && blocked
                ? { ...primary, enabled: false, disabledReason: conflict ? '请先重新加载列表' : '列表命令暂不可用' }
                : primary;
              const overflow = resolveAIChannelOverflowActions(channel, false).map((action) => action.command
                ? { ...action, enabled: action.enabled && !blocked, disabledReason: blocked ? '请先等待或重新加载列表' : action.disabledReason, confirmation: 'custom' as const }
                : action);
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
                      overflow={overflow}
                      primary={resolvedPrimary}
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

      <ChannelCommandDialog
        confirmation={confirmation}
        disabled={blocked || !confirmation}
        fallbackFocus={titleRef}
        onClose={() => setIntent(undefined)}
        onConfirm={() => void confirmCommand()}
        target={intent}
      />
      <AIChannelCreateDialog
        csrfToken={csrfToken}
        finalFocus={createTrigger}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
        open={createOpen}
      />
    </section>
  );
}

function AIChannelCreateDialog({
  csrfToken,
  finalFocus,
  onClose,
  onCreated,
  open,
}: {
  csrfToken: string | null;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: (channel: AIChannel, continuation: PrincipalContinuation) => Promise<void> | void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [handoff, setHandoff] = useState<{ channel: AIChannel; error: string }>();
  const [isCreating, setIsCreating] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const creating = useRef(false);
  const opening = useRef(false);
  const mounted = useRef(true);
  const form = useForm<AIChannelCreateFormValues>({
    defaultValues: aiChannelCreateFormValues(),
    resolver: zodResolver(aiChannelCreateFormSchema),
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      form.reset(aiChannelCreateFormValues());
    };
  }, [form]);

  function close() {
    form.reset(aiChannelCreateFormValues());
    setError(undefined);
    onClose();
  }

  async function openCreatedChannel(
    channel: AIChannel,
    continuation = capturePrincipalContinuation(queryClient),
  ) {
    if (opening.current) return;
    opening.current = true;
    setIsOpening(true);
    try {
      await onCreated(channel, continuation);
      if (continuation.isCurrent() && mounted.current) setHandoff(undefined);
    } catch (reason) {
      if (continuation.isCurrent() && mounted.current) {
        setHandoff({ channel, error: errorMessage(reason) });
      }
    } finally {
      opening.current = false;
      if (continuation.isCurrent() && mounted.current) setIsOpening(false);
    }
  }

  async function submit(values: AIChannelCreateFormValues) {
    if (creating.current) return;
    creating.current = true;
    setIsCreating(true);
    setError(undefined);
    const continuation = capturePrincipalContinuation(queryClient);
    let channel: AIChannel;
    try {
      channel = await createAIChannel(toAIChannelCreate(values), csrfToken);
    } catch (reason) {
      if (continuation.isCurrent() && mounted.current) {
        setError(errorMessage(reason));
        form.setValue('apiKey', '');
      }
      return;
    } finally {
      creating.current = false;
      if (continuation.isCurrent() && mounted.current) setIsCreating(false);
    }
    if (!continuation.isCurrent()) return;
    if (!mounted.current) {
      await queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() });
      return;
    }
    close();
    await openCreatedChannel(channel, continuation);
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(submit)(event);
  }

  return (
    <>
    {handoff && (
      <Notice
        actionLabel={isOpening ? '正在打开…' : '重新打开渠道'}
        message={`渠道“${handoff.channel.name}”已创建，但打开工作区失败：${handoff.error}`}
        onAction={() => { void openCreatedChannel(handoff.channel); }}
      />
    )}
    <Dialog onOpenChange={(nextOpen) => !nextOpen && !isCreating && close()} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" finalFocus={finalFocus} showCloseButton={!isCreating}>
        <DialogHeader>
          <DialogTitle>创建 AI 渠道</DialogTitle>
          <DialogDescription>创建后默认停用；API Key 只用于本次提交且不会回显。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="grid gap-4 sm:grid-cols-2" id="ai-channel-create-form" noValidate onSubmit={handleFormSubmit}>
            <ErrorSummary className="sm:col-span-2" errors={error ? [{ id: 'server', message: error }] : []} />
            <FormField<AIChannelCreateFormValues, 'name'>
              id="ai-channel-create-name"
              label="渠道名称"
              name="name"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoFocus disabled={isCreating} id={context.inputId} maxLength={160} />}
            />
            <FormField<AIChannelCreateFormValues, 'providerBrand'>
              id="ai-channel-create-provider"
              label="Provider"
              name="providerBrand"
              required
              render={(context) => (
                <Select items={providerValues.map((value) => ({ label: providerRegistry[value], value }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent>{providerValues.map((value) => <SelectItem key={value} value={value}>{providerRegistry[value]}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
            <FormField<AIChannelCreateFormValues, 'description'>
              className="sm:col-span-2"
              id="ai-channel-create-description"
              label="描述"
              name="description"
              render={(context) => <Textarea {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={isCreating} id={context.inputId} maxLength={500} rows={3} />}
            />
            <FormField<AIChannelCreateFormValues, 'baseUrl'>
              id="ai-channel-create-base-url"
              label="API 根地址"
              name="baseUrl"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={isCreating} id={context.inputId} inputMode="url" placeholder="https://api.example.com/v1" />}
            />
            <FormField<AIChannelCreateFormValues, 'timeoutSeconds'>
              id="ai-channel-create-timeout"
              label="超时时间（秒）"
              name="timeoutSeconds"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={isCreating} id={context.inputId} max={600} min={10} onChange={(event) => context.field.onChange(event.currentTarget.valueAsNumber)} type="number" />}
            />
            <FormField<AIChannelCreateFormValues, 'apiKey'>
              className="sm:col-span-2"
              description="密钥不会进入读取响应、查询缓存或诊断输出。"
              id="ai-channel-create-api-key"
              label="API Key"
              name="apiKey"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoComplete="new-password" disabled={isCreating} id={context.inputId} type="password" />}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={isCreating} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={isCreating} form="ai-channel-create-form" type="submit">{isCreating ? '创建中…' : '创建渠道'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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

function commandConfirmation(channel: AIChannelSummary, command: AIChannelCommand): ActionConfirmation | undefined {
  if (command === 'enable-channel' && channel.primary_task === 'ENABLE_CHANNEL') {
    resolveAIChannelPrimaryAction(channel);
    return { title: `启用渠道“${channel.name}”？`, description: '服务端会重新校验模型测试结果与当前修订。', confirmLabel: '启用渠道', intent: 'default' };
  }
  const action = resolveAIChannelOverflowActions(channel, false).find((item) => item.command === command);
  return action?.confirmation && action.confirmation !== 'custom' ? action.confirmation : undefined;
}

function ChannelCommandDialog({ confirmation, disabled, fallbackFocus, onClose, onConfirm, target }: {
  confirmation?: ActionConfirmation;
  disabled: boolean;
  fallbackFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: () => void;
  target?: CommandIntent;
}) {
  const focusReturn = useRef<HTMLElement | null>(null);
  useEffect(() => { if (target) focusReturn.current = target.focusReturn; }, [target]);
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <DialogContent finalFocus={() => focusReturn.current?.isConnected ? focusReturn.current : fallbackFocus.current}>
        <DialogHeader>
          <DialogTitle>{confirmation?.title ?? '渠道操作已不可用'}</DialogTitle>
          <DialogDescription>{confirmation?.description ?? '当前列表已不再提供此操作，请关闭后检查最新渠道信息。'}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={disabled} onClick={onConfirm} type="button" variant={confirmation?.intent ?? 'default'}>{confirmation?.confirmLabel ?? '确认执行'}</Button>
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
