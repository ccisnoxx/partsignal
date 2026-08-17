import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { aiChannelKeys } from './ai-channel.api';

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
