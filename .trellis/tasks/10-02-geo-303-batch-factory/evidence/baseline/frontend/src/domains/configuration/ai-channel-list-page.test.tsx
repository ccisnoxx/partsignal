import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { aiChannelKeys, aiChannelListQueryOptions } from './ai-channel.api';

type AIChannelSummary = components['schemas']['AIChannelSummary'];
type AIChannelList = components['schemas']['AIChannelList'];

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
  csrfToken: 'ai-channel-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
    reconcileUnknownPrincipalResult: async () => {},
    runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }),
  signOut: vi.fn(),
};

function channel(overrides: Partial<AIChannelSummary> = {}): AIChannelSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: '生产 OpenAI',
    description: '内容生成主渠道',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'OPENAI',
    is_enabled: true,
    api_key_configured: true,
    header_count: 1,
    model_count: 3,
    enabled_model_count: 2,
    latest_test_status: 'PASSED',
    last_tested_at: '2026-08-14T08:00:00Z',
    configuration_status: 'READY',
    workflow_stage: 'RUNNING',
    primary_task: 'VIEW_RUNTIME',
    available_actions: [
      'UPDATE', 'REPLACE_API_KEY', 'DISABLE', 'DELETE', 'DISCOVER_MODELS',
      'CREATE_HEADER', 'CREATE_MODEL',
    ],
    revision: 4,
    ...overrides,
  };
}

function result(items: AIChannelSummary[], total = items.length): AIChannelList {
  return {
    items,
    page: 1,
    page_size: 20,
    total,
    counts: {
      all: total,
      enabled: items.filter((item) => item.is_enabled).length,
      disabled: items.filter((item) => !item.is_enabled).length,
    },
  };
}

function renderAIChannels(
  entry = '/settings/ai?page=1&pageSize=20',
  authContext = auth,
) {
  const queryClient = createAuthenticatedTestQueryClient(authContext);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth: authContext },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth: authContext }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, view };
}

afterEach(() => vi.restoreAllMocks());

