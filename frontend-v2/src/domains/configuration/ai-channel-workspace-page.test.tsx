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

type AIChannel = components['schemas']['AIChannel'];

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

afterEach(() => vi.restoreAllMocks());

describe('AIChannelWorkspacePage', () => {
  it('canonicalize UUID/tab，且未交付 tab 与非法 UUID 都不发送 Detail 请求', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(success(channel()));
    const canonical = renderWorkspace(`/settings/ai/${channelId.toUpperCase()}`);
    expect(await screen.findByRole('heading', { name: '生产 OpenAI' })).toBeInTheDocument();
    expect(canonical.router.state.location.pathname).toBe(`/settings/ai/${channelId}`);
    expect(canonical.router.state.location.search).toEqual({ tab: 'basic' });
    expect(get).toHaveBeenCalledOnce();
    canonical.view.unmount();
    canonical.queryClient.clear();

    get.mockClear();
    const unavailable = renderWorkspace(`/settings/ai/${channelId}?tab=models`);
    expect(await screen.findByRole('heading', { name: '该 AI 渠道区域尚未交付' })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    unavailable.view.unmount();
    unavailable.queryClient.clear();

    renderWorkspace('/settings/ai/not-a-uuid?tab=basic');
    expect(await screen.findByText(/不是有效 UUID/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
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
