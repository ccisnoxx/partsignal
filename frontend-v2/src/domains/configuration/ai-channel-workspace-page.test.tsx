import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { aiChannelKeys } from './ai-channel.api';

type AIChannel = components['schemas']['AIChannel'];
type AIModel = components['schemas']['AIModel'];
type AIChannelUsageSummary = components['schemas']['AIChannelUsageSummary'];
type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];

const channelId = '00000000-0000-4000-8000-000000000001';
const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000099',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
};
const auth: AuthContextValue = {
  user: admin,
  csrfToken: 'workspace-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function channel(overrides: Partial<AIChannel> = {}): AIChannel {
  return {
    id: channelId,
    name: '生产 OpenAI',
    description: '内容生成主渠道',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'OPENAI',
    base_url: 'https://api.example.com/v1',
    timeout_seconds: 60,
    is_enabled: false,
    api_key_configured: true,
    api_key_updated_at: '2026-08-14T08:00:00Z',
    headers: [{
      id: '00000000-0000-4000-8000-000000000002',
      name: 'X-Region',
      is_sensitive: false,
      is_configured: true,
      available_actions: ['UPDATE', 'DELETE'],
      primary_task: 'EDIT_HEADER',
    }],
    enabled_models: [],
    latest_test_status: 'UNTESTED',
    last_tested_at: null,
    workflow_stage: 'UNVERIFIED',
    primary_task: 'TEST_MODEL',
    available_actions: ['UPDATE', 'REPLACE_API_KEY', 'ENABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
    revision: 4,
    created_by: admin.id,
    created_at: '2026-08-14T08:00:00Z',
    updated_at: '2026-08-14T08:00:00Z',
    ...overrides,
  };
}

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    channel_id: channelId,
    display_name: 'GPT Test',
    model_id: 'gpt-test',
    request_parameters: { temperature: 0 },
    is_enabled: false,
    test_status: 'UNTESTED',
    last_tested_at: null,
    last_test_error_summary: null,
    workflow_stage: 'UNTESTED',
    primary_task: 'TEST_CONNECTION',
    available_actions: ['UPDATE', 'TEST', 'DELETE'],
    revision: 2,
    created_by: admin.id,
    created_at: '2026-08-14T08:00:00Z',
    updated_at: '2026-08-14T08:00:00Z',
    ...overrides,
  };
}

function usage(overrides: Partial<AIChannelUsageSummary> = {}): AIChannelUsageSummary {
  return {
    channel_id: channelId,
    period: '30d',
    period_started_at: '2026-07-15T00:00:00Z',
    period_ended_at: '2026-08-14T00:00:00Z',
    total_jobs: 0,
    succeeded_jobs: 0,
    failed_jobs: 0,
    success_rate: null,
    average_response_duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    last_used_at: null,
    ...overrides,
  };
}

function auditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    actor_id: admin.id,
    actor: { id: admin.id, display_name: admin.display_name, account_type: 'ADMIN' },
    business_module: 'CONFIGURATION',
    action: 'ai_channel.updated',
    target_type: 'AIChannel',
    target_id: channelId,
    outcome: 'SUCCESS',
    change_summary: { revision: 5, changes: [{ field: 'revision', before: 4, after: 5 }] },
    primary_task: 'VIEW_LOG_DETAIL',
    request_id: 'req-runtime-safe',
    created_at: '2026-08-14T09:00:00Z',
    ...overrides,
  };
}

function auditDetail(overrides: Partial<AuditLogDetail> = {}): AuditLogDetail {
  return {
    ...auditLog(),
    changes: [{ field: 'revision', before: 4, after: 5 }],
    facts: { revision: 5 },
    result_message: '渠道配置已更新',
    error_code: null,
    related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null },
    ...overrides,
  };
}

function renderWorkspace(entry = `/settings/ai/${channelId}?tab=basic`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, view };
}

function success<T>(data: T, status = 200) {
  return { data, response: Response.json(data, { status }) } as never;
}

function conflict() {
  return {
    error: { error: { code: 'REVISION_CONFLICT', message: 'AI 渠道已被其他请求修改', details: {}, request_id: 'req-workspace-conflict' } },
    response: Response.json({}, { status: 409 }),
  } as never;
}

