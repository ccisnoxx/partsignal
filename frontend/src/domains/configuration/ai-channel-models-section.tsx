import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TableShell } from '@/design-system/data-table/table-shell';
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
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Textarea } from '@/design-system/primitives/textarea';
import { DetailSection } from '@/design-system/workspace/detail-section';
import type { components } from '@/shared/api/generated/schema';
import {
  aiChannelDetailQueryOptions,
  aiChannelKeys,
  aiChannelModelsQueryOptions,
  createAIModel,
  deleteAIModel,
  discoverAIChannelModels,
  setAIModelEnabled,
  testAIModel,
  updateAIModel,
} from './ai-channel.api';
import {
  aiModelFormSchema,
  aiModelFormValues,
  isAIChannelRevisionConflict,
  mapAIModelFormError,
  resolveAIChannelWorkspaceActions,
  resolveAIModelActions,
  toAIModelCreate,
  toAIModelUpdate,
  type AIChannel,
  type AIModel,
  type AIModelFormValues,
} from './ai-channel-workspace.model';

type DiscoveredModel = components['schemas']['DiscoveredModel'];
type AIModelList = components['schemas']['AIModelList'];

type ModelCommand =
  | 'delete-model'
  | 'disable-model'
  | 'enable-model'
  | 'test-model'
  | 'update-model';

type ModelCommandHold = {
  command: ModelCommand;
  error: unknown;
  modelId: string;
  reloadError?: unknown;
};

type ConsumerRefreshFailure = {
  error: unknown;
  includeConsumers: boolean;
  includeLogs: boolean;
};

type AIChannelModelsSectionProps = {
  channel: AIChannel;
  csrfToken: string | null;
  onConsumersChanged: () => Promise<void>;
  onEnableChannel: () => void;
  onViewRuntime: () => void;
};

type ModelDialogTarget = {
  discoveredModelId?: string;
  focusReturn: HTMLElement | null;
  intentId: number;
  model?: AIModel;
};

type TestModelIntent = {
  focusReturn: HTMLElement | null;
  intentId: number;
  modelId: string;
};

function modelCommandKey(modelId: string, command: ModelCommand) {
  return `${modelId}:${command}`;
}

