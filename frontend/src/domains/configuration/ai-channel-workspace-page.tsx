import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { RowActions } from '@/design-system/data-table/row-actions';
import { TableShell } from '@/design-system/data-table/table-shell';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
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
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs';
import { Textarea } from '@/design-system/primitives/textarea';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import { AIChannelModelsSection } from './ai-channel-models-section';
import { AIChannelRuntimeSection } from './ai-channel-runtime-section';
import {
  aiChannelDetailQueryOptions,
  aiChannelKeys,
  createAIChannelHeader,
  deleteAIChannelHeader,
  replaceAIChannelApiKey,
  runAIChannelCommand,
  updateAIChannel,
  updateAIChannelHeader,
} from './ai-channel.api';
import { channelStatusRegistry, providerRegistry } from './ai-channel-list.model';
import {
  aiChannelApiKeyFormSchema,
  aiChannelConfigurationFormSchema,
  aiChannelConfigurationFormValues,
  aiChannelDetailErrorKind,
  aiChannelHeaderFormSchema,
  aiChannelHeaderFormValues,
  aiChannelWorkspaceSearchForTab,
  isAIChannelRevisionConflict,
  mapAIChannelHeaderFormError,
  providerValues,
  resolveAIChannelHeaderActions,
  resolveAIChannelWorkspaceActions,
  shouldBlockAIChannelWorkspaceNavigation,
  toAIChannelHeaderInput,
  toAIChannelUpdate,
  type AIChannel,
  type AIChannelApiKeyFormValues,
  type AIChannelConfigurationFormValues,
  type AIChannelHeader,
  type AIChannelHeaderFormValues,
  type AIChannelWorkspaceSearch,
  type AIChannelWorkspaceTab,
} from './ai-channel-workspace.model';

type AIChannelMutationKind = 'identity' | 'connection' | 'models' | 'status' | 'delete';

type AIChannelHeaderTarget = {
  focusReturn: HTMLElement | null;
  header?: AIChannelHeader;
};

type AIChannelWorkspacePageProps = {
  channelId: string;
  csrfToken: string | null;
  onConsumersChanged: (kind: AIChannelMutationKind) => Promise<void>;
  onDeleted: () => Promise<void> | void;
  onSearchChange: (search: AIChannelWorkspaceSearch) => Promise<void> | void;
  search: AIChannelWorkspaceSearch;
};