function failure(status: number, message: string) {
  return {
    error: { error: { code: 'RUNTIME_FAILED', message, details: {}, request_id: 'req-runtime-failed' } },
    response: Response.json({}, { status }),
  } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('AIChannelWorkspacePage', () => {
  it('canonicalize UUID/search，Models 与 Runtime 只在 active tab 查询', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(channel()));
    const canonical = renderWorkspace(`/settings/ai/${channelId.toUpperCase()}`);
    expect(await screen.findByRole('heading', { name: '生产 OpenAI' })).toBeInTheDocument();
    expect(canonical.router.state.location.pathname).toBe(`/settings/ai/${channelId}`);
    expect(canonical.router.state.location.search).toEqual({ tab: 'basic' });
    expect(get).toHaveBeenCalledOnce();
    canonical.view.unmount();
    canonical.queryClient.clear();

    get.mockClear();
    get.mockImplementation(async (path) => path === '/api/v1/ai-channels/{channel_id}/models'
      ? success({ items: [] })
      : success(channel()));
    const models = renderWorkspace(`/settings/ai/${channelId}?tab=models`);
    expect(await screen.findByText('尚未配置模型。可手工新增，或从远端发现后选择添加。')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect((get.mock.calls as unknown as Array<[string]>).map(([path]) => path)).toEqual([
      '/api/v1/ai-channels/{channel_id}',
      '/api/v1/ai-channels/{channel_id}/models',
    ]);
    models.view.unmount();
    models.queryClient.clear();

    get.mockClear();
    get.mockImplementation(async (path) => path === '/api/v1/ai-channels/{channel_id}/usage-summary'
      ? success(usage())
      : success(channel()));
    const runtime = renderWorkspace(`/settings/ai/${channelId}?tab=usage&page=9`);
    expect(await screen.findByRole('heading', { name: '使用统计' })).toBeInTheDocument();
    expect(runtime.router.state.location.search).toEqual({ tab: 'usage', period: '30d' });
    expect((get.mock.calls as unknown as Array<[string]>).map(([path]) => path)).toEqual([
      '/api/v1/ai-channels/{channel_id}',
      '/api/v1/ai-channels/{channel_id}/usage-summary',
    ]);
    runtime.view.unmount();
    runtime.queryClient.clear();

    get.mockClear();
    renderWorkspace('/settings/ai/not-a-uuid?tab=basic');
    expect(await screen.findByText(/不是有效 UUID/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('确认离开脏配置后卸载表单 owner，再回 Basic 使用 canonical baseline', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => (
      path === '/api/v1/ai-channels/{channel_id}/models'
        ? success({ items: [] })
        : success(channel())
    ));
    renderWorkspace();
    const name = await screen.findByRole('textbox', { name: '渠道名称' });
    await userEvent.clear(name);
    await userEvent.type(name, '未保存名称');
    await userEvent.click(screen.getByRole('tab', { name: '模型管理' }));
    const guard = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await userEvent.click(within(guard).getByRole('button', { name: '放弃修改并离开' }));
    expect(await screen.findByText('尚未配置模型。可手工新增，或从远端发现后选择添加。')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '渠道名称' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '基本信息' }));
    expect(await screen.findByRole('textbox', { name: '渠道名称' })).toHaveValue('生产 OpenAI');
    expect((get.mock.calls as unknown as Array<[string]>).filter(([path]) => path === '/api/v1/ai-channels/{channel_id}/models')).toHaveLength(1);
  });

  it('Usage 由 URL period 与服务端窗口驱动，并区分真实零、null 与 refresh error', async () => {
    let failRefresh = false;
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/ai-channels/{channel_id}/usage-summary') {
        return failRefresh ? failure(500, '统计暂时不可用') : success(usage());
      }
      return success(channel());
    });
    const { queryClient, router } = renderWorkspace(`/settings/ai/${channelId}?tab=usage&period=30d`);
    expect(await screen.findByText('业务作业')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.getAllByText('暂无数据').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/统计开始/).parentElement).toHaveTextContent('2026');
    expect(get).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/usage-summary', {
      params: { path: { channel_id: channelId }, query: { period: '30d' } },
    });

    await userEvent.click(screen.getByRole('combobox', { name: '统计时间范围' }));
    await userEvent.click(await screen.findByRole('option', { name: '最近 7 天' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'usage', period: '7d' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/usage-summary', {
      params: { path: { channel_id: channelId }, query: { period: '7d' } },
    }));

    failRefresh = true;
    await queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes('usage') && query.queryKey.includes('7d'),
    });
    expect(await screen.findByText(/使用统计刷新失败：统计暂时不可用/)).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(3);
  });

  it('Logs 使用服务端分页与 actor，详情按点击读取并对越界页显式恢复', async () => {
    const row = auditLog();
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/ai-channels/{channel_id}/audit-logs') {
        const page = (options as { params: { query: { page: number } } }).params.query.page;
        return success(page === 99
          ? { items: [], page: 99, page_size: 10, total: 21 }
          : { items: [row], page, page_size: 10, total: 21 });
      }
      if (path === '/api/v1/audit-logs/{audit_log_id}') return success(auditDetail());
      return success(channel());
    });
    const { router } = renderWorkspace(`/settings/ai/${channelId}?tab=logs&page=2&pageSize=10`);
    expect(await screen.findByRole('row', { name: /更新渠道/ })).toHaveTextContent('系统管理员');
    expect(screen.getByRole('row', { name: /更新渠道/ })).toHaveTextContent('修订号：4 → 5');
    expect(get).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/audit-logs', {
      params: { path: { channel_id: channelId }, query: { page: 2, page_size: 10 } },
    });
    expect((get.mock.calls as unknown as Array<[string]>).map(([path]) => path)).not.toContain('/api/v1/users');
    expect((get.mock.calls as unknown as Array<[string]>).map(([path]) => path)).not.toContain('/api/v1/audit-logs/{audit_log_id}');

    const detailTrigger = screen.getByRole('button', { name: '查看详情' });
    await userEvent.click(detailTrigger);
    const sheet = await screen.findByRole('dialog', { name: '渠道操作日志详情' });
    expect(within(sheet).getByText('渠道配置已更新')).toBeInTheDocument();
    expect(within(sheet).getAllByText('修订号').length).toBeGreaterThanOrEqual(1);
    expect(get).toHaveBeenCalledWith('/api/v1/audit-logs/{audit_log_id}', {
      params: { path: { audit_log_id: row.id } },
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(detailTrigger).toHaveFocus());

    await router.navigate({
      to: '/settings/ai/$channelId',
      params: { channelId },
      search: { tab: 'logs', page: 99, pageSize: 10 },
    });
    const recover = await screen.findByRole('button', { name: '返回最后有效页' });
    expect(router.state.location.search).toEqual({ tab: 'logs', page: 99, pageSize: 10 });
    await userEvent.click(recover);
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'logs', page: 3, pageSize: 10 }));
  });

  it('Channel 与 Model Runtime 主任务都进入渠道 Usage', async () => {
    const runtimeChannel = channel({
      is_enabled: true,
      primary_task: 'VIEW_RUNTIME',
      available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
    });
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/ai-channels/{channel_id}/usage-summary') return success(usage());
      if (path === '/api/v1/ai-channels/{channel_id}/models') {
        return success({ items: [model({ primary_task: 'VIEW_MODEL_RUNTIME', available_actions: ['UPDATE', 'DELETE'] })] });
      }
      return success(runtimeChannel);
    });
    const channelView = renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: '查看运行' }));
    await waitFor(() => expect(channelView.router.state.location.search).toEqual({ tab: 'usage', period: '30d' }));
    channelView.view.unmount();
    channelView.queryClient.clear();

    const modelView = renderWorkspace(`/settings/ai/${channelId}?tab=models`);
    const row = await screen.findByRole('row', { name: /GPT Test/ });
    await userEvent.click(within(row).getByRole('button', { name: '查看运行' }));
    await waitFor(() => expect(modelView.router.state.location.search).toEqual({ tab: 'usage', period: '30d' }));
  });

  it('Models discovery/test/delete 使用各自 current revision 且真实测试只发送一次', async () => {
    const currentModel = model();
    vi.spyOn(api, 'GET').mockImplementation(async (path) => (
      path === '/api/v1/ai-channels/{channel_id}/models'
        ? success({ items: [currentModel] })
        : success(channel())
    ));
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path === '/api/v1/ai-channels/{channel_id}/discover-models') {
        return success({ items: [{ model_id: 'remote-new', configured: false, primary_task: 'ADD_MODEL' }] });
      }
      return success(model({ test_status: 'PASSED', revision: 3 }));
    });
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    renderWorkspace(`/settings/ai/${channelId}?tab=models`);

    await userEvent.click(await screen.findByRole('button', { name: '发现模型' }));
    expect(await screen.findByText('remote-new')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/discover-models', {
      body: { expected_revision: 4 },
      params: { path: { channel_id: channelId }, header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    const discoveryDialog = screen.getByRole('dialog', { name: '发现远端模型' });
    await userEvent.click(within(discoveryDialog).getAllByRole('button', { name: '关闭' }).at(-1)!);

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    const testDialog = await screen.findByRole('dialog', { name: '测试模型“GPT Test”？' });
    await userEvent.click(within(testDialog).getByRole('button', { name: '开始测试' }));
    await waitFor(() => expect((post.mock.calls as unknown as Array<[string]>).filter(([path]) => path === '/api/v1/ai-models/{model_id}/test')).toHaveLength(1));
    expect(post).toHaveBeenCalledWith('/api/v1/ai-models/{model_id}/test', {
      body: { expected_revision: 2 },
      params: { path: { model_id: currentModel.id }, header: { 'X-CSRF-Token': auth.csrfToken } },
    });

    await userEvent.click(screen.getByRole('button', { name: '更多操作：模型 GPT Test' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除模型' }));
    const deleteDialog = await screen.findByRole('dialog', { name: '删除模型“GPT Test”？' });
    await userEvent.click(within(deleteDialog).getByRole('button', { name: '删除模型' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenCalledWith('/api/v1/ai-models/{model_id}', {
      params: {
        path: { model_id: currentModel.id },
        query: { expected_revision: 2 },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
  });

  it('Basic/Request 互切保留草稿并提交完整 update', async () => {
    const initial = channel();
    vi.spyOn(api, 'GET').mockResolvedValue(success(initial));
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(success(channel({
      name: '新名称',
      base_url: 'https://new.example.com/v1',
      revision: 5,
    })));
    const { router } = renderWorkspace();
    const name = await screen.findByRole('textbox', { name: '渠道名称' });
    await userEvent.clear(name);
    await userEvent.type(name, '新名称');
    await userEvent.click(screen.getByRole('tab', { name: '请求配置' }));
    expect(router.state.location.search).toEqual({ tab: 'request' });
    const baseUrl = screen.getByRole('textbox', { name: 'API 根地址' });
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://new.example.com/v1');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}', {
      body: {
        expected_revision: 4,
        name: '新名称',
        description: initial.description,
        protocol_type: initial.protocol_type,
        provider_brand: initial.provider_brand,
        base_url: 'https://new.example.com/v1',
        timeout_seconds: initial.timeout_seconds,
      },
      params: { path: { channel_id: channelId }, header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(await screen.findByText('渠道配置已保存')).toBeInTheDocument();
  });

  it('干净表单接收后台更新后使用新的 canonical revision 保存', async () => {
    const initial = channel();
    vi.spyOn(api, 'GET').mockResolvedValue(success(initial));
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(success(channel({
      name: '本地编辑',
      revision: 6,
    })));
    const { queryClient } = renderWorkspace();
    const name = await screen.findByRole('textbox', { name: '渠道名称' });

    queryClient.setQueryData(
      aiChannelKeys.detail(channelId),
      channel({ name: '后台更新', revision: 5 }),
    );
    await waitFor(() => expect(name).toHaveValue('后台更新'));

    await userEvent.clear(name);
    await userEvent.type(name, '本地编辑');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}', expect.objectContaining({
      body: expect.objectContaining({ expected_revision: 5, name: '本地编辑' }),
    }));
  });

  it('409 保留非敏感草稿、禁止重放，显式 reload 才重置', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(success(channel()))
      .mockResolvedValueOnce(success(channel({ name: '服务端新名称', revision: 5 })));
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(conflict());
    renderWorkspace();
    const name = await screen.findByRole('textbox', { name: '渠道名称' });
    await userEvent.clear(name);
    await userEvent.type(name, '本地草稿');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(await screen.findByText(/当前非敏感草稿已保留/)).toBeInTheDocument();
    expect(name).toHaveValue('本地草稿');
    expect(screen.getByRole('button', { name: '保存配置' })).toHaveAttribute('aria-disabled', 'true');
    expect(patch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: '重新加载服务端版本' }));
    await waitFor(() => expect(name).toHaveValue('服务端新名称'));
    expect(get).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledOnce();
  });

  it('API Key 冲突立即清除 secret，Header DELETE 携带当前 channel revision', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(success(channel()))
      .mockResolvedValueOnce(success(channel({ headers: [], revision: 5 })));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(conflict());
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderWorkspace(`/settings/ai/${channelId}?tab=request`);

    await userEvent.click(await screen.findByRole('button', { name: '重新配置' }));
    const keyDialog = await screen.findByRole('dialog', { name: '重新配置 API Key' });
    const keyInput = within(keyDialog).getByLabelText(/新的 API Key/);
    await userEvent.type(keyInput, 'api-key-sentinel');
    await userEvent.click(within(keyDialog).getByRole('button', { name: '保存新密钥' }));
    await waitFor(() => expect(keyInput).toHaveValue(''));
    expect(put).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/api-key', {
      body: { expected_revision: 4, api_key: 'api-key-sentinel' },
      params: { path: { channel_id: channelId }, header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables)))
      .not.toContain('api-key-sentinel');
    expect(document.body).not.toHaveTextContent('api-key-sentinel');
    await userEvent.click(within(keyDialog).getByRole('button', { name: '取消' }));

    await userEvent.click(screen.getByRole('button', { name: '更多操作：Header X-Region' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除 Header' }));
    const deleteDialog = await screen.findByRole('dialog', { name: '删除 Header“X-Region”？' });
    await userEvent.click(within(deleteDialog).getByRole('button', { name: '删除 Header' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenCalledWith('/api/v1/ai-channel-headers/{header_id}', {
      params: {
        path: { header_id: channel().headers[0]!.id },
        query: { expected_channel_revision: 4 },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
  });
});
