import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

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
  resolveAIChannelWorkspaceActions,
  resolveAIModelActions,
  toAIModelCreate,
  toAIModelUpdate,
  type AIChannel,
  type AIModel,
  type AIModelFormValues,
} from './ai-channel-workspace.model';

type DiscoveredModel = components['schemas']['DiscoveredModel'];

type AIChannelModelsSectionProps = {
  channel: AIChannel;
  csrfToken: string | null;
  onConsumersChanged: () => Promise<void>;
  onEnableChannel: () => void;
};

type ModelDialogTarget = {
  discoveredModelId?: string;
  focusReturn: HTMLElement | null;
  model?: AIModel;
};

function AIChannelModelsSection({
  channel,
  csrfToken,
  onConsumersChanged,
  onEnableChannel,
}: AIChannelModelsSectionProps) {
  const queryClient = useQueryClient();
  const models = useQuery(aiChannelModelsQueryOptions(channel.id));
  const capabilities = resolveAIChannelWorkspaceActions(channel);
  const [dialogTarget, setDialogTarget] = useState<ModelDialogTarget>();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [testTarget, setTestTarget] = useState<{ focusReturn: HTMLElement | null; model: AIModel }>();
  const [status, setStatus] = useState('');
  const createTrigger = useRef<HTMLButtonElement>(null);
  const discoveryTrigger = useRef<HTMLButtonElement>(null);

  async function invalidateModelState(includeConsumers: boolean, includeLogs: boolean) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.detail(channel.id) }),
      queryClient.invalidateQueries({ queryKey: aiChannelKeys.models(channel.id) }),
      includeLogs
        ? queryClient.invalidateQueries({ queryKey: aiChannelKeys.logs(channel.id) })
        : Promise.resolve(),
      includeConsumers ? onConsumersChanged() : Promise.resolve(),
    ]);
  }

  const discovery = useMutation({
    mutationFn: () => discoverAIChannelModels(channel, csrfToken),
    onSuccess: (result) => setDiscovered(result.items),
  });
  const test = useMutation({
    mutationFn: (model: AIModel) => testAIModel(model, csrfToken),
    onSuccess: async (tested) => {
      setStatus(tested.test_status === 'PASSED'
        ? '连接测试通过；模型仍保持停用，请按需手动启用。'
        : `连接测试失败：${tested.last_test_error_summary ?? '未返回失败摘要'}`);
      const focusReturn = testTarget?.focusReturn;
      setTestTarget(undefined);
      queueMicrotask(() => focusReturn?.focus());
      await invalidateModelState(false, false);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ enabled, model }: { enabled: boolean; model: AIModel }) => (
      setAIModelEnabled(model, enabled, csrfToken)
    ),
    onSuccess: async (updated) => {
      setStatus(updated.is_enabled ? '模型已启用' : '模型已停用');
      await invalidateModelState(true, true);
    },
  });
  const remove = useMutation({
    mutationFn: (model: AIModel) => deleteAIModel(model, csrfToken),
    onSuccess: async () => {
      setStatus('模型已删除');
      await invalidateModelState(true, true);
    },
  });
  const commandError = test.error ?? toggle.error ?? remove.error;
  const commandPending = test.isPending || toggle.isPending || remove.isPending;

  async function reloadModels() {
    await models.refetch();
    test.reset();
    toggle.reset();
    remove.reset();
  }

  function handleModelCommand(model: AIModel, command: string, focusReturn?: HTMLElement | null) {
    if (command === 'edit-model') {
      setDialogTarget({ focusReturn: focusReturn ?? document.activeElement as HTMLElement | null, model });
    } else if (command === 'test-model') {
      setTestTarget({
        focusReturn: focusReturn ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
        model,
      });
    } else if (command === 'enable-model' || command === 'disable-model') {
      toggle.mutate({ enabled: command === 'enable-model', model });
    } else if (command === 'delete-model') {
      remove.mutate(model);
    } else if (command === 'enable-channel') {
      onEnableChannel();
    } else {
      throw new Error(`AI 模型行收到未知命令：${command}`);
    }
  }

  return (
    <div className="space-y-4">
      {commandError && (
        <ModelNotice
          actionLabel={isAIChannelRevisionConflict(commandError) ? '重新加载模型列表' : '关闭'}
          message={errorMessage(commandError)}
          onAction={() => isAIChannelRevisionConflict(commandError) ? void reloadModels() : (test.reset(), toggle.reset(), remove.reset())}
        />
      )}
      {models.data && models.error && (
        <ModelNotice actionLabel="重试刷新" message={`模型列表刷新失败：${errorMessage(models.error)}`} onAction={() => void models.refetch()} />
      )}
      <DetailSection
        actions={(capabilities.canDiscoverModels || capabilities.canCreateModel) ? (
          <div className="flex flex-wrap gap-2">
            {capabilities.canDiscoverModels && <Button disabled={discovery.isPending} onClick={() => { setDiscoveryOpen(true); setDiscovered([]); discovery.mutate(); }} ref={discoveryTrigger} type="button" variant="outline">{discovery.isPending ? '发现中…' : '发现模型'}</Button>}
            {capabilities.canCreateModel && <Button onClick={() => setDialogTarget({ focusReturn: createTrigger.current })} ref={createTrigger} type="button">手工新增</Button>}
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
                return (
                  <tr id={`ai-model-${model.id}`} key={model.id} tabIndex={-1}>
                    <td className="min-w-44" data-column-role="primary"><strong className="block break-words">{model.display_name}</strong><span className="block break-all font-mono text-xs text-text-muted">{model.model_id}</span><span className="mt-1 block text-xs text-text-secondary md:hidden">{model.workflow_stage} · {model.test_status}</span></td>
                    <td className="hidden md:table-cell" data-column-role="status">{model.workflow_stage}</td>
                    <td className="hidden max-w-72 lg:table-cell" data-column-role="metadata"><span className="block">{model.last_tested_at ? new Date(model.last_tested_at).toLocaleString('zh-CN') : '尚未测试'}</span>{model.last_test_error_summary && <span className="block break-words text-xs text-destructive">{model.last_test_error_summary}</span>}</td>
                    <td data-column-role="status"><Badge variant={model.is_enabled ? 'success' : 'secondary'}>{model.is_enabled ? '已启用' : '已停用'}</Badge></td>
                    <td data-column-role="actions"><RowActions
                      objectLabel={`模型 ${model.display_name}`}
                      onCommand={(command, focusReturn) => handleModelCommand(model, command, focusReturn)}
                      overflow={actions.overflow.map((action) => ({ ...action, enabled: action.enabled && !commandPending, disabledReason: commandPending ? '请求正在处理' : action.disabledReason }))}
                      primary={{ ...actions.primary, enabled: actions.primary.enabled && !commandPending, disabledReason: commandPending ? '请求正在处理' : actions.primary.disabledReason }}
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
        error={discovery.error}
        finalFocus={discoveryTrigger}
        onAdd={(modelId) => { setDiscoveryOpen(false); setDialogTarget({ discoveredModelId: modelId, focusReturn: discoveryTrigger.current }); }}
        onClose={() => { setDiscoveryOpen(false); discovery.reset(); setDiscovered([]); }}
        onLocate={(modelId) => {
          const configured = models.data?.items.find((item) => item.model_id === modelId);
          const row = configured ? document.getElementById(`ai-model-${configured.id}`) : null;
          row?.scrollIntoView({ block: 'center' });
          row?.focus();
          setDiscoveryOpen(false);
        }}
        open={discoveryOpen}
        pending={discovery.isPending}
      />
      {dialogTarget && (
        <AIModelDialog
          channelId={channel.id}
          csrfToken={csrfToken}
          finalFocus={() => dialogTarget.focusReturn}
          initialValues={aiModelFormValues(dialogTarget.model, dialogTarget.discoveredModelId)}
          model={dialogTarget.model}
          onClose={() => setDialogTarget(undefined)}
          onReload={async () => { await models.refetch(); setDialogTarget(undefined); }}
          onSaved={async (kind) => {
            setDialogTarget(undefined);
            setStatus(kind === 'create' ? '模型已创建' : '模型配置已保存');
            await invalidateModelState(kind === 'update', true);
          }}
        />
      )}
      {testTarget && (
        <TestModelDialog
          error={test.error}
          finalFocus={() => testTarget.focusReturn}
          model={testTarget.model}
          onClose={() => { if (!test.isPending) { setTestTarget(undefined); test.reset(); } }}
          onConfirm={() => test.mutate(testTarget.model)}
          onReload={async () => { await reloadModels(); setTestTarget(undefined); }}
          pending={test.isPending}
        />
      )}
    </div>
  );
}

function AIModelDialog({
  channelId,
  csrfToken,
  finalFocus,
  initialValues,
  model,
  onClose,
  onReload,
  onSaved,
}: {
  channelId: string;
  csrfToken: string | null;
  finalFocus: () => HTMLElement | null;
  initialValues: AIModelFormValues;
  model?: AIModel;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: (kind: 'create' | 'update') => Promise<void>;
}) {
  const form = useForm<AIModelFormValues>({ defaultValues: initialValues, resolver: zodResolver(aiModelFormSchema) });
  const save = useMutation({
    mutationFn: (values: AIModelFormValues) => model
      ? updateAIModel(model.id, toAIModelUpdate(values, model.revision), csrfToken)
      : createAIModel(channelId, toAIModelCreate(values), csrfToken),
  });
  const conflict = isAIChannelRevisionConflict(save.error);
  async function submit(values: AIModelFormValues) {
    try {
      await save.mutateAsync(values);
      await onSaved(model ? 'update' : 'create');
    } catch {
      // mutation.error 在当前 Dialog 内展示；冲突时保留草稿并锁定旧 revision。
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && !save.isPending && onClose()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!save.isPending}>
        <DialogHeader><DialogTitle>{model ? '编辑模型' : '新增模型'}</DialogTitle><DialogDescription>请求参数只接受 JSON 对象；model、messages 与 stream 由服务端管理。</DialogDescription></DialogHeader>
        <FormProvider {...form}><form className="space-y-4" id="ai-model-form" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={save.error ? [{ id: 'server', message: errorMessage(save.error) }] : []} />
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

function DiscoverModelsDialog({ discovered, error, finalFocus, onAdd, onClose, onLocate, open, pending }: {
  discovered: DiscoveredModel[];
  error: unknown;
  finalFocus: { current: HTMLElement | null };
  onAdd: (modelId: string) => void;
  onClose: () => void;
  onLocate: (modelId: string) => void;
  open: boolean;
  pending: boolean;
}) {
  return (
    <Dialog onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()} open={open}>
      <DialogContent finalFocus={finalFocus} showCloseButton={!pending}>
        <DialogHeader><DialogTitle>发现远端模型</DialogTitle><DialogDescription>本操作会向当前 Provider 发送一次真实模型列表请求，但不会自动创建或测试模型。</DialogDescription></DialogHeader>
        {Boolean(error) && <ErrorSummary errors={[{ id: 'server', message: errorMessage(error) }]} />}
        {pending ? <Skeleton className="h-32" /> : discovered.length === 0 && !error ? <p className="text-sm text-text-muted">远端未返回模型。</p> : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {discovered.map((item) => <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3" key={item.model_id}><code className="min-w-0 break-all text-sm">{item.model_id}</code><Button onClick={() => item.primary_task === 'ADD_MODEL' ? onAdd(item.model_id) : onLocate(item.model_id)} size="sm" type="button" variant={item.configured ? 'outline' : 'default'}>{item.configured ? '查看已配置' : '添加'}</Button></div>)}
          </div>
        )}
        <DialogFooter><DialogClose disabled={pending} render={<Button variant="outline" />}>关闭</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestModelDialog({ error, finalFocus, model, onClose, onConfirm, onReload, pending }: {
  error: unknown;
  finalFocus: () => HTMLElement | null;
  model: AIModel;
  onClose: () => void;
  onConfirm: () => void;
  onReload: () => Promise<void>;
  pending: boolean;
}) {
  const conflict = isAIChannelRevisionConflict(error);
  return (
    <Dialog onOpenChange={(open) => !open && !pending && onClose()} open>
      <DialogContent finalFocus={finalFocus} showCloseButton={!pending}>
        <DialogHeader><DialogTitle>测试模型“{model.display_name}”？</DialogTitle><DialogDescription>服务端会用当前渠道真实配置发送一条“hi”，可能产生外部调用费用；每次确认只发送一次，完成后模型仍保持停用。</DialogDescription></DialogHeader>
        {model.last_test_error_summary && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">最近失败：{model.last_test_error_summary}</p>}
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI 模型操作发生未知错误';
}

export { AIChannelModelsSection };
export type { AIChannelModelsSectionProps };