function AIChannelWorkspacePage(props: AIChannelWorkspacePageProps) {
  const detail = useQuery(aiChannelDetailQueryOptions(props.channelId));
  if (detail.isPending) return <AIChannelWorkspaceSkeleton />;
  if (!detail.data) {
    return <AIChannelWorkspaceFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (props.search.tab === 'models' || props.search.tab === 'usage' || props.search.tab === 'logs') {
    return (
      <LoadedAIChannelModelsWorkspace
        channel={detail.data}
        channelId={props.channelId}
        csrfToken={props.csrfToken}
        onConsumersChanged={props.onConsumersChanged}
        onDeleted={props.onDeleted}
        onReload={async () => (await detail.refetch()).data}
        onSearchChange={props.onSearchChange}
        search={props.search}
      />
    );
  }
  return (
    <LoadedAIChannelWorkspace
      channel={detail.data}
      channelId={props.channelId}
      csrfToken={props.csrfToken}
      onConsumersChanged={props.onConsumersChanged}
      onDeleted={props.onDeleted}
      onReload={async () => (await detail.refetch()).data}
      onSearchChange={props.onSearchChange}
      search={props.search}
    />
  );
}

function LoadedAIChannelWorkspace({
  channel,
  channelId,
  csrfToken,
  onConsumersChanged,
  onDeleted,
  onReload,
  onSearchChange,
  search,
}: AIChannelWorkspacePageProps & {
  channel: AIChannel;
  onReload: () => Promise<AIChannel | undefined>;
  search: { tab: 'basic' | 'request' };
}) {
  const queryClient = useQueryClient();
  const [draftBaseline, setDraftBaseline] = useState(channel);
  const [status, setStatus] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [headerTarget, setHeaderTarget] = useState<AIChannelHeaderTarget>();
  const keyTrigger = useRef<HTMLButtonElement>(null);
  const headerCreateTrigger = useRef<HTMLButtonElement>(null);
  const form = useForm<AIChannelConfigurationFormValues>({
    defaultValues: aiChannelConfigurationFormValues(channel),
    resolver: zodResolver(aiChannelConfigurationFormSchema),
  });
  const dirty = form.formState.isDirty;
  const baseline = dirty ? draftBaseline : channel;
  const capabilities = resolveAIChannelWorkspaceActions(baseline);

  useEffect(() => {
    if (dirty) return;
    // 干净表单接收后台 canonical 更新时，也要同步下一次编辑使用的 revision。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftBaseline(channel);
    form.reset(aiChannelConfigurationFormValues(channel));
  }, [channel, dirty, form]);

  async function publishCanonical(
    canonical: AIChannel,
    kind: Exclude<AIChannelMutationKind, 'delete'>,
    preserveDraft: boolean,
  ) {
    setDraftBaseline(canonical);
    queryClient.setQueryData(aiChannelKeys.detail(channelId), canonical);
    if (!preserveDraft) form.reset(aiChannelConfigurationFormValues(canonical));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.models(channelId) }),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.logsRoot(channelId) }),
      onConsumersChanged(kind),
    ]);
  }

  async function reloadCanonical() {
    const fresh = await onReload();
    if (!fresh) throw new Error('该 AI 渠道已不存在');
    setDraftBaseline(fresh);
    queryClient.setQueryData(aiChannelKeys.detail(channelId), fresh);
    form.reset(aiChannelConfigurationFormValues(fresh));
    setStatus(`已加载 revision ${fresh.revision}`);
    return fresh;
  }

  const save = useMutation({
    mutationFn: (values: AIChannelConfigurationFormValues) => (
      updateAIChannel(channelId, toAIChannelUpdate(values, baseline.revision), csrfToken)
    ),
  });
  const lifecycle = useMutation({
    mutationFn: (command: 'enable-channel' | 'disable-channel' | 'delete-channel') => (
      runAIChannelCommand(command, baseline, csrfToken)
    ),
    onSuccess: async (_result, command) => {
      if (command === 'delete-channel') {
        queryClient.removeQueries({ queryKey: aiChannelKeys.detail(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.models(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.usageRoot(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.logsRoot(channelId) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
          onConsumersChanged('delete'),
        ]);
        await onDeleted();
        return;
      }
      const fresh = await onReload();
      if (!fresh) throw new Error('状态变更后无法读取 AI 渠道');
      await publishCanonical(fresh, 'status', true);
    },
  });
  const removeHeader = useMutation({
    mutationFn: (header: AIChannelHeader) => deleteAIChannelHeader(baseline, header.id, csrfToken),
    onSuccess: async () => {
      const fresh = await onReload();
      if (!fresh) throw new Error('Header 删除后无法读取 AI 渠道');
      await publishCanonical(fresh, 'connection', true);
    },
  });

  async function submit(values: AIChannelConfigurationFormValues) {
    setStatus('');
    try {
      const canonical = await save.mutateAsync(values);
      await publishCanonical(canonical, 'identity', false);
      setStatus('渠道配置已保存');
    } catch {
      // mutation.error 统一展示；409 保留非敏感草稿并冻结旧 revision。
    }
  }

  function handleLifecycle(command: string) {
    if (command === 'enable-channel' || command === 'disable-channel' || command === 'delete-channel') {
      lifecycle.mutate(command);
      return;
    }
    throw new Error(`AI Channel Workspace 收到未知命令：${command}`);
  }

  const conflict = isAIChannelRevisionConflict(save.error);
  const saveActions: StickyAction[] = capabilities.canUpdate ? [
    {
      key: 'cancel', label: '取消修改', enabled: dirty && !save.isPending, intent: 'secondary',
      onSelect: () => { form.reset(aiChannelConfigurationFormValues(baseline)); save.reset(); setStatus(''); },
    },
    {
      key: 'save', label: save.isPending ? '保存中…' : '保存配置',
      enabled: dirty && !save.isPending && !conflict,
      disabledReason: conflict ? '请先重新加载服务端版本' : dirty ? '请求正在处理' : '没有待保存修改',
      intent: 'primary', onSelect: () => void form.handleSubmit(submit)(),
    },
  ] : [];

  return (
    <article aria-labelledby="ai-channel-workspace-title" className="min-w-0 space-y-4">
      <Link className="inline-flex min-h-8 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" search={{ page: 1, pageSize: 20 }} to="/settings/ai">
        返回 AI 渠道列表
      </Link>

      <AIChannelWorkspaceHeader
        channel={baseline}
        onCommand={handleLifecycle}
        onNavigate={(nextTab) => void onSearchChange(aiChannelWorkspaceSearchForTab(nextTab, search))}
        pending={lifecycle.isPending}
      />

      {lifecycle.error && (
        <Notice
          actionLabel={isAIChannelRevisionConflict(lifecycle.error) ? '重新加载渠道' : '关闭'}
          message={errorMessage(lifecycle.error)}
          onAction={() => {
            if (isAIChannelRevisionConflict(lifecycle.error)) void reloadCanonical().then(() => lifecycle.reset());
            else lifecycle.reset();
          }}
        />
      )}
      {removeHeader.error && (
        <Notice
          actionLabel={isAIChannelRevisionConflict(removeHeader.error) ? '重新加载渠道' : '关闭'}
          message={errorMessage(removeHeader.error)}
          onAction={() => {
            if (isAIChannelRevisionConflict(removeHeader.error)) void reloadCanonical().then(() => removeHeader.reset());
            else removeHeader.reset();
          }}
        />
      )}

      <FormProvider {...form}>
        <form className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel" noValidate onSubmit={form.handleSubmit(submit)}>
          <Tabs
            onValueChange={(value) => {
              if (!isAIChannelWorkspaceTab(value)) throw new Error(`AI Channel Workspace 收到未知 Tab：${value}`);
              void onSearchChange(aiChannelWorkspaceSearchForTab(value, search));
            }}
            value={search.tab}
          >
            <TabsList aria-label="AI 渠道工作区区域" className="mx-4 mt-3 max-w-[calc(100%-2rem)] overflow-x-auto" variant="line">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="request">请求配置</TabsTrigger>
              <TabsTrigger value="models">模型管理</TabsTrigger>
              <TabsTrigger value="usage">使用统计</TabsTrigger>
              <TabsTrigger value="logs">操作日志</TabsTrigger>
            </TabsList>
            <ErrorSummary className="m-4 mb-0" errors={save.error ? [{ id: 'server', message: errorMessage(save.error) }] : []} />
            {conflict && (
              <div className="m-4 mb-0 space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
                <p>渠道已被其他请求修改。当前非敏感草稿已保留，不会自动重放。</p>
                <Button onClick={() => void reloadCanonical().then(() => save.reset())} type="button" variant="outline">重新加载服务端版本</Button>
              </div>
            )}
            <TabsContent value="basic">
              <BasicConfigurationSection canUpdate={capabilities.canUpdate} pending={save.isPending} />
            </TabsContent>
            <TabsContent value="request">
              <RequestConfigurationSection
                baseline={baseline}
                canCreateHeader={capabilities.canCreateHeader}
                canReplaceApiKey={capabilities.canReplaceApiKey}
                canUpdate={capabilities.canUpdate}
                headerCreateTrigger={headerCreateTrigger}
                keyTrigger={keyTrigger}
                onCreateHeader={() => setHeaderTarget({ focusReturn: headerCreateTrigger.current })}
                onDeleteHeader={(header) => removeHeader.mutate(header)}
                onEditHeader={(header) => setHeaderTarget({
                  focusReturn: document.activeElement instanceof HTMLElement ? document.activeElement : null,
                  header,
                })}
                onReplaceKey={() => setKeyOpen(true)}
                pending={save.isPending}
              />
            </TabsContent>
          </Tabs>
          {saveActions.length > 0 && <StickyActionBar actions={saveActions} status={<span aria-live="polite">{status}</span>} />}
        </form>
      </FormProvider>

      <DirtyGuard
        shouldBlockNavigation={({ current, next }) => shouldBlockAIChannelWorkspaceNavigation(current, next)}
        when={dirty}
      />
      <AIChannelApiKeyDialog
        channel={baseline}
        csrfToken={csrfToken}
        finalFocus={keyTrigger}
        onCanonical={(canonical) => publishCanonical(canonical, 'connection', true)}
        onClose={() => setKeyOpen(false)}
        onReload={onReload}
        open={keyOpen}
      />
      {headerTarget !== undefined && (
        <AIChannelHeaderDialog
          channel={baseline}
          csrfToken={csrfToken}
          finalFocus={() => headerTarget.focusReturn}
          header={headerTarget.header}
          onCanonical={(canonical) => publishCanonical(canonical, 'connection', true)}
          onClose={() => setHeaderTarget(undefined)}
          onReload={onReload}
        />
      )}
    </article>
  );
}

function LoadedAIChannelModelsWorkspace({
  channel,
  channelId,
  csrfToken,
  onConsumersChanged,
  onDeleted,
  onReload,
  onSearchChange,
  search,
}: AIChannelWorkspacePageProps & {
  channel: AIChannel;
  onReload: () => Promise<AIChannel | undefined>;
  search: { tab: 'models' }
    | Extract<AIChannelWorkspaceSearch, { tab: 'usage' }>
    | Extract<AIChannelWorkspaceSearch, { tab: 'logs' }>;
}) {
  const queryClient = useQueryClient();
  const lifecycle = useMutation({
    mutationFn: (command: 'enable-channel' | 'disable-channel' | 'delete-channel') => (
      runAIChannelCommand(command, channel, csrfToken)
    ),
    onSuccess: async (_result, command) => {
      if (command === 'delete-channel') {
        queryClient.removeQueries({ queryKey: aiChannelKeys.detail(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.models(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.usageRoot(channelId) });
        queryClient.removeQueries({ queryKey: aiChannelKeys.logsRoot(channelId) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
          onConsumersChanged('delete'),
        ]);
        await onDeleted();
        return;
      }
      const fresh = await onReload();
      if (!fresh) throw new Error('状态变更后无法读取 AI 渠道');
      queryClient.setQueryData(aiChannelKeys.detail(channelId), fresh);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: aiChannelKeys.models(channelId) }),
        queryClient.invalidateQueries({ queryKey: aiChannelKeys.logsRoot(channelId) }),
        onConsumersChanged('status'),
      ]);
    },
  });

  function handleLifecycle(command: string) {
    if (command === 'enable-channel' || command === 'disable-channel' || command === 'delete-channel') {
      lifecycle.mutate(command);
      return;
    }
    throw new Error(`AI Channel Models Workspace 收到未知命令：${command}`);
  }

  return (
    <article aria-labelledby="ai-channel-workspace-title" className="min-w-0 space-y-4">
      <Link className="inline-flex min-h-8 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" search={{ page: 1, pageSize: 20 }} to="/settings/ai">
        返回 AI 渠道列表
      </Link>
      <AIChannelWorkspaceHeader
        channel={channel}
        onCommand={handleLifecycle}
        onNavigate={(nextTab) => void onSearchChange(aiChannelWorkspaceSearchForTab(nextTab, search))}
        pending={lifecycle.isPending}
      />
      {lifecycle.error && (
        <Notice
          actionLabel={isAIChannelRevisionConflict(lifecycle.error) ? '重新加载渠道' : '关闭'}
          message={errorMessage(lifecycle.error)}
          onAction={() => {
            if (isAIChannelRevisionConflict(lifecycle.error)) void onReload().then(() => lifecycle.reset());
            else lifecycle.reset();
          }}
        />
      )}
      <Tabs onValueChange={(value) => {
        if (!isAIChannelWorkspaceTab(value)) throw new Error(`AI Channel Workspace 收到未知 Tab：${value}`);
        void onSearchChange(aiChannelWorkspaceSearchForTab(value, search));
      }} value={search.tab}>
        <TabsList aria-label="AI 渠道工作区区域" className="max-w-full overflow-x-auto" variant="line">
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="request">请求配置</TabsTrigger>
          <TabsTrigger value="models">模型管理</TabsTrigger>
          <TabsTrigger value="usage">使用统计</TabsTrigger>
          <TabsTrigger value="logs">操作日志</TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          {search.tab === 'models' && <AIChannelModelsSection
            channel={channel}
            csrfToken={csrfToken}
            onConsumersChanged={() => onConsumersChanged('models')}
            onEnableChannel={() => lifecycle.mutate('enable-channel')}
            onViewRuntime={() => onSearchChange(aiChannelWorkspaceSearchForTab('usage', search))}
          />}
        </TabsContent>
        <TabsContent value="usage">
          {search.tab === 'usage' && (
            <AIChannelRuntimeSection
              channelId={channelId}
              onSearchChange={onSearchChange}
              search={search}
            />
          )}
        </TabsContent>
        <TabsContent value="logs">
          {search.tab === 'logs' && (
            <AIChannelRuntimeSection
              channelId={channelId}
              onSearchChange={onSearchChange}
              search={search}
            />
          )}
        </TabsContent>
      </Tabs>
    </article>
  );
}

