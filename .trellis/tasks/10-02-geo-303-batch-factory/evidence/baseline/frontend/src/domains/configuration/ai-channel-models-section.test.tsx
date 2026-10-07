import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { AIChannelModelsSection } from './ai-channel-models-section';
import { aiChannelKeys } from './ai-channel.api';

type AIChannel = components['schemas']['AIChannel'];
type AIModel = components['schemas']['AIModel'];
type AIModelList = components['schemas']['AIModelList'];

const channelId = 'a0000000-0000-4000-8000-000000000001';

function channel(overrides: Partial<AIChannel> = {}): AIChannel {
  return {
    id: channelId,
    name: 'Models 渠道',
    description: '模型测试渠道',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'OPENAI',
    base_url: 'https://provider.example.invalid/v1',
    timeout_seconds: 60,
    is_enabled: false,
    api_key_configured: true,
    api_key_updated_at: '2026-09-25T00:00:00Z',
    headers: [],
    enabled_models: [],
    latest_test_status: 'UNTESTED',
    last_tested_at: null,
    workflow_stage: 'UNVERIFIED',
    primary_task: 'TEST_MODEL',
    available_actions: ['UPDATE', 'REPLACE_API_KEY', 'ENABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_MODEL'],
    revision: 4,
    created_by: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-09-25T00:00:00Z',
    updated_at: '2026-09-25T00:00:00Z',
    ...overrides,
  };
}

function model(index: number, overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    channel_id: channelId,
    display_name: `模型 ${index}`,
    model_id: `model-${index}`,
    request_parameters: {},
    is_enabled: false,
    test_status: 'UNTESTED',
    last_tested_at: null,
    last_test_error_summary: null,
    workflow_stage: 'UNTESTED',
    primary_task: 'TEST_CONNECTION',
    available_actions: ['UPDATE', 'TEST', 'DELETE'],
    revision: 2,
    created_by: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-09-25T00:00:00Z',
    updated_at: '2026-09-25T00:00:00Z',
    ...overrides,
  };
}

function success<T>(data: T, status = 200) {
  return { data, response: Response.json(data, { status }) } as never;
}

function errorResponse(status: number, code: string, message: string) {
  const body = { error: { code, message, details: {}, request_id: `req-${code.toLocaleLowerCase()}` } };
  return { error: body, response: Response.json(body, { status }) } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderModels(
  items: AIModel[],
  onConsumersChanged: () => Promise<void> = async () => undefined,
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channelId), { items });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AIChannelModelsSection
          channel={channel()}
          csrfToken="models-csrf"
          onConsumersChanged={onConsumersChanged}
          onEnableChannel={vi.fn()}
          onViewRuntime={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, view };
}

async function openOverflow(displayName: string) {
  await userEvent.click(screen.getByRole('button', { name: `更多操作：模型 ${displayName}` }));
}

afterEach(() => vi.restoreAllMocks());