describe('AIChannelListPage', () => {
  it('单次安全 GET 绘制固定七列、状态与 canonical Workspace 链接', async () => {
    const untested = channel({
      id: '00000000-0000-4000-8000-000000000002',
      name: '待配置渠道',
      provider_brand: 'CUSTOM',
      is_enabled: false,
      api_key_configured: false,
      model_count: 0,
      enabled_model_count: 0,
      latest_test_status: 'UNTESTED',
      last_tested_at: null,
      configuration_status: 'NEEDS_SETUP',
      workflow_stage: 'INCOMPLETE',
      primary_task: 'COMPLETE_CONFIGURATION',
      available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
    });
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([channel(), untested]),
      response: Response.json(result([channel(), untested])),
    } as never);

    renderAIChannels();
    expect(await screen.findByRole('heading', { name: 'AI 渠道' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '渠道', 'Provider / Protocol', '状态', '模型', '连接', '配置', '操作',
    ]);
    expect(screen.getByRole('link', { name: '生产 OpenAI' })).toHaveAttribute(
      'href',
      '/settings/ai/00000000-0000-4000-8000-000000000001?tab=basic',
    );
    expect(within(screen.getByRole('row', { name: /生产 OpenAI/ })).getByText('2 / 3'))
      .toBeInTheDocument();
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs setup').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '创建渠道' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('api-key-sentinel');
    expect(document.body).not.toHaveTextContent('provider.example.invalid');
    expect(get).toHaveBeenCalledWith('/api/v1/ai-channels', {
      params: { query: {
        q: undefined,
        status: undefined,
        provider_brand: undefined,
        sort: undefined,
        page: 1,
        page_size: 20,
      } },
    });

    await userEvent.click(screen.getByRole('button', { name: '更多操作：生产 OpenAI' }));
    expect(await screen.findByRole('menuitem', { name: '编辑渠道' })).toHaveAttribute(
      'href',
      '/settings/ai/00000000-0000-4000-8000-000000000001?tab=basic',
    );
    expect(screen.getByRole('menuitem', { name: '重新配置 API Key' })).toHaveAttribute(
      'href',
      '/settings/ai/00000000-0000-4000-8000-000000000001?tab=request',
    );
  });

  it('URL 恢复筛选排序，筛选变化回到第一页', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([channel()], 25),
      response: Response.json(result([channel()], 25)),
    } as never);
    const { router } = renderAIChannels(
      '/settings/ai?q=OpenAI&status=ENABLED&provider=OPENAI&sort=NAME_ASC&page=2&pageSize=20',
    );
    expect(await screen.findByRole('searchbox', { name: '搜索 AI 渠道' })).toHaveValue('OpenAI');
    expect(get).toHaveBeenCalledWith('/api/v1/ai-channels', {
      params: { query: {
        q: 'OpenAI', status: 'ENABLED', provider_brand: 'OPENAI', sort: 'NAME_ASC', page: 2, page_size: 20,
      } },
    });

    await userEvent.click(screen.getByRole('combobox', { name: '启用状态' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Disabled' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'DISABLED', page: 1 }));
  });

  it('创建渠道只提交真实合同并进入 canonical Basic Workspace', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([]),
      response: Response.json(result([])),
    } as never);
    const created = {
      id: '00000000-0000-4000-8000-000000000009',
      name: '新渠道',
      description: '创建测试',
      protocol_type: 'openai-compatible-chat-completions',
      provider_brand: 'CUSTOM',
      base_url: 'https://new.example.com/v1',
      timeout_seconds: 30,
      is_enabled: false,
      api_key_configured: true,
      api_key_updated_at: '2026-08-14T08:00:00Z',
      headers: [],
      enabled_models: [],
      latest_test_status: 'UNTESTED',
      last_tested_at: null,
      workflow_stage: 'UNVERIFIED',
      primary_task: 'TEST_MODEL',
      available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
      revision: 0,
      created_by: admin.id,
      created_at: '2026-08-14T08:00:00Z',
      updated_at: '2026-08-14T08:00:00Z',
    } as const;
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: created,
      response: Response.json(created, { status: 201 }),
    } as never);
    const { queryClient, router } = renderAIChannels();

    await userEvent.click(await screen.findByRole('button', { name: '创建渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '创建 AI 渠道' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '渠道名称' }), '新渠道');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '描述' }), '创建测试');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'API 根地址' }), 'https://new.example.com/v1');
    await userEvent.type(within(dialog).getByLabelText(/API Key/), 'create-key-sentinel');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建渠道' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/settings/ai/${created.id}`));
    expect(router.state.location.search).toEqual({ tab: 'basic' });
    expect(post).toHaveBeenCalledWith('/api/v1/ai-channels', {
      body: {
        name: '新渠道',
        description: '创建测试',
        protocol_type: 'openai-compatible-chat-completions',
        provider_brand: 'CUSTOM',
        base_url: 'https://new.example.com/v1',
        api_key: 'create-key-sentinel',
        timeout_seconds: 30,
      },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables)))
      .not.toContain('create-key-sentinel');
    expect(document.body).not.toHaveTextContent('create-key-sentinel');
  });

  it('创建失败后清除 API Key，同时保留可修正的非敏感字段', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([]),
      response: Response.json(result([])),
    } as never);
    vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: { code: 'AI_CHANNEL_NAME_EXISTS', message: '渠道名称已存在', details: {}, request_id: 'req-ai-create' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    const { queryClient } = renderAIChannels();

    await userEvent.click(await screen.findByRole('button', { name: '创建渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '创建 AI 渠道' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '渠道名称' }), '重复渠道');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'API 根地址' }), 'https://duplicate.example.com/v1');
    const apiKey = within(dialog).getByLabelText(/API Key/);
    await userEvent.type(apiKey, 'failed-create-secret');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建渠道' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求 ID：req-ai-create');
    expect(apiKey).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: '渠道名称' })).toHaveValue('重复渠道');
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables)))
      .not.toContain('failed-create-secret');
  });

  it('创建请求挂起并离页时 API Key 不进入共享缓存或 DOM', async () => {
    const sentinel = 'pending-create-key-sentinel';
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([]),
      response: Response.json(result([])),
    } as never);
    let finishCreate: ((response: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      finishCreate = resolve;
    }) as never);
    const { queryClient, view } = renderAIChannels();
    await userEvent.click(await screen.findByRole('button', { name: '创建渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '创建 AI 渠道' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '渠道名称' }), '挂起渠道');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'API 根地址' }), 'https://pending.example.com/v1');
    await userEvent.type(within(dialog).getByLabelText(/API Key/), sentinel);
    await userEvent.click(within(dialog).getByRole('button', { name: '创建渠道' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole('button', { name: '创建中…' })).toBeDisabled();
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((entry) => entry.state.variables)))
      .not.toContain(sentinel);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((entry) => entry.state.data)))
      .not.toContain(sentinel);

    view.unmount();
    expect(document.body).not.toHaveTextContent(sentinel);
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((entry) => entry.state.variables)))
      .not.toContain(sentinel);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((entry) => entry.state.data)))
      .not.toContain(sentinel);
    await act(async () => finishCreate?.({
      error: { error: { code: 'AI_CHANNEL_UNAVAILABLE', message: '创建失败', details: {}, request_id: 'req-pending-create' } },
      response: Response.json({}, { status: 503 }),
    }));
    expect(document.body).not.toHaveTextContent(sentinel);
  });

  it('渠道已创建但打开工作区失败时只重试交接，不重复 POST', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([]),
      response: Response.json(result([])),
    } as never);
    const created = {
      id: '00000000-0000-4000-8000-000000000010',
      name: '交接失败渠道',
      description: null,
      protocol_type: 'openai-compatible-chat-completions',
      provider_brand: 'CUSTOM',
      base_url: 'https://handoff.example.com/v1',
      timeout_seconds: 30,
      is_enabled: false,
      api_key_configured: true,
      api_key_updated_at: '2026-08-14T08:00:00Z',
      headers: [],
      enabled_models: [],
      latest_test_status: 'UNTESTED',
      last_tested_at: null,
      workflow_stage: 'UNVERIFIED',
      primary_task: 'TEST_MODEL',
      available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
      revision: 0,
      created_by: admin.id,
      created_at: '2026-08-14T08:00:00Z',
      updated_at: '2026-08-14T08:00:00Z',
    } as const;
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: created,
      response: Response.json(created, { status: 201 }),
    } as never);
    const { queryClient, router } = renderAIChannels();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(new Error('目标导航暂不可用'));
    await userEvent.click(await screen.findByRole('button', { name: '创建渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '创建 AI 渠道' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '渠道名称' }), '交接失败渠道');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'API 根地址' }), 'https://handoff.example.com/v1');
    await userEvent.type(within(dialog).getByLabelText(/API Key/), 'handoff-key-sentinel');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建渠道' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已创建，但打开工作区失败：目标导航暂不可用');
    expect(post).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: '重新打开渠道' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/settings/ai/${created.id}`));
    expect(post).toHaveBeenCalledOnce();
  });

  it('启用命令携带 revision；409 不自动重放或刷新', async () => {
    const disabled = channel({
      is_enabled: false,
      workflow_stage: 'READY_TO_ENABLE',
      primary_task: 'ENABLE_CHANNEL',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      revision: 7,
    });
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([disabled]),
      response: Response.json(result([disabled])),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: { code: 'REVISION_CONFLICT', message: 'AI 渠道已被其他请求修改', details: {}, request_id: 'req-ai-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderAIChannels();

    await userEvent.click(await screen.findByRole('button', { name: '启用渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '启用渠道“生产 OpenAI”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '启用渠道' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请求 ID：req-ai-conflict');
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/v1/ai-channels/{channel_id}/enable', {
      body: { expected_revision: 7 },
      params: {
        path: { channel_id: disabled.id },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    expect(get).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: '重新加载列表' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledOnce();
  });

  it('删除成功后清除该渠道的工作区缓存', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([channel()]),
      response: Response.json(result([channel()])),
    } as never);
    vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderAIChannels();
    const id = channel().id;
    const ownedKeys = [
      aiChannelKeys.detail(id),
      aiChannelKeys.models(id),
      aiChannelKeys.usage(id, '30d'),
      aiChannelKeys.logs(id, 1, 20),
    ] as const;
    ownedKeys.forEach((key) => queryClient.setQueryData(key, { stale: true }));

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：生产 OpenAI' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除渠道' }));
    const dialog = await screen.findByRole('dialog', { name: '删除渠道“生产 OpenAI”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '删除渠道' }));

    await waitFor(() => ownedKeys.forEach((key) => expect(queryClient.getQueryData(key)).toBeUndefined()));
  });

  it('区分 loading、filtered empty、越界和 ADMIN boundary', async () => {
    let resolveLoading: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation(() => new Promise((resolve) => {
      resolveLoading = resolve;
    }) as never);
    const loading = renderAIChannels();
    expect(await screen.findByRole('rowgroup', { name: '正在加载表格' })).toBeInTheDocument();
    resolveLoading?.({ data: result([]), response: Response.json(result([])) });
    expect(await screen.findByText('暂无 AI 渠道')).toBeInTheDocument();
    loading.view.unmount();
    loading.queryClient.clear();

    get.mockReset().mockResolvedValue({ data: result([]), response: Response.json(result([])) } as never);
    const filtered = renderAIChannels('/settings/ai?q=missing&page=1&pageSize=20');
    expect(await screen.findByText('未找到匹配渠道')).toBeInTheDocument();
    filtered.view.unmount();
    filtered.queryClient.clear();

    get.mockReset().mockResolvedValue({ data: result([], 25), response: Response.json(result([], 25)) } as never);
    const overflow = renderAIChannels('/settings/ai?page=3&pageSize=20');
    expect(await screen.findByText('当前页已超出范围')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回最后一页' }));
    await waitFor(() => expect(overflow.router.state.location.search).toMatchObject({ page: 2 }));
    overflow.view.unmount();

    renderAIChannels('/settings/ai?page=1&pageSize=20', {
      ...auth,
      user: { ...admin, account_type: 'ENGINEER' },
      isAdmin: false,
    });
    expect(await screen.findByRole('heading', { name: '无权访问系统管理' })).toBeInTheDocument();
  });
});

const currentListKey = aiChannelListQueryOptions({ page: 1, pageSize: 20 }).queryKey;
function readyChannel() {
  return channel({ is_enabled: false, workflow_stage: 'READY_TO_ENABLE', primary_task: 'ENABLE_CHANNEL', available_actions: ['UPDATE', 'ENABLE', 'DELETE'], revision: 7 });
}
function listResponse(items: AIChannelSummary[]) {
  return { data: result(items), response: Response.json(result(items)) } as never;
}
async function confirmListCommand(label: string) {
  if (label === '启用渠道') await userEvent.click(await screen.findByRole('button', { name: label }));
  else {
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：生产 OpenAI' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: label }));
  }
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

describe('AI Channel list command boundaries', () => {
  it('启用确认从当前 exact query 读取名称和 revision', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(listResponse([readyChannel()]));
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: channel(), response: Response.json(channel()) } as never);
    const { queryClient } = renderAIChannels();
    await userEvent.click(await screen.findByRole('button', { name: '启用渠道' }));
    await screen.findByRole('dialog', { name: '启用渠道“生产 OpenAI”？' });
    act(() => queryClient.setQueryData(currentListKey, result([{ ...readyChannel(), name: '已更新名称', revision: 12 }])));
    const dialog = await screen.findByRole('dialog', { name: '启用渠道“已更新名称”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '启用渠道' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 12 } });
  });

  it('启用资格撤销或列表读取失败，旧确认不能提交', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(listResponse([readyChannel()]));
    const post = vi.spyOn(api, 'POST');
    const { queryClient } = renderAIChannels();
    await userEvent.click(await screen.findByRole('button', { name: '启用渠道' }));
    await screen.findByRole('dialog');
    get.mockRejectedValue(new Error('列表刷新失败'));
    await act(() => queryClient.refetchQueries({ queryKey: currentListKey, exact: true }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: '启用渠道' })).toBeDisabled());
    act(() => queryClient.setQueryData(currentListKey, result([channel()])));
    const revoked = await screen.findByRole('dialog', { name: '渠道操作已不可用' });
    expect(within(revoked).getByRole('button', { name: '确认执行' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('启用请求 pending 时 Primary 禁用且不能重复派发', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(listResponse([readyChannel()]));
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }) as never);
    renderAIChannels();
    await confirmListCommand('启用渠道');
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const primary = screen.getByRole('button', { name: '启用渠道' });
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(primary);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();
    await act(async () => resolvePost?.({ data: channel(), response: Response.json(channel()) }));
  });

  it.each(['启用渠道', '停用渠道', '删除渠道'])('%s 的 409 仅显式成功刷新解冻；失败或被动成功保留 request ID', async (label) => {
    const source = label === '启用渠道' ? readyChannel() : channel();
    const get = vi.spyOn(api, 'GET').mockResolvedValue(listResponse([source]));
    const rejected = { error: { error: { code: 'AI_CHANNEL_STATE_CHANGED', message: '状态已变化', details: {}, request_id: 'req-command-conflict' } }, response: Response.json({}, { status: 409 }) } as never;
    const post = vi.spyOn(api, 'POST').mockResolvedValue(rejected);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue(rejected);
    const { queryClient } = renderAIChannels();
    await confirmListCommand(label);
    await screen.findByText(/请求 ID：req-command-conflict/);
    get.mockRejectedValue(new Error('重载暂时失败'));
    await userEvent.click(screen.getByRole('button', { name: '重新加载列表' }));
    await screen.findByText(/重载暂时失败/);
    expect(screen.getByText(/请求 ID：req-command-conflict/)).toBeInTheDocument();
    act(() => queryClient.setQueryData(currentListKey, result([{ ...source, revision: 10 }])));
    if (label === '启用渠道') expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true');
    else {
      await userEvent.click(screen.getByRole('button', { name: '更多操作：生产 OpenAI' }));
      expect(await screen.findByRole('menuitem', { name: new RegExp(label) })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.keyboard('{Escape}');
    }
    get.mockResolvedValue(listResponse([{ ...source, revision: 10 }]));
    await userEvent.click(screen.getByRole('button', { name: '重新加载列表' }));
    await waitFor(() => expect(screen.queryByText(/请求 ID：req-command-conflict/)).not.toBeInTheDocument());
    expect(post.mock.calls.length + remove.mock.calls.length).toBe(1);
  });

  it('DELETE 204 后刷新失败也从全部包含目标的列表缓存移除旧行', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(listResponse([channel()]));
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async () => {
      get.mockRejectedValue(new Error('删除后刷新失败'));
      return { response: new Response(null, { status: 204 }) } as never;
    });
    const { queryClient } = renderAIChannels();
    const otherKey = aiChannelListQueryOptions({ page: 1, pageSize: 20, status: 'ENABLED' }).queryKey;
    queryClient.setQueryData(otherKey, result([channel()]));
    await confirmListCommand('删除渠道');
    await screen.findByText(/删除后刷新失败/);
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: '生产 OpenAI' })).not.toBeInTheDocument();
    expect(queryClient.getQueryData<AIChannelList>(currentListKey)?.items).toEqual([]);
    expect(queryClient.getQueryData<AIChannelList>(otherKey)?.items).toEqual([]);
    expect(screen.queryByRole('button', { name: '更多操作：生产 OpenAI' })).not.toBeInTheDocument();
  });
});