function AIChannelWorkspaceHeader({
  channel,
  onCommand,
  onNavigate,
  pending,
}: {
  channel: AIChannel;
  onCommand: (command: string) => void;
  onNavigate: (tab: 'basic' | 'models' | 'usage') => void;
  pending: boolean;
}) {
  const capabilities = resolveAIChannelWorkspaceActions(channel);
  const status = channelStatusRegistry[channel.is_enabled ? 'ENABLED' : 'DISABLED'];
  return (
    <header className="grid min-w-0 gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0 space-y-2">
        <p className="type-label text-text-muted">AI Channel Workspace</p>
        <h1 className="break-words type-page-title" id="ai-channel-workspace-title">{channel.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.tone}>{status.label}</Badge>
          <span className="text-sm text-text-secondary">{providerRegistry[channel.provider_brand]}</span>
          <span className="text-sm text-text-muted">revision {channel.revision}</span>
        </div>
      </div>
      <div className="min-w-0 md:min-w-56">
        <RowActions
          objectLabel={channel.name}
          onCommand={(command) => {
            if (command === 'show-basic') onNavigate('basic');
            else if (command === 'show-models') onNavigate('models');
            else if (command === 'show-usage') onNavigate('usage');
            else onCommand(command);
          }}
          overflow={capabilities.overflow.map((action) => ({
            ...action,
            enabled: action.enabled && !pending,
            disabledReason: pending ? '请求正在处理' : action.disabledReason,
          }))}
          primary={{
            ...capabilities.primary,
            enabled: capabilities.primary.enabled && !pending,
            disabledReason: pending ? '请求正在处理' : capabilities.primary.disabledReason,
          }}
        />
      </div>
    </header>
  );
}