describe('AIChannelModelsSection', () => {
  it('test 成功立即采用 canonical 并释放命令锁，消费者刷新可继续 pending', async () => {
    const initial = model(1);
    const canonical = model(1, {
      display_name: 'Canonical 测试模型',
      test_status: 'PASSED',
      last_tested_at: '2026-09-25T01:00:00Z',
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_MODEL',
      available_actions: ['UPDATE', 'TEST', 'ENABLE', 'DELETE'],
      revision: 3,
    });
    const refresh = deferred<never>();
    vi.spyOn(api, 'GET').mockImplementation(() => refresh.promise);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(success(canonical));
    const consumers = deferred<void>();
    const { view } = renderModels([initial], () => consumers.promise);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: /测试模型/ })).getByRole('button', { name: '开始测试' }));

    expect(await screen.findByText('连接测试通过；模型仍保持停用，请按需手动启用。')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Canonical 测试模型/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用模型' })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('create/update 成功在 deferred Models refresh 前依次 upsert canonical', async () => {
    const refresh = deferred<never>();
    vi.spyOn(api, 'GET').mockImplementation(() => refresh.promise);
    const created = model(2, { display_name: 'Canonical 新模型', model_id: 'created-model', revision: 0 });
    const updated = model(2, { display_name: 'Canonical 已更新', model_id: 'created-model', revision: 1 });
    vi.spyOn(api, 'POST').mockResolvedValue(success(created, 201));
    vi.spyOn(api, 'PATCH').mockResolvedValue(success(updated));
    const consumers = vi.fn().mockResolvedValue(undefined);
    const { view } = renderModels([], consumers);

    await userEvent.click(screen.getByRole('button', { name: '手工新增' }));
    const create = screen.getByRole('dialog', { name: '新增模型' });
    await userEvent.type(within(create).getByRole('textbox', { name: '显示名称' }), '本地新模型');
    await userEvent.type(within(create).getByRole('textbox', { name: 'Model ID' }), 'created-model');
    await userEvent.click(within(create).getByRole('button', { name: '保存模型' }));
    expect(await screen.findByRole('row', { name: /Canonical 新模型/ })).toBeInTheDocument();
    expect(consumers).not.toHaveBeenCalled();

    await openOverflow('Canonical 新模型');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    const edit = screen.getByRole('dialog', { name: '编辑模型' });
    const displayName = within(edit).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(displayName);
    await userEvent.type(displayName, '本地更新');
    await userEvent.click(within(edit).getByRole('button', { name: '保存模型' }));

    expect(await screen.findByRole('row', { name: /Canonical 已更新/ })).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(api.PATCH).toHaveBeenCalledTimes(1);
    expect(consumers).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('edit 旧 reload 迟到时保留同模型新 intent 的 hold，当前 reload 后采用 revision 7', async () => {
    const initial = model(1);
    const latest = model(1, { display_name: '服务端最新模型', revision: 7 });
    const updated = model(1, { display_name: '重开后的新草稿', revision: 8 });
    const reload = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockImplementationOnce(() => reload.promise)
      .mockResolvedValue(success({ items: [latest] }));
    const patch = vi.spyOn(api, 'PATCH')
      .mockResolvedValueOnce(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'))
      .mockResolvedValueOnce(success(updated));
    const { queryClient } = renderModels([initial]);

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    let dialog = screen.getByRole('dialog', { name: '编辑模型' });
    const firstDraft = within(dialog).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(firstDraft);
    await userEvent.type(firstDraft, '第一次草稿');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });

    reload.resolve(success({ items: [latest] }));
    await waitFor(() => expect(
      queryClient.getQueryData<AIModelList>(aiChannelKeys.models(channelId))?.items[0]?.revision,
    ).toBe(7));
    expect(screen.getByRole('dialog', { name: '编辑模型' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: '显示名称' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '重新加载模型列表' })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);

    await openOverflow('服务端最新模型');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });
    const reopenedDraft = within(dialog).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(reopenedDraft);
    await userEvent.type(reopenedDraft, '重开后的新草稿');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(patch).toHaveBeenLastCalledWith('/api/v1/ai-models/{model_id}', expect.objectContaining({
      body: expect.objectContaining({ expected_revision: 7 }),
    }));
  });

  it('页面 Notice 的旧 reload 迟到时保留同模型新 edit intent，当前 reload 后采用 revision 7', async () => {
    const initial = model(1);
    const latest = model(1, { display_name: '服务端 Notice 模型', revision: 7 });
    const updated = model(1, { display_name: 'Notice 后的新草稿', revision: 8 });
    const noticeReload = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockImplementationOnce(() => noticeReload.promise)
      .mockResolvedValue(success({ items: [latest] }));
    const patch = vi.spyOn(api, 'PATCH')
      .mockResolvedValueOnce(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'))
      .mockResolvedValueOnce(success(updated));
    const { queryClient } = renderModels([initial]);

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    let dialog = screen.getByRole('dialog', { name: '编辑模型' });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    const noticeText = screen.getByText(/更新模型“模型 1”发生 revision 冲突/);
    const notice = noticeText.closest('[role="alert"]');
    if (!notice) throw new Error('未找到更新模型冲突 Notice');
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: '重新加载模型列表' }));

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });
    noticeReload.resolve(success({ items: [latest] }));

    await waitFor(() => expect(
      queryClient.getQueryData<AIModelList>(aiChannelKeys.models(channelId))?.items[0]?.revision,
    ).toBe(7));
    expect(screen.getByRole('dialog', { name: '编辑模型' })).toBeInTheDocument();
    expect(screen.getByText(/更新模型“服务端 Notice 模型”发生 revision 冲突/)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: '显示名称' })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);

    await openOverflow('服务端 Notice 模型');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });
    const displayName = within(dialog).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(displayName);
    await userEvent.type(displayName, 'Notice 后的新草稿');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(patch).toHaveBeenLastCalledWith('/api/v1/ai-models/{model_id}', expect.objectContaining({
      body: expect.objectContaining({ expected_revision: 7 }),
    }));
  });

  it('页面 Notice 的旧 reload 失败迟到时不污染同模型新 intent', async () => {
    const initial = model(1);
    const latest = model(1, { display_name: '服务端最新模型', revision: 7 });
    const updated = model(1, { display_name: '旧失败后的新草稿', revision: 8 });
    const staleReload = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockImplementationOnce(() => staleReload.promise)
      .mockResolvedValue(success({ items: [latest] }));
    const patch = vi.spyOn(api, 'PATCH')
      .mockResolvedValueOnce(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'))
      .mockResolvedValueOnce(success(updated));
    const { queryClient } = renderModels([initial]);

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    let dialog = screen.getByRole('dialog', { name: '编辑模型' });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    let notice = screen.getByText(/更新模型“模型 1”发生 revision 冲突/).closest('[role="alert"]');
    if (!notice) throw new Error('未找到更新模型冲突 Notice');
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: '重新加载模型列表' }));

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });
    staleReload.resolve(errorResponse(503, 'AI_MODELS_UNAVAILABLE', '旧 reload 失败') as never);

    await waitFor(() => expect(
      queryClient.getQueryState(aiChannelKeys.models(channelId))?.fetchStatus,
    ).toBe('idle'));
    notice = screen.getByText(/更新模型“模型 1”发生 revision 冲突/).closest('[role="alert"]');
    expect(notice).not.toHaveTextContent('旧 reload 失败');
    expect(within(dialog).getByRole('textbox', { name: '显示名称' })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);

    await openOverflow('服务端最新模型');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    dialog = screen.getByRole('dialog', { name: '编辑模型' });
    const displayName = within(dialog).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(displayName);
    await userEvent.type(displayName, '旧失败后的新草稿');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(patch).toHaveBeenLastCalledWith('/api/v1/ai-models/{model_id}', expect.objectContaining({
      body: expect.objectContaining({ expected_revision: 7 }),
    }));
  });

  it('test reload 迟到时不关闭后来打开的另一模型 Dialog', async () => {
    const first = model(1);
    const second = model(2);
    const reload = deferred<never>();
    vi.spyOn(api, 'GET').mockImplementation(() => reload.promise);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'));
    renderModels([first, second]);

    await userEvent.click(within(screen.getByRole('row', { name: /模型 1/ })).getByRole('button', { name: '测试连接' }));
    let dialog = screen.getByRole('dialog', { name: /测试模型“模型 1”/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await userEvent.click(within(screen.getByRole('row', { name: /模型 2/ })).getByRole('button', { name: '测试连接' }));
    dialog = screen.getByRole('dialog', { name: /测试模型“模型 2”/ });
    reload.resolve(success({ items: [model(1, { revision: 7 }), second] }));

    await waitFor(() => expect(screen.getByText(/测试模型“模型 1”发生 revision 冲突/)).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /测试模型“模型 2”/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '开始测试' })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('test 旧 reload 迟到时保留同模型新 intent 的 hold，当前 reload 后采用 revision 7', async () => {
    const initial = model(1);
    const latest = model(1, { display_name: '服务端测试模型', revision: 7 });
    const tested = model(1, {
      display_name: '服务端测试模型',
      test_status: 'PASSED',
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_MODEL',
      available_actions: ['UPDATE', 'TEST', 'ENABLE', 'DELETE'],
      revision: 8,
    });
    const reload = deferred<never>();
    const get = vi.spyOn(api, 'GET')
      .mockImplementationOnce(() => reload.promise)
      .mockResolvedValue(success({ items: [latest] }));
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'))
      .mockResolvedValueOnce(success(tested));
    const { view } = renderModels([initial]);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    let dialog = screen.getByRole('dialog', { name: /测试模型“模型 1”/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    dialog = screen.getByRole('dialog', { name: /测试模型“模型 1”/ });
    reload.resolve(success({ items: [latest] }));
    await waitFor(() => expect(dialog).toHaveAccessibleName('测试模型“服务端测试模型”？'));
    expect(within(dialog).getByRole('button', { name: '开始测试' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '重新加载模型列表' })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /测试模型/ })).not.toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    dialog = screen.getByRole('dialog', { name: /测试模型“服务端测试模型”/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith('/api/v1/ai-models/{model_id}/test', {
      body: { expected_revision: 7 },
      params: {
        path: { model_id: initial.id },
        header: { 'X-CSRF-Token': 'models-csrf' },
      },
    });
    view.unmount();
  });

  it('toggle/remove 成功在 deferred Models refresh 前更新并移除 canonical 行', async () => {
    const initial = model(1, {
      test_status: 'PASSED',
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_MODEL',
      available_actions: ['UPDATE', 'TEST', 'ENABLE', 'DELETE'],
    });
    const enabled = model(1, {
      is_enabled: true,
      test_status: 'PASSED',
      workflow_stage: 'CHANNEL_DISABLED',
      primary_task: 'ENABLE_CHANNEL',
      available_actions: ['UPDATE', 'TEST', 'DISABLE', 'DELETE'],
      revision: 3,
    });
    const refresh = deferred<never>();
    vi.spyOn(api, 'GET').mockImplementation(() => refresh.promise);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(success(enabled));
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { view } = renderModels([initial]);

    await userEvent.click(screen.getByRole('button', { name: '启用模型' }));
    expect(await screen.findByText('模型已启用')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /模型 1/ })).toHaveTextContent('已启用');
    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除模型' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: /删除模型/ })).getByRole('button', { name: '删除模型' }));

    await waitFor(() => expect(screen.queryByRole('row', { name: /模型 1/ })).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('/api/v1/ai-models/{model_id}', expect.objectContaining({
      params: expect.objectContaining({ query: { expected_revision: 3 } }),
    }));
    view.unmount();
  });

  it('消费者刷新 reject 显示只读 retry，重试不重发模型命令', async () => {
    const initial = model(1);
    const canonical = model(1, {
      test_status: 'PASSED',
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_MODEL',
      available_actions: ['UPDATE', 'TEST', 'ENABLE', 'DELETE'],
      revision: 3,
    });
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(errorResponse(503, 'MODELS_REFRESH_FAILED', '模型列表刷新失败'))
      .mockResolvedValue(success({ items: [canonical] }));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(success(canonical));
    renderModels([initial]);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: /测试模型/ })).getByRole('button', { name: '开始测试' }));
    const noticeText = await screen.findByText(/模型命令已完成，但页面刷新失败：模型列表刷新失败/);
    const notice = noticeText.closest('[role="alert"]');
    if (!notice) throw new Error('未找到消费者刷新失败 Notice');
    expect(notice).toHaveTextContent('模型命令已完成，但页面刷新失败：模型列表刷新失败');
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: '重试刷新' }));

    await waitFor(() => expect(screen.queryByText(/模型命令已完成，但页面刷新失败/)).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1);
    expect(api.GET).toHaveBeenCalledTimes(2);
  });

  it('两个 model+command 409 hold 相互隔离，被动投影与关闭重开不清除，只清显式 reload 的目标', async () => {
    const first = model(1);
    const second = model(2);
    let serverItems = [first, second];
    vi.spyOn(api, 'GET').mockImplementation(async () => success({ items: serverItems }));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'));
    const { queryClient } = renderModels([first, second]);

    for (const displayName of ['模型 1', '模型 2']) {
      const row = screen.getByRole('row', { name: new RegExp(displayName) });
      await userEvent.click(within(row).getByRole('button', { name: '测试连接' }));
      const dialog = screen.getByRole('dialog', { name: new RegExp(`测试模型“${displayName}”`) });
      await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
      expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    }

    const refreshedFirst = model(1, { revision: 7 });
    const refreshedSecond = model(2, { revision: 8 });
    serverItems = [refreshedFirst, refreshedSecond];
    queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channelId), { items: serverItems });
    expect(screen.getByText(/测试模型“模型 1”发生 revision 冲突/)).toBeInTheDocument();
    expect(screen.getByText(/测试模型“模型 2”发生 revision 冲突/)).toBeInTheDocument();

    const firstHold = screen.getByText(/测试模型“模型 1”发生 revision 冲突/).closest('[role="alert"]');
    if (!firstHold) throw new Error('未找到第一个模型的 hold Notice');
    await userEvent.click(within(firstHold as HTMLElement).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByText(/测试模型“模型 1”发生 revision 冲突/)).not.toBeInTheDocument());
    expect(screen.getByText(/测试模型“模型 2”发生 revision 冲突/)).toBeInTheDocument();

    const secondRow = screen.getByRole('row', { name: /模型 2/ });
    await userEvent.click(within(secondRow).getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('dialog', { name: /测试模型“模型 2”/ })).toHaveTextContent('AI 模型已被其他请求修改');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('test intent 确认时从 exact Models query 重读，TEST 撤销或目标消失均不发送', async () => {
    const initial = model(1);
    vi.spyOn(api, 'GET').mockResolvedValue(success({ items: [initial] }));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(success(initial));
    const { queryClient } = renderModels([initial]);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    const revoked = model(1, {
      primary_task: 'VIEW_MODEL_RUNTIME',
      available_actions: ['UPDATE', 'DELETE'],
      revision: 9,
    });
    queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channelId), { items: [revoked] });
    const dialog = screen.getByRole('dialog', { name: /测试模型/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
    expect(await within(dialog).findByText(/已撤销 TEST 动作/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    queryClient.setQueryData<AIModelList>(aiChannelKeys.models(channelId), { items: [] });
    await userEvent.click(within(dialog).getByRole('button', { name: '开始测试' }));
    expect(await within(dialog).findByText(/目标模型已不存在/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('update 409 后 Models reload 503 保留 Dialog、草稿和 hold，200 才恢复', async () => {
    const initial = model(1);
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(errorResponse(503, 'MODELS_UNAVAILABLE', '模型列表暂不可用'))
      .mockResolvedValue(success({ items: [model(1, { display_name: '服务端最新模型', revision: 5 })] }));
    vi.spyOn(api, 'PATCH').mockResolvedValue(errorResponse(409, 'REVISION_CONFLICT', 'AI 模型已被其他请求修改'));
    renderModels([initial]);

    await openOverflow('模型 1');
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑模型' }));
    const dialog = screen.getByRole('dialog', { name: '编辑模型' });
    const displayName = within(dialog).getByRole('textbox', { name: '显示名称' });
    await userEvent.clear(displayName);
    await userEvent.type(displayName, '本地草稿');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存模型' }));
    expect(await within(dialog).findByText(/AI 模型已被其他请求修改/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    expect(await within(dialog).findByText(/模型列表暂不可用/)).toBeInTheDocument();
    expect(displayName).toHaveValue('本地草稿');
    expect(screen.getByRole('dialog', { name: '编辑模型' })).toBeInTheDocument();
    expect(screen.getByText(/更新模型“模型 1”发生 revision 冲突/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载模型列表' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑模型' })).not.toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/更新模型“模型 1”发生 revision 冲突/)).not.toBeInTheDocument();
  });

  it('discovery 409 冻结到成功 channel reload，未知 primary_task 显式失败', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => (
      path === '/api/v1/ai-channels/{channel_id}'
        ? success(channel({ revision: 5 }))
        : success({ items: [] })
    ));
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(errorResponse(409, 'REVISION_CONFLICT', 'AI 渠道已被其他请求修改'))
      .mockResolvedValueOnce(success({
        items: [{ model_id: 'unknown-model', configured: false, primary_task: 'UNKNOWN_TASK' }],
      } as never));
    renderModels([]);

    await userEvent.click(screen.getByRole('button', { name: '发现模型' }));
    let dialog = screen.getByRole('dialog', { name: '发现远端模型' });
    expect(await within(dialog).findByText(/AI 渠道已被其他请求修改/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole('button', { name: '关闭' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: '发现模型' }));
    expect(post).toHaveBeenCalledTimes(1);
    dialog = screen.getByRole('dialog', { name: '发现远端模型' });
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载渠道' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '发现远端模型' })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '发现模型' }));
    dialog = screen.getByRole('dialog', { name: '发现远端模型' });
    expect(await within(dialog).findByText(/返回未知主任务：UNKNOWN_TASK/)).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith('/api/v1/ai-channels/{channel_id}/discover-models', expect.objectContaining({
      body: { expected_revision: 5 },
    }));
    expect(within(dialog).queryByRole('button', { name: '添加' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '查看已配置' })).not.toBeInTheDocument();
  });
});