function AIChannelModelsSection({
  channel,
  csrfToken,
  onConsumersChanged,
  onEnableChannel,
  onViewRuntime,
}: AIChannelModelsSectionProps) {
  const queryClient = useQueryClient();
  const models = useQuery(aiChannelModelsQueryOptions(channel.id));
  const capabilities = resolveAIChannelWorkspaceActions(channel);
  const [dialogTarget, setDialogTarget] = useState<ModelDialogTarget>();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [reloadedDiscoveryChannel, setReloadedDiscoveryChannel] = useState<AIChannel>();
  const [discoveryHold, setDiscoveryHold] = useState<{ error: unknown; reloadError?: unknown }>();
  const [discoveryValidationError, setDiscoveryValidationError] = useState<unknown>();
  const [testTarget, setTestTarget] = useState<TestModelIntent>();
  const [testIntentError, setTestIntentError] = useState<unknown>();
  const [commandHolds, setCommandHolds] = useState<Map<string, ModelCommandHold>>(() => new Map());
  const [consumerRefreshFailure, setConsumerRefreshFailure] = useState<ConsumerRefreshFailure>();
  const [status, setStatus] = useState('');
  const createTrigger = useRef<HTMLButtonElement>(null);
  const discoveryTrigger = useRef<HTMLButtonElement>(null);
  const consumerRefreshEpoch = useRef(0);
  const dialogIntentEpoch = useRef(0);
  const modelCommandIntentEpochs = useRef(new Map<string, number>());
  const activeModelDialogIntent = useRef<number | undefined>(undefined);
  const activeTestDialogIntent = useRef<number | undefined>(undefined);
  const discoveryChannel = reloadedDiscoveryChannel
    && reloadedDiscoveryChannel.id === channel.id
    && reloadedDiscoveryChannel.revision >= channel.revision
    ? reloadedDiscoveryChannel
    : channel;

  function openModelDialog(target: Omit<ModelDialogTarget, 'intentId'>) {
    const intentId = dialogIntentEpoch.current + 1;
    dialogIntentEpoch.current = intentId;
    activeModelDialogIntent.current = intentId;
    if (target.model) {
      modelCommandIntentEpochs.current.set(
        modelCommandKey(target.model.id, 'update-model'),
        intentId,
      );
    }
    setDialogTarget({ ...target, intentId });
  }

  function closeModelDialog(intentId: number) {
    if (activeModelDialogIntent.current !== intentId) return false;
    activeModelDialogIntent.current = undefined;
    setDialogTarget(undefined);
    return true;
  }

  function openTestDialog(target: Omit<TestModelIntent, 'intentId'>) {
    const intentId = dialogIntentEpoch.current + 1;
    dialogIntentEpoch.current = intentId;
    activeTestDialogIntent.current = intentId;
    modelCommandIntentEpochs.current.set(
      modelCommandKey(target.modelId, 'test-model'),
      intentId,
    );
    setTestTarget({ ...target, intentId });
  }

  function recordModelCommandIntent(modelId: string, command: ModelCommand) {
    const intentId = dialogIntentEpoch.current + 1;
    dialogIntentEpoch.current = intentId;
    modelCommandIntentEpochs.current.set(modelCommandKey(modelId, command), intentId);
  }

  function closeTestDialog(intentId: number) {
    if (activeTestDialogIntent.current !== intentId) return false;
    activeTestDialogIntent.current = undefined;
    setTestTarget(undefined);
    return true;
  }

  function upsertCanonicalModel(canonical: AIModel) {
    queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channel.id), (current) => {
      const items = current?.items ?? [];
      const index = items.findIndex((item) => item.id === canonical.id);
      return {
        items: index < 0
          ? [...items, canonical]
          : items.map((item, itemIndex) => itemIndex === index ? canonical : item),
      };
    });
  }

  function removeCanonicalModel(modelId: string) {
    queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channel.id), (current) => current
      ? { items: current.items.filter((item) => item.id !== modelId) }
      : current);
  }

  function holdCommand(modelId: string, command: ModelCommand, error: unknown) {
    const key = modelCommandKey(modelId, command);
    setCommandHolds((current) => {
      const next = new Map(current);
      next.set(key, { command, error, modelId });
      return next;
    });
  }

  async function refreshModelConsumers(
    includeConsumers: boolean,
    includeLogs: boolean,
    continuation = capturePrincipalContinuation(queryClient),
  ) {
    if (!continuation.isCurrent()) return;
    const epoch = consumerRefreshEpoch.current + 1;
    consumerRefreshEpoch.current = epoch;
    setConsumerRefreshFailure(undefined);
    const tasks = [
      models.refetch(),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.detail(channel.id) }),
      includeLogs
        ? queryClient.invalidateQueries({ queryKey: aiChannelKeys.logsRoot(channel.id) })
        : Promise.resolve(),
      includeConsumers ? onConsumersChanged() : Promise.resolve(),
    ] as const;
    const results = await Promise.allSettled(tasks);
    if (!continuation.isCurrent()) return;
    const modelsResult = results[0];
    const failure = modelsResult.status === 'fulfilled' && modelsResult.value.error
      ? modelsResult.value.error
      : results.find((result) => result.status === 'rejected')?.reason;
    if (consumerRefreshEpoch.current !== epoch) return;
    if (failure) {
      setConsumerRefreshFailure({ error: failure, includeConsumers, includeLogs });
    }
  }

  function publishCanonicalModel(
    canonical: AIModel,
    message: string,
    includeConsumers: boolean,
    includeLogs: boolean,
    continuation: PrincipalContinuation,
  ) {
    if (!continuation.isCurrent()) return;
    upsertCanonicalModel(canonical);
    setStatus(message);
    void refreshModelConsumers(includeConsumers, includeLogs, continuation);
  }

  async function reloadModelsForHold(
    modelId: string,
    command: ModelCommand,
    canReleaseHold: () => boolean = () => true,
  ) {
    const continuation = capturePrincipalContinuation(queryClient);
    const key = modelCommandKey(modelId, command);
    const result = await models.refetch({ cancelRefetch: true });
    if (!continuation.isCurrent()) return false;
    if (!canReleaseHold()) return false;
    if (result.error || !result.data) {
      const error = result.error ?? new Error('重新加载模型列表未返回数据');
      setCommandHolds((current) => {
        const hold = current.get(key);
        if (!hold) return current;
        const next = new Map(current);
        next.set(key, { ...hold, reloadError: error });
        return next;
      });
      return false;
    }
    setCommandHolds((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    return true;
  }

  async function reloadModelsForNotice(modelId: string, command: ModelCommand) {
    const key = modelCommandKey(modelId, command);
    const intentEpoch = modelCommandIntentEpochs.current.get(key);
    return reloadModelsForHold(
      modelId,
      command,
      () => modelCommandIntentEpochs.current.get(key) === intentEpoch,
    );
  }

  async function reloadDiscoveryChannel() {
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await queryClient.cancelQueries({ exact: true, queryKey: aiChannelKeys.detail(channel.id) });
      const fresh = await queryClient.fetchQuery({
        ...aiChannelDetailQueryOptions(channel.id),
        staleTime: 0,
      });
      if (!continuation.isCurrent()) return;
      setReloadedDiscoveryChannel(fresh);
      setDiscoveryHold(undefined);
      discovery.reset();
      setDiscovered([]);
      setDiscoveryOpen(false);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setDiscoveryHold((current) => current ? { ...current, reloadError: error } : current);
    }
  }

  const discovery = useMutation({
    mutationFn: async () => {
      const continuation = capturePrincipalContinuation(queryClient);
      const result = await discoverAIChannelModels(discoveryChannel, csrfToken);
      validateDiscoveredModels(result.items);
      return { continuation, result };
    },
    onSuccess: ({ continuation, result }) => {
      if (!continuation.isCurrent()) return;
      setDiscovered(result.items);
    },
    onError: (error) => {
      if (isAIChannelRevisionConflict(error)) setDiscoveryHold({ error });
    },
  });
  const test = useMutation({
    mutationFn: async ({ model }: { focusReturn: HTMLElement | null; intentId: number; model: AIModel }) => {
      const continuation = capturePrincipalContinuation(queryClient);
      const tested = await testAIModel(model, csrfToken);
      return { continuation, tested };
    },
    onSuccess: ({ continuation, tested }, variables) => {
      if (!continuation.isCurrent()) return;
      publishCanonicalModel(tested, tested.test_status === 'PASSED'
        ? '连接测试通过；模型仍保持停用，请按需手动启用。'
        : `连接测试失败：${tested.last_test_error_summary ?? '未返回失败摘要'}`, false, false, continuation);
      if (closeTestDialog(variables.intentId)) {
        setTestIntentError(undefined);
        queueMicrotask(() => {
          if (continuation.isCurrent()) variables.focusReturn?.focus();
        });
      }
    },
    onError: (error, variables) => {
      if (isAIChannelRevisionConflict(error)) holdCommand(variables.model.id, 'test-model', error);
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ enabled, model }: { enabled: boolean; model: AIModel }) => {
      const continuation = capturePrincipalContinuation(queryClient);
      const updated = await setAIModelEnabled(model, enabled, csrfToken);
      return { continuation, updated };
    },
    onSuccess: ({ continuation, updated }) => {
      if (!continuation.isCurrent()) return;
      publishCanonicalModel(updated, updated.is_enabled ? '模型已启用' : '模型已停用', true, true, continuation);
    },
    onError: (error, variables) => {
      if (isAIChannelRevisionConflict(error)) {
        holdCommand(variables.model.id, variables.enabled ? 'enable-model' : 'disable-model', error);
      }
    },
  });
  const remove = useMutation({
    mutationFn: async (model: AIModel) => {
      const continuation = capturePrincipalContinuation(queryClient);
      const result = await deleteAIModel(model, csrfToken);
      return { continuation, result };
    },
    onSuccess: ({ continuation }, model) => {
      if (!continuation.isCurrent()) return;
      removeCanonicalModel(model.id);
      setStatus('模型已删除');
      void refreshModelConsumers(true, true, continuation);
    },
    onError: (error, model) => {
      if (isAIChannelRevisionConflict(error)) holdCommand(model.id, 'delete-model', error);
    },
  });
  const commandError = [test.error, toggle.error, remove.error]
    .find((error) => error && !isAIChannelRevisionConflict(error));
  const commandPending = test.isPending || toggle.isPending || remove.isPending;

  function handleModelCommand(model: AIModel, command: string, focusReturn?: HTMLElement | null) {
    if (command === 'edit-model') {
      openModelDialog({ focusReturn: focusReturn ?? document.activeElement as HTMLElement | null, model });
    } else if (command === 'test-model') {
      openTestDialog({
        focusReturn: focusReturn ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
        modelId: model.id,
      });
      setTestIntentError(undefined);
    } else if (command === 'enable-model' || command === 'disable-model') {
      if (commandHolds.has(modelCommandKey(model.id, command))) return;
      recordModelCommandIntent(model.id, command);
      toggle.mutate({ enabled: command === 'enable-model', model });
    } else if (command === 'delete-model') {
      if (commandHolds.has(modelCommandKey(model.id, command))) return;
      recordModelCommandIntent(model.id, command);
      remove.mutate(model);
    } else if (command === 'enable-channel') {
      onEnableChannel();
    } else if (command === 'view-runtime') {
      onViewRuntime();
    } else {
      throw new Error(`AI 模型行收到未知命令：${command}`);
    }
  }

  return (
    <div className="space-y-4">
      {commandError && (
        <ModelNotice
          actionLabel="关闭"
          message={errorMessage(commandError)}
          onAction={() => { test.reset(); toggle.reset(); remove.reset(); }}
        />
      )}
      {[...commandHolds.entries()].map(([key, hold]) => (
        <ModelNotice
          actionLabel="重新加载模型列表"
          key={key}
          message={`${modelCommandLabel(hold.command)}“${models.data?.items.find((item) => item.id === hold.modelId)?.display_name ?? hold.modelId}”发生 revision 冲突：${errorMessage(hold.reloadError ?? hold.error)}`}
          onAction={() => void reloadModelsForNotice(hold.modelId, hold.command)}
        />
      ))}
      {consumerRefreshFailure && (
        <ModelNotice
          actionLabel="重试刷新"
          message={`模型命令已完成，但页面刷新失败：${errorMessage(consumerRefreshFailure.error)}`}
          onAction={() => void refreshModelConsumers(
            consumerRefreshFailure.includeConsumers,
            consumerRefreshFailure.includeLogs,
          )}
        />
      )}
      {models.data && models.error && !consumerRefreshFailure && (
        <ModelNotice actionLabel="重试刷新" message={`模型列表刷新失败：${errorMessage(models.error)}`} onAction={() => void models.refetch()} />
      )}
      <DetailSection
        actions={(capabilities.canDiscoverModels || capabilities.canCreateModel) ? (
          <div className="flex flex-wrap gap-2">
            {capabilities.canDiscoverModels && <Button disabled={discovery.isPending} onClick={() => {
              setDiscoveryOpen(true);
              setDiscoveryValidationError(undefined);
              if (!discoveryHold) {
                setDiscovered([]);
                discovery.mutate();
              }
            }} ref={discoveryTrigger} type="button" variant="outline">{discovery.isPending ? '发现中…' : '发现模型'}</Button>}
            {capabilities.canCreateModel && <Button onClick={() => openModelDialog({ focusReturn: createTrigger.current })} ref={createTrigger} type="button">手工新增</Button>}
          </div>
        ) : undefined}
        description="模型命令只使用服务端当前 revision 与 action projection；测试会触发一次真实 Provider 请求。"
        title="模型管理"
      >
        {status && <p aria-live="polite" className="mb-3 text-sm text-text-secondary">{status}</p>}
        {models.isPending ? (
          <div aria-label="正在加载模型列表" className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : !models.data ? (
          <ModelNotice actionLabel="重试" message={errorMessage(models.error)} onAction={() => void models.refetch()} />
        ) : models.data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default p-6 text-center text-text-muted">尚未配置模型。可手工新增，或从远端发现后选择添加。</p>
        ) : (
          <TableShell regionLabel="AI 模型列表">
            <thead><tr><th data-column-role="primary" scope="col">模型</th><th className="hidden md:table-cell" data-column-role="status" scope="col">阶段</th><th className="hidden lg:table-cell" data-column-role="metadata" scope="col">最近测试</th><th data-column-role="status" scope="col">状态</th><th data-column-role="actions" scope="col">操作</th></tr></thead>
            <tbody>
              {models.data.items.map((model) => {
                const actions = resolveAIModelActions(model);
                const resolveAvailability = <Action extends { command?: string; disabledReason?: string; enabled: boolean },>(action: Action): Action => {
                  const holdCommand = action.command ? modelCommandForAction(action.command) : undefined;
                  const held = holdCommand ? commandHolds.has(modelCommandKey(model.id, holdCommand)) : false;
                  const canReopenHeldDialog = action.command === 'edit-model' || action.command === 'test-model';
                  const disabled = commandPending || (held && !canReopenHeldDialog);
                  return {
                    ...action,
                    enabled: action.enabled && !disabled,
                    disabledReason: disabled
                      ? (held ? '请先重新加载该模型投影' : '请求正在处理')
                      : action.disabledReason,
                  };
                };
                return (
                  <tr id={`ai-model-${model.id}`} key={model.id} tabIndex={-1}>
                    <td className="min-w-44" data-column-role="primary"><strong className="block break-words">{model.display_name}</strong><span className="block break-all font-mono text-xs text-text-muted">{model.model_id}</span><span className="mt-1 block text-xs text-text-secondary md:hidden">{model.workflow_stage} · {model.test_status}</span></td>
                    <td className="hidden md:table-cell" data-column-role="status">{model.workflow_stage}</td>
                    <td className="hidden max-w-72 lg:table-cell" data-column-role="metadata"><span className="block">{model.last_tested_at ? new Date(model.last_tested_at).toLocaleString('zh-CN') : '尚未测试'}</span>{model.last_test_error_summary && <span className="block break-words text-xs text-destructive">{model.last_test_error_summary}</span>}</td>
                    <td data-column-role="status"><Badge variant={model.is_enabled ? 'success' : 'secondary'}>{model.is_enabled ? '已启用' : '已停用'}</Badge></td>
                    <td data-column-role="actions"><RowActions
                      objectLabel={`模型 ${model.display_name}`}
                      onCommand={(command, focusReturn) => handleModelCommand(model, command, focusReturn)}
                      overflow={actions.overflow.map(resolveAvailability)}
                      primary={resolveAvailability(actions.primary)}
                    /></td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </DetailSection>

      <DiscoverModelsDialog
        discovered={discovered}
        error={discoveryValidationError ?? discoveryHold?.error ?? discovery.error}
        finalFocus={discoveryTrigger}
        onAdd={(modelId) => { setDiscoveryOpen(false); openModelDialog({ discoveredModelId: modelId, focusReturn: discoveryTrigger.current }); }}
        onClose={() => { setDiscoveryOpen(false); discovery.reset(); setDiscovered([]); setDiscoveryValidationError(undefined); }}
        onLocate={(modelId) => {
          const configured = models.data?.items.find((item) => item.model_id === modelId);
          if (!configured) {
            setDiscoveryValidationError(new Error(`远端将 ${modelId} 标记为已配置，但当前模型列表中不存在该模型`));
            return;
          }
          const row = configured ? document.getElementById(`ai-model-${configured.id}`) : null;
          row?.scrollIntoView({ block: 'center' });
          row?.focus();
          setDiscoveryOpen(false);
        }}
        onReload={() => reloadDiscoveryChannel()}
        open={discoveryOpen}
        pending={discovery.isPending}
        reloadError={discoveryHold?.reloadError}
        revisionConflict={Boolean(discoveryHold)}
      />
      {dialogTarget && (
        <AIModelDialog
          channelId={channel.id}
          csrfToken={csrfToken}
          finalFocus={() => dialogTarget.focusReturn}
          initialValues={aiModelFormValues(dialogTarget.model, dialogTarget.discoveredModelId)}
          hold={dialogTarget.model
            ? commandHolds.get(modelCommandKey(dialogTarget.model.id, 'update-model'))
            : undefined}
          key={dialogTarget.intentId}
          model={dialogTarget.model}
          onClose={() => { closeModelDialog(dialogTarget.intentId); }}
          onConflict={(modelId, error) => holdCommand(modelId, 'update-model', error)}
          onReload={async () => {
            if (!dialogTarget.model) return;
            if (await reloadModelsForHold(
              dialogTarget.model.id,
              'update-model',
              () => activeModelDialogIntent.current === dialogTarget.intentId,
            )) {
              closeModelDialog(dialogTarget.intentId);
            }
          }}
          onSaved={(canonical, kind, continuation) => {
            publishCanonicalModel(
              canonical,
              kind === 'create' ? '模型已创建' : '模型配置已保存',
              kind === 'update',
              true,
              continuation,
            );
            closeModelDialog(dialogTarget.intentId);
          }}
        />
      )}
      {testTarget && (
        <TestModelDialog
          error={testIntentError
            ?? commandHolds.get(modelCommandKey(testTarget.modelId, 'test-model'))?.reloadError
            ?? commandHolds.get(modelCommandKey(testTarget.modelId, 'test-model'))?.error
            ?? test.error}
          finalFocus={() => testTarget.focusReturn}
          key={testTarget.intentId}
          model={models.data?.items.find((item) => item.id === testTarget.modelId)}
          onClose={() => {
            if (!test.isPending && closeTestDialog(testTarget.intentId)) {
              setTestIntentError(undefined);
              test.reset();
            }
          }}
          onConfirm={() => {
            const exact = queryClient.getQueryData<AIModelList>(aiChannelKeys.models(channel.id));
            const current = exact?.items.find((item) => item.id === testTarget.modelId);
            if (!current) {
              setTestIntentError(new Error('目标模型已不存在，请关闭确认框后检查最新列表'));
              return;
            }
            if (!(current.available_actions as string[]).includes('TEST')) {
              setTestIntentError(new Error('服务端最新投影已撤销 TEST 动作，本次未发送测试请求'));
              return;
            }
            if (commandHolds.has(modelCommandKey(current.id, 'test-model'))) return;
            test.mutate({ model: current, focusReturn: testTarget.focusReturn, intentId: testTarget.intentId });
          }}
          onReload={async () => {
            if (await reloadModelsForHold(
              testTarget.modelId,
              'test-model',
              () => activeTestDialogIntent.current === testTarget.intentId,
            )) {
              if (closeTestDialog(testTarget.intentId)) {
                setTestIntentError(undefined);
                test.reset();
              }
            }
          }}
          pending={test.isPending}
          revisionConflict={commandHolds.has(modelCommandKey(testTarget.modelId, 'test-model'))}
        />
      )}
    </div>
  );
}

function AIModelDialog({
  channelId,
  csrfToken,
  finalFocus,
  hold,
  initialValues,
  model,
  onClose,
  onConflict,
  onReload,
  onSaved,
}: {
  channelId: string;
  csrfToken: string | null;
  finalFocus: () => HTMLElement | null;
  hold?: ModelCommandHold;
  initialValues: AIModelFormValues;
  model?: AIModel;
  onClose: () => void;
  onConflict: (modelId: string, error: unknown) => void;
  onReload: () => Promise<void>;
  onSaved: (
    canonical: AIModel,
    kind: 'create' | 'update',
    continuation: PrincipalContinuation,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<AIModelFormValues>({ defaultValues: initialValues, resolver: zodResolver(aiModelFormSchema) });
  const save = useMutation({
    mutationFn: (values: AIModelFormValues) => model
      ? updateAIModel(model.id, toAIModelUpdate(values, model.revision), csrfToken)
      : createAIModel(channelId, toAIModelCreate(values), csrfToken),
  });
  const projectedError = hold?.reloadError ?? hold?.error ?? save.error;
  const conflict = Boolean(hold) || isAIChannelRevisionConflict(save.error);
  const errorProjection = projectedError ? mapAIModelFormError(projectedError) : { fields: {} };
  async function submit(values: AIModelFormValues) {
    form.clearErrors();
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const canonical = await save.mutateAsync(values);
      if (!continuation.isCurrent()) return;
      onSaved(canonical, model ? 'update' : 'create', continuation);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      if (model && isAIChannelRevisionConflict(error)) onConflict(model.id, error);
      const mapped = mapAIModelFormError(error);
      if (mapped.fields.modelId) {
        form.setError('modelId', { type: 'server', message: mapped.fields.modelId });
      }
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && !save.isPending && onClose()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!save.isPending}>
        <DialogHeader><DialogTitle>{model ? '编辑模型' : '新增模型'}</DialogTitle><DialogDescription>请求参数只接受 JSON 对象；model、messages 与 stream 由服务端管理。</DialogDescription></DialogHeader>
        <FormProvider {...form}><form className="space-y-4" id="ai-model-form" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={[
            ...(errorProjection.formMessage ? [{ id: 'server', message: errorProjection.formMessage }] : []),
            ...(errorProjection.requestId ? [{ id: 'request', message: `请求 ID：${errorProjection.requestId}` }] : []),
          ]} />
          {conflict && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载模型列表</Button>}
          <FormField<AIModelFormValues, 'displayName'> id="ai-model-display-name" label="显示名称" name="displayName" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} autoFocus disabled={save.isPending || conflict} id={context.inputId} />} />
          <FormField<AIModelFormValues, 'modelId'> id="ai-model-id" label="Model ID" name="modelId" required render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={save.isPending || conflict} id={context.inputId} />} />
          <FormField<AIModelFormValues, 'requestParametersJson'> description={'例如：{"temperature": 0.2}'} id="ai-model-parameters" label="请求参数 JSON" name="requestParametersJson" required render={(context) => <Textarea {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} className="min-h-36 font-mono" disabled={save.isPending || conflict} id={context.inputId} spellCheck={false} />} />
        </form></FormProvider>
        <DialogFooter><DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose><Button disabled={save.isPending || conflict} form="ai-model-form" type="submit">{save.isPending ? '保存中…' : '保存模型'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscoverModelsDialog({
  discovered,
  error,
  finalFocus,
  onAdd,
  onClose,
  onLocate,
  onReload,
  open,
  pending,
  reloadError,
  revisionConflict,
}: {
  discovered: DiscoveredModel[];
  error: unknown;
  finalFocus: { current: HTMLElement | null };
  onAdd: (modelId: string) => void;
  onClose: () => void;
  onLocate: (modelId: string) => void;
  onReload: () => Promise<void>;
  open: boolean;
  pending: boolean;
  reloadError?: unknown;
  revisionConflict: boolean;
}) {
  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()} open={open}>
      <DialogContent finalFocus={finalFocus} showCloseButton={!pending}>
        <DialogHeader><DialogTitle>发现远端模型</DialogTitle><DialogDescription>本操作会向当前 Provider 发送一次真实模型列表请求，但不会自动创建或测试模型。</DialogDescription></DialogHeader>
        {Boolean(error) && <ErrorSummary errors={[{ id: 'server', message: errorMessage(error) }]} />}
        {Boolean(reloadError) && <ErrorSummary errors={[{ id: 'reload', message: `渠道重新加载失败：${errorMessage(reloadError)}` }]} />}
        {revisionConflict && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载渠道</Button>}
        {pending ? <Skeleton className="h-32" /> : discovered.length === 0 && !error ? <p className="text-sm text-text-muted">远端未返回模型。</p> : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {discovered.map((item) => {
              const action = resolveDiscoveredModelAction(item, onAdd, onLocate);
              return <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3" key={item.model_id}><code className="min-w-0 break-all text-sm">{item.model_id}</code><Button onClick={action.onClick} size="sm" type="button" variant={action.variant}>{action.label}</Button></div>;
            })}
          </div>
        )}
        <DialogFooter><DialogClose disabled={pending} render={<Button variant="outline" />}>关闭</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestModelDialog({ error, finalFocus, model, onClose, onConfirm, onReload, pending, revisionConflict }: {
  error: unknown;
  finalFocus: () => HTMLElement | null;
  model?: AIModel;
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => Promise<void>;
  pending: boolean;
  revisionConflict: boolean;
}) {
  const conflict = revisionConflict || isAIChannelRevisionConflict(error);
  return (
    <Dialog onOpenChange={(open) => !open && !pending && onClose()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!pending}>
        <DialogHeader><DialogTitle>{model ? `测试模型“${model.display_name}”？` : '测试模型？'}</DialogTitle><DialogDescription>服务端会用当前渠道真实配置发送一条“hi”，可能产生外部调用费用；每次确认只发送一次，完成后模型仍保持停用。</DialogDescription></DialogHeader>
        {model?.last_test_error_summary && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">最近失败：{model.last_test_error_summary}</p>}
        {Boolean(error) && <ErrorSummary errors={[{ id: 'server', message: errorMessage(error) }]} />}
        {conflict && <Button onClick={() => void onReload()} type="button" variant="outline">重新加载模型列表</Button>}
        <DialogFooter><DialogClose disabled={pending} render={<Button variant="outline" />}>取消</DialogClose><Button disabled={pending || conflict} onClick={onConfirm} type="button">{pending ? '测试中…' : '开始测试'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelNotice({ actionLabel, message, onAction }: { actionLabel: string; message: string; onAction: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><span>{message}</span><Button onClick={onAction} size="sm" variant="outline">{actionLabel}</Button></div>;
}

function modelCommandForAction(command: string): ModelCommand | undefined {
  if (command === 'edit-model') return 'update-model';
  if (
    command === 'delete-model'
    || command === 'disable-model'
    || command === 'enable-model'
    || command === 'test-model'
  ) return command;
  return undefined;
}

function modelCommandLabel(command: ModelCommand) {
  if (command === 'update-model') return '更新模型';
  if (command === 'test-model') return '测试模型';
  if (command === 'enable-model') return '启用模型';
  if (command === 'disable-model') return '停用模型';
  return '删除模型';
}

function validateDiscoveredModels(items: DiscoveredModel[]) {
  for (const item of items) {
    const primaryTask = item.primary_task as string;
    if (primaryTask === 'ADD_MODEL') {
      if (item.configured) throw new Error(`远端模型 ${item.model_id} 的 ADD_MODEL 与 configured=true 矛盾`);
    } else if (primaryTask === 'VIEW_CONFIGURED_MODEL') {
      if (!item.configured) throw new Error(`远端模型 ${item.model_id} 的 VIEW_CONFIGURED_MODEL 与 configured=false 矛盾`);
    } else {
      throw new Error(`远端模型 ${item.model_id} 返回未知主任务：${primaryTask}`);
    }
  }
}

function resolveDiscoveredModelAction(
  item: DiscoveredModel,
  onAdd: (modelId: string) => void,
  onLocate: (modelId: string) => void,
) {
  const primaryTask = item.primary_task as string;
  if (primaryTask === 'ADD_MODEL' && !item.configured) {
    return { label: '添加', onClick: () => onAdd(item.model_id), variant: 'default' as const };
  }
  if (primaryTask === 'VIEW_CONFIGURED_MODEL' && item.configured) {
    return { label: '查看已配置', onClick: () => onLocate(item.model_id), variant: 'outline' as const };
  }
  if (primaryTask === 'ADD_MODEL' || primaryTask === 'VIEW_CONFIGURED_MODEL') {
    throw new Error(`远端模型 ${item.model_id} 的 ${primaryTask} 与 configured=${String(item.configured)} 矛盾`);
  }
  throw new Error(`远端模型 ${item.model_id} 返回未知主任务：${primaryTask}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI 模型操作发生未知错误';
}

export { AIChannelModelsSection };
export type { AIChannelModelsSectionProps };