function BasicConfigurationSection({ canUpdate, pending }: { canUpdate: boolean; pending: boolean }) {
  const disabled = pending || !canUpdate;
  return (
    <DetailSection description="名称、描述、协议与 Provider 由完整渠道合同统一保存。" title="渠道身份">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField<AIChannelConfigurationFormValues, 'name'> id="ai-channel-name" label="渠道名称" name="name" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={disabled} id={context.inputId} maxLength={160} />} />
        <FormField<AIChannelConfigurationFormValues, 'providerBrand'> id="ai-channel-provider" label="Provider" name="providerBrand" required render={(context) => (
          <Select disabled={disabled} items={providerValues.map((value) => ({ label: providerRegistry[value], value }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
            <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
            <SelectContent>{providerValues.map((value) => <SelectItem key={value} value={value}>{providerRegistry[value]}</SelectItem>)}</SelectContent>
          </Select>
        )} />
        <FormField<AIChannelConfigurationFormValues, 'description'> className="sm:col-span-2" id="ai-channel-description" label="描述" name="description" render={(context) => <Textarea {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={disabled} id={context.inputId} maxLength={500} rows={4} />} />
        <FormField<AIChannelConfigurationFormValues, 'protocolType'> className="sm:col-span-2" description="当前合同只支持 OpenAI-compatible Chat Completions。" id="ai-channel-protocol" label="协议" name="protocolType" required render={(context) => <Input {...context.field} id={context.inputId} readOnly />} />
      </div>
    </DetailSection>
  );
}

function RequestConfigurationSection({
  baseline,
  canCreateHeader,
  canReplaceApiKey,
  canUpdate,
  headerCreateTrigger,
  keyTrigger,
  onCreateHeader,
  onDeleteHeader,
  onEditHeader,
  onReplaceKey,
  pending,
}: {
  baseline: AIChannel;
  canCreateHeader: boolean;
  canReplaceApiKey: boolean;
  canUpdate: boolean;
  headerCreateTrigger: RefObject<HTMLButtonElement | null>;
  keyTrigger: RefObject<HTMLButtonElement | null>;
  onCreateHeader: () => void;
  onDeleteHeader: (header: AIChannelHeader) => void;
  onEditHeader: (header: AIChannelHeader) => void;
  onReplaceKey: () => void;
  pending: boolean;
}) {
  const disabled = pending || !canUpdate;
  return (
    <>
      <DetailSection description="根地址与超时会与基本信息组成同一个完整更新载荷。" title="请求参数">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField<AIChannelConfigurationFormValues, 'baseUrl'> id="ai-channel-base-url" label="API 根地址" name="baseUrl" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={disabled} id={context.inputId} inputMode="url" />} />
          <FormField<AIChannelConfigurationFormValues, 'timeoutSeconds'> id="ai-channel-timeout" label="超时时间（秒）" name="timeoutSeconds" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={disabled} id={context.inputId} max={600} min={10} onChange={(event) => context.field.onChange(event.currentTarget.valueAsNumber)} type="number" />} />
        </div>
      </DetailSection>
      <DetailSection actions={canReplaceApiKey ? <Button onClick={onReplaceKey} ref={keyTrigger} size="sm" type="button" variant="outline">重新配置</Button> : undefined} description="密钥只允许替换，现有值永不回显。" title="API Key">
        <p className="text-sm text-text-secondary">{baseline.api_key_configured ? '已配置（不回显）' : '未配置'}</p>
      </DetailSection>
      <DetailSection actions={canCreateHeader ? <Button onClick={onCreateHeader} ref={headerCreateTrigger} size="sm" type="button">新增 Header</Button> : undefined} description="普通与敏感 Header 都只返回安全元数据；修改时必须提供完整替换值。" title="请求 Header">
        <AIChannelHeaderList headers={baseline.headers} onDelete={onDeleteHeader} onEdit={onEditHeader} />
      </DetailSection>
    </>
  );
}

function AIChannelHeaderList({
  headers,
  onDelete,
  onEdit,
}: {
  headers: AIChannelHeader[];
  onDelete: (header: AIChannelHeader) => void;
  onEdit: (header: AIChannelHeader) => void;
}) {
  if (headers.length === 0) {
    return <p className="rounded-lg border border-dashed border-border-default p-6 text-center text-text-muted">尚未配置请求 Header。</p>;
  }
  return (
    <TableShell regionLabel="请求 Header 列表">
      <thead><tr><th data-column-role="primary" scope="col">名称</th><th className="hidden sm:table-cell" data-column-role="metadata" scope="col">类型</th><th className="hidden sm:table-cell" data-column-role="status" scope="col">配置状态</th><th data-column-role="actions" scope="col">操作</th></tr></thead>
      <tbody>
        {headers.map((header) => {
          const actions = resolveAIChannelHeaderActions(header);
          return (
            <tr key={header.id}>
              <td className="break-all font-mono" data-column-role="primary">{header.name}</td>
              <td className="hidden sm:table-cell" data-column-role="metadata">{header.is_sensitive ? '敏感' : '普通'}</td>
              <td className="hidden sm:table-cell" data-column-role="status">{header.is_configured ? '已配置（不回显）' : '未配置'}</td>
              <td data-column-role="actions"><RowActions
                objectLabel={`Header ${header.name}`}
                onCommand={(command) => {
                  if (command === 'edit-header') onEdit(header);
                  else if (command === 'delete-header') onDelete(header);
                  else throw new Error(`AI Header 行收到未知命令：${command}`);
                }}
                overflow={actions.canDelete ? [{ key: 'DELETE', label: '删除 Header', intent: 'danger', enabled: true, command: 'delete-header', confirmation: { title: `删除 Header“${header.name}”？`, description: '删除后渠道与模型测试状态会失效；此操作不可恢复。', confirmLabel: '删除 Header', intent: 'destructive' } }] : []}
                primary={{ key: header.primary_task, label: actions.primaryLabel, intent: 'primary', enabled: true, command: 'edit-header' }}
              /></td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function AIChannelApiKeyDialog({
  channel,
  csrfToken,
  finalFocus,
  onCanonical,
  onClose,
  onReload,
  open,
}: {
  channel: AIChannel;
  csrfToken: string | null;
  finalFocus: RefObject<HTMLElement | null>;
  onCanonical: (channel: AIChannel) => Promise<void>;
  onClose: () => void;
  onReload: () => Promise<AIChannel | undefined>;
  open: boolean;
}) {
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const form = useForm<AIChannelApiKeyFormValues>({ defaultValues: { apiKey: '' }, resolver: zodResolver(aiChannelApiKeyFormSchema) });
  const replace = useMutation({ gcTime: 0, mutationFn: (values: AIChannelApiKeyFormValues) => replaceAIChannelApiKey(channel, values.apiKey, csrfToken) });

  function reset() { form.reset({ apiKey: '' }); replace.reset(); setError(undefined); setConflict(false); }
  function close() { reset(); onClose(); }
  async function submit(values: AIChannelApiKeyFormValues) {
    setError(undefined);
    try {
      const canonical = await replace.mutateAsync(values);
      reset();
      onClose();
      await onCanonical(canonical);
    } catch (reason) {
      setError(errorMessage(reason));
      setConflict(isAIChannelRevisionConflict(reason));
      form.reset({ apiKey: '' });
      replace.reset();
    }
  }
  async function reload() {
    const fresh = await onReload();
    if (!fresh) { setError('该 AI 渠道已不存在'); return; }
    await onCanonical(fresh);
    reset();
  }
  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && !replace.isPending && close()} open={open}>
      <DialogContent finalFocus={finalFocus} showCloseButton={!replace.isPending}>
        <DialogHeader><DialogTitle>重新配置 API Key</DialogTitle><DialogDescription>原密钥不会回显；保存后渠道与模型测试状态会重置。</DialogDescription></DialogHeader>
        <FormProvider {...form}><form className="space-y-4" id="ai-channel-api-key-form" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={error ? [{ id: 'server', message: error }] : []} />
          {conflict && <Button onClick={() => void reload()} type="button" variant="outline">重新加载服务端版本</Button>}
          <FormField<AIChannelApiKeyFormValues, 'apiKey'> id="ai-channel-api-key" label="新的 API Key" name="apiKey" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoComplete="new-password" autoFocus disabled={replace.isPending || conflict} id={context.inputId} type="password" />} />
        </form></FormProvider>
        <DialogFooter><DialogClose disabled={replace.isPending} render={<Button variant="outline" />}>取消</DialogClose><Button disabled={replace.isPending || conflict} form="ai-channel-api-key-form" type="submit">{replace.isPending ? '保存中…' : '保存新密钥'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AIChannelHeaderDialog({
  channel,
  csrfToken,
  finalFocus,
  header: initialHeader,
  onCanonical,
  onClose,
  onReload,
}: {
  channel: AIChannel;
  csrfToken: string | null;
  finalFocus: () => HTMLElement | null;
  header?: AIChannelHeader;
  onCanonical: (channel: AIChannel) => Promise<void>;
  onClose: () => void;
  onReload: () => Promise<AIChannel | undefined>;
}) {
  const [header, setHeader] = useState(initialHeader);
  const [error, setError] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const form = useForm<AIChannelHeaderFormValues>({ defaultValues: aiChannelHeaderFormValues(header), resolver: zodResolver(aiChannelHeaderFormSchema) });
  const save = useMutation({
    gcTime: 0,
    mutationFn: (values: AIChannelHeaderFormValues) => header
      ? updateAIChannelHeader(channel, header.id, toAIChannelHeaderInput(values), csrfToken)
      : createAIChannelHeader(channel, toAIChannelHeaderInput(values), csrfToken),
  });
  function reset() {
    form.reset(aiChannelHeaderFormValues(header));
    save.reset();
    setError(undefined);
    setRequestId(undefined);
    setConflict(false);
  }
  function close() { reset(); onClose(); }
  async function submit(values: AIChannelHeaderFormValues) {
    setError(undefined);
    setRequestId(undefined);
    form.clearErrors();
    try {
      const canonical = await save.mutateAsync(values);
      reset();
      onClose();
      await onCanonical(canonical);
    } catch (reason) {
      // 失败时也清除本次提交的 Header 值，避免敏感草稿留在表单或 mutation 状态中。
      form.reset({ ...values, value: '' });
      const mapped = mapAIChannelHeaderFormError(reason);
      if (mapped.fields.name) form.setError('name', { type: 'server', message: mapped.fields.name });
      setError(mapped.formMessage);
      setRequestId(mapped.requestId);
      setConflict(mapped.code === 'REVISION_CONFLICT');
      save.reset();
    }
  }
  async function reload() {
    const fresh = await onReload();
    if (!fresh) { setError('该 AI 渠道已不存在'); return; }
    const freshHeader = header ? fresh.headers.find((item) => item.id === header.id) : undefined;
    if (header && !freshHeader) { setError('该 Header 已不存在'); return; }
    setHeader(freshHeader);
    form.reset(aiChannelHeaderFormValues(freshHeader));
    setError(undefined);
    setRequestId(undefined);
    setConflict(false);
    save.reset();
    await onCanonical(fresh);
  }
  return (
    <Dialog onOpenChange={(open) => !open && !save.isPending && close()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!save.isPending}>
        <DialogHeader><DialogTitle>{header ? '编辑 Header' : '新增 Header'}</DialogTitle><DialogDescription>{header?.is_sensitive ? '敏感值不可恢复；请提供完整替换值。' : '现有值不会回显；普通与敏感 Header 都必须提供完整替换值。'}</DialogDescription></DialogHeader>
        <FormProvider {...form}><form className="space-y-4" id="ai-channel-header-form" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={[
            ...(error ? [{ id: 'server', message: error }] : []),
            ...(requestId ? [{ id: 'request', message: `请求 ID：${requestId}` }] : []),
          ]} />
          {conflict && <Button onClick={() => void reload()} type="button" variant="outline">重新加载服务端版本</Button>}
          <FormField<AIChannelHeaderFormValues, 'name'> id="ai-channel-header-name" label="Header 名" name="name" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoFocus disabled={save.isPending || conflict} id={context.inputId} />} />
          <FormField<AIChannelHeaderFormValues, 'value'> description="只存在于本次请求，不会回显。" id="ai-channel-header-value" label="替换值" name="value" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoComplete="new-password" disabled={save.isPending || conflict} id={context.inputId} type="password" />} />
          <FormField<AIChannelHeaderFormValues, 'isSensitive'> id="ai-channel-header-sensitive" label="类型" name="isSensitive" required render={(context) => (
            <Select disabled={save.isPending || conflict} items={[{ value: 'false', label: '普通' }, { value: 'true', label: '敏感且永不回显' }]} onValueChange={(value) => value && context.field.onChange(value === 'true')} value={String(context.field.value)}>
              <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="false">普通</SelectItem><SelectItem value="true">敏感且永不回显</SelectItem></SelectContent>
            </Select>
          )} />
        </form></FormProvider>
        <DialogFooter><DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose><Button disabled={save.isPending || conflict} form="ai-channel-header-form" type="submit">{save.isPending ? '保存中…' : '保存 Header'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AIChannelWorkspaceSkeleton() {
  return <div aria-label="正在加载 AI 渠道工作区" className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
}

function AIChannelWorkspaceFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = aiChannelDetailErrorKind(error);
  const content = {
    'not-found': ['未找到 AI 渠道', '该渠道不存在，或已被删除。'],
    forbidden: ['无权读取 AI 渠道', '当前会话没有读取该渠道的权限。'],
    generic: ['AI 渠道加载失败', errorMessage(error)],
  }[kind];
  return <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-5" role="alert"><h1 className="type-page-title">{content[0]}</h1><p className="text-text-secondary">{content[1]}</p>{kind === 'generic' && <Button onClick={onRetry} variant="outline">重试</Button>}</section>;
}

function Notice({ actionLabel, message, onAction }: { actionLabel: string; message: string; onAction: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><span>{message}</span><Button onClick={onAction} size="sm" variant="outline">{actionLabel}</Button></div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI 渠道工作区发生未知错误';
}

function isAIChannelWorkspaceTab(value: string): value is AIChannelWorkspaceTab {
  return value === 'basic' || value === 'request' || value === 'models' || value === 'usage' || value === 'logs';
}

export { AIChannelWorkspacePage };
export type { AIChannelMutationKind, AIChannelWorkspacePageProps };
