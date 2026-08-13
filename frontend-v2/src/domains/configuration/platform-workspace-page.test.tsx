import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileDetail = components['schemas']['PlatformProfileDetail'];
type PlatformAccount = components['schemas']['PlatformAccount'];

const platformId = '00000000-0000-4000-8000-000000000001';
const typeId = '00000000-0000-4000-8000-000000000010';
const promptId = '00000000-0000-4000-8000-000000000020';
const secondPromptId = '00000000-0000-4000-8000-000000000021';
const adminUser: AuthUser = {
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
  user: adminUser,
  csrfToken: 'platform-workspace-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function profile(overrides: Partial<PlatformProfile> = {}): PlatformProfile {
  return {
    id: platformId,
    name: '工程师社区',
    slug: 'engineer-community',
    allowed_domains: ['community.example.invalid'],
    platform_type_id: typeId,
    platform_type: { id: typeId, name: '技术社区', slug: 'technical-community' },
    website_url: 'https://community.example.invalid/',
    logo: { source: 'EXTERNAL', url: 'https://cdn.example.invalid/community.png' },
    revision: 4,
    is_active: true,
    platform_prompt: {
      id: promptId,
      name: '社区 Prompt',
      revision: 2,
      updated_at: '2026-08-10T00:00:00Z',
    },
    configuration_complete: true,
    platform_account_count: 2,
    enabled_platform_account_count: 1,
    readiness_status: 'COMPLETE',
    workflow_stage: 'OPERATIONAL',
    primary_task: 'VIEW_PLATFORM_OPERATION',
    available_actions: ['UPDATE', 'DISABLE'],
    deletion: { blockers: [{ type: 'CONTENT_TASK', count: 1 }] },
    updated_at: '2026-08-11T00:00:00Z',
    ...overrides,
  };
}

function workspaceDetail(currentProfile = profile()): PlatformProfileDetail {
  return {
    profile: currentProfile,
    account_summary: { total: 2, enabled: 1, disabled: 1 },
    reference_summary: {
      as_of: '2026-08-12T00:00:00Z',
      recent_30_days: 3,
      all_time: 8,
    },
    platform_type_options: [
      { id: typeId, name: '技术社区', slug: 'technical-community' },
      {
        id: '00000000-0000-4000-8000-000000000011',
        name: '行业媒体',
        slug: 'industry-media',
      },
    ],
  };
}

const accounts = {
  items: [
    {
      platform_profile_id: platformId,
      label: '运营主账号',
      account_identifier: 'community-main',
      id: '00000000-0000-4000-8000-000000000030',
      is_active: true,
      workflow_stage: 'OPERATIONAL',
      primary_task: 'MANAGE_ACCOUNT',
      available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
      deletion: { blockers: [] },
      revision: 1,
    },
    {
      platform_profile_id: platformId,
      label: '停用账号',
      account_identifier: 'community-disabled',
      id: '00000000-0000-4000-8000-000000000031',
      is_active: false,
      workflow_stage: 'ACCOUNT_DISABLED',
      primary_task: 'ENABLE_ACCOUNT',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
      revision: 2,
    },
  ],
} satisfies components['schemas']['PlatformAccountList'];

const prompts = {
  items: [
    {
      id: promptId,
      name: '社区 Prompt',
      revision: 2,
      updated_at: '2026-08-10T00:00:00Z',
      updated_by: adminUser.id,
      bound_platform_count: 1,
      available_actions: ['UPDATE', 'DELETE'],
    },
    {
      id: secondPromptId,
      name: '长文 Prompt',
      revision: 5,
      updated_at: '2026-08-11T00:00:00Z',
      updated_by: adminUser.id,
      bound_platform_count: 0,
      available_actions: ['UPDATE', 'DELETE'],
    },
  ],
} satisfies components['schemas']['PlatformPromptList'];

function response<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function renderWorkspace(
  entry = `/settings/platforms/${platformId}?tab=overview`,
  authContext = auth,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

function mockWorkspaceReads(current: () => PlatformProfileDetail) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(current());
    if (path === '/api/v1/platform-accounts') return response(accounts);
    if (path === '/api/v1/platform-prompts') return response(prompts);
    throw new Error(`测试收到未声明 GET：${path}`);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('PlatformWorkspacePage', () => {
  it('首屏只请求 Detail，三个 URL Tab 按需读取并支持历史恢复', async () => {
    const get = mockWorkspaceReads(() => workspaceDetail());
    const { router } = renderWorkspace();

    expect(await screen.findByRole('heading', { level: 1, name: '工程师社区' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: '面包屑' })).toHaveTextContent('平台工作区');

    await userEvent.click(screen.getByRole('tab', { name: '发布账号' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'accounts' }));
    expect((await screen.findAllByText('运营主账号')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('community-main').length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: '平台' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '生成配置' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'generation' }));
    expect(await screen.findByRole('combobox', { name: '绑定 Prompt' })).toBeInTheDocument();
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/platform-profiles/{platform_profile_id}',
      '/api/v1/platform-accounts',
      '/api/v1/platform-prompts',
    ]);

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'accounts' }));
    router.history.forward();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'generation' }));
  });

  it('Overview dirty 状态阻断 Tab，取消恢复；保存提交单个 PATCH 与精确 cache keys', async () => {
    let current = workspaceDetail();
    mockWorkspaceReads(() => current);
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: components['schemas']['PlatformProfileUpdate'] }).body;
      current = workspaceDetail(profile({ name: body.name, revision: 5 }));
      return response(current.profile);
    });
    const { queryClient, router } = renderWorkspace();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const name = await screen.findByRole('textbox', { name: '平台名称' });
    await userEvent.clear(name);
    await userEvent.type(name, '工程师内容社区');
    await userEvent.click(screen.getByRole('tab', { name: '发布账号' }));
    const guard = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await userEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
    expect(name).toHaveValue('工程师内容社区');
    expect(router.state.location.search).toEqual({ tab: 'overview' });

    await userEvent.click(screen.getByRole('button', { name: '保存概览' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      '/api/v1/platform-profiles/{platform_profile_id}',
      {
        body: {
          expected_revision: 4,
          name: '工程师内容社区',
          allowed_domains: ['community.example.invalid'],
          platform_type_id: typeId,
          platform_prompt_id: promptId,
          website_url: 'https://community.example.invalid/',
        },
        params: {
          path: { platform_profile_id: platformId },
          header: { 'X-CSRF-Token': auth.csrfToken },
        },
      },
    ));
    expect(await screen.findByRole('heading', { level: 1, name: '工程师内容社区' })).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'detail', platformId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['content', 'tasks', 'platform-references'] });
    expect(queryClient.getQueryState(['configuration', 'platforms', 'detail', platformId])).toBeDefined();
  });

  it('官网 Logo 候选必须二次确认，SVG 明确拒绝，保存才绑定 file_id', async () => {
    let current = workspaceDetail();
    mockWorkspaceReads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-logo-candidates') {
        return response({
          file_id: '00000000-0000-4000-8000-000000000040',
          preview: {
            url: 'https://storage.example.invalid/logo.png',
            expires_at: '2026-08-13T01:00:00Z',
          },
        });
      }
      throw new Error(`测试收到未声明 POST：${path}`);
    });
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: components['schemas']['PlatformProfileUpdate'] }).body;
      current = workspaceDetail(profile({
        logo: body.logo ? { ...body.logo, url: 'https://storage.example.invalid/logo.png' } : null,
        revision: 5,
      }));
      return response(current.profile);
    });
    renderWorkspace();

    const fileInput = await screen.findByLabelText('上传平台 Logo');
    await userEvent.upload(fileInput, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('不接受 SVG');
    expect(post).not.toHaveBeenCalled();

    await userEvent.upload(
      fileInput,
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('不能超过 2 MiB');
    expect(post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '从官网导入候选' }));
    expect(await screen.findByAltText('官网 Logo 候选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存概览' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '使用此候选' }));
    await userEvent.click(screen.getByRole('button', { name: '保存概览' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      '/api/v1/platform-profiles/{platform_profile_id}',
      expect.objectContaining({
        body: expect.objectContaining({
          expected_revision: 4,
          logo: {
            source: 'UPLOAD',
            file_id: '00000000-0000-4000-8000-000000000040',
          },
        }),
      }),
    ));
  });

  it('Generation 409 保留用户选择，ENGINEER 读取同页但不请求管理 options', async () => {
    const get = mockWorkspaceReads(() => workspaceDetail());
    vi.spyOn(api, 'PATCH').mockResolvedValue({
      error: {
        error: {
          code: 'REVISION_CONFLICT',
          message: '平台已被其他请求修改',
          details: {},
          request_id: 'req-platform-conflict',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);
    const adminView = renderWorkspace(`/settings/platforms/${platformId}?tab=generation`);

    const select = await screen.findByRole('combobox', { name: '绑定 Prompt' });
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: '不绑定 Prompt' }));
    await userEvent.click(screen.getByRole('button', { name: '保存生成配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('平台已被其他请求修改');
    expect(screen.getByRole('combobox', { name: '绑定 Prompt' })).toHaveTextContent('不绑定 Prompt');
    expect(screen.getByRole('button', { name: '重新加载服务端版本' })).toBeInTheDocument();
    adminView.view.unmount();
    adminView.queryClient.clear();

    get.mockReset().mockImplementation(async (path) => {
      if (path !== '/api/v1/platform-profiles/{platform_profile_id}') {
        throw new Error(`ENGINEER 不应请求管理 options：${path}`);
      }
      return response(workspaceDetail(profile({
        primary_task: null,
        available_actions: [],
        deletion: null,
      })));
    });
    renderWorkspace(`/settings/platforms/${platformId}?tab=generation`, {
      ...auth,
      user: { ...adminUser, account_type: 'ENGINEER' },
      isAdmin: false,
    });
    expect(await screen.findByText('当前账号可读取绑定关系，但没有修改生成配置的服务端动作。')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '绑定 Prompt' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([
    [404, '未找到平台'],
    [403, '无法访问 Platform Workspace'],
  ])('区分 HTTP %s 预期错误', async (status, heading) => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: {
        error: {
          code: status === 404 ? 'PLATFORM_NOT_FOUND' : 'PERMISSION_DENIED',
          message: heading,
          details: {},
          request_id: `req-${status}`,
        },
      },
      response: Response.json({}, { status }),
    } as never);
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('ADMIN 在平台上下文完成账号创建与编辑，并精确失效消费者', async () => {
    const currentAccounts: components['schemas']['PlatformAccountList'] = structuredClone(accounts);
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(workspaceDetail());
      if (path === '/api/v1/platform-accounts') return response(currentAccounts);
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path, options) => {
      if (path === '/api/v1/platform-accounts') {
        const body = (options as unknown as { body: components['schemas']['PlatformAccountCreate'] }).body;
        const created: PlatformAccount = {
          ...body,
          id: '00000000-0000-4000-8000-000000000032',
          is_active: true,
          workflow_stage: 'OPERATIONAL',
          primary_task: 'MANAGE_ACCOUNT',
          available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
          deletion: { blockers: [] },
          revision: 0,
        };
        currentAccounts.items.push(created);
        return response(created);
      }
      if (path === '/api/v1/platform-accounts/{platform_account_id}/enable') {
        const body = (options as unknown as { body: { expected_revision: number } }).body;
        const current = currentAccounts.items[1]!;
        expect(body.expected_revision).toBe(current.revision);
        const updated: PlatformAccount = {
          ...current,
          is_active: true,
          workflow_stage: 'OPERATIONAL',
          primary_task: 'MANAGE_ACCOUNT',
          available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
          revision: current.revision + 1,
        };
        currentAccounts.items[1] = updated;
        return response(updated);
      }
      throw new Error(`测试收到未声明 POST：${path}`);
    });
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: components['schemas']['PlatformAccountUpdate'] }).body;
      const current = currentAccounts.items[0]!;
      expect(body.expected_revision).toBe(current.revision);
      const updated = {
        ...current,
        label: body.label,
        account_identifier: body.account_identifier,
        revision: current.revision + 1,
      };
      currentAccounts.items[0] = updated;
      return response(updated);
    });
    const { queryClient } = renderWorkspace(`/settings/platforms/${platformId}?tab=accounts`);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const createButton = await screen.findByRole('button', { name: '创建发布账号' });
    await userEvent.click(createButton);
    let dialog = screen.getByRole('dialog', { name: '创建发布账号' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '业务标签' }), '备用账号');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '内部账号标识' }), 'community-backup');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建账号' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/platform-accounts',
      expect.objectContaining({
        body: {
          platform_profile_id: platformId,
          label: '备用账号',
          account_identifier: 'community-backup',
        },
      }),
    ));
    await waitFor(() => expect(createButton).toHaveFocus());

    await userEvent.click(screen.getAllByRole('button', { name: '编辑账号' })[0]!);
    dialog = screen.getByRole('dialog', { name: '编辑发布账号' });
    const label = within(dialog).getByRole('textbox', { name: '业务标签' });
    await userEvent.clear(label);
    await userEvent.type(label, '主运营账号');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存账号' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑发布账号' })).not.toBeInTheDocument());
    await screen.findAllByText('主运营账号');

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'detail', platformId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', platformId, 'accounts'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['publication', 'ready-items'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['publication', 'works', 'workspace-context'] });
  });

  it('账号停用与删除提交各自当前 revision', async () => {
    const currentAccounts: components['schemas']['PlatformAccountList'] = structuredClone(accounts);
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(workspaceDetail());
      if (path === '/api/v1/platform-accounts') return response(currentAccounts);
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: { expected_revision: number } }).body;
      const current = currentAccounts.items[0]!;
      expect(body.expected_revision).toBe(current.revision);
      const updated: PlatformAccount = {
        ...current,
        is_active: false,
        workflow_stage: 'ACCOUNT_DISABLED',
        primary_task: 'ENABLE_ACCOUNT',
        available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
        revision: current.revision + 1,
      };
      currentAccounts.items[0] = updated;
      return response(updated);
    });
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async (_path, options) => {
      const params = (options as unknown as {
        params: { query: { expected_revision: number }; path: { platform_account_id: string } };
      }).params;
      const current = currentAccounts.items.find((item) => item.id === params.path.platform_account_id)!;
      expect(params.query.expected_revision).toBe(current.revision);
      currentAccounts.items = currentAccounts.items.filter((item) => item.id !== current.id);
      return { response: new Response(null, { status: 204 }) } as never;
    });
    renderWorkspace(`/settings/platforms/${platformId}?tab=accounts`);
    await screen.findAllByText('运营主账号');

    await userEvent.click(screen.getAllByRole('button', { name: '更多操作：运营主账号' })[0]!);
    let menu = await screen.findByRole('menu', { name: '更多操作：运营主账号' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: '停用账号' }));
    let dialog = await screen.findByRole('dialog', { name: '停用发布账号“运营主账号”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认停用' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '停用发布账号“运营主账号”？' })).not.toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: '更多操作：运营主账号' })[0]!);
    menu = await screen.findByRole('menu', { name: '更多操作：运营主账号' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: '删除账号' }));
    dialog = await screen.findByRole('dialog', { name: '删除发布账号“运营主账号”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
  });

  it('账号字段冲突与 revision conflict 保留输入，显式 reload 后才接受 canonical', async () => {
    const currentAccounts: components['schemas']['PlatformAccountList'] = structuredClone(accounts);
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(workspaceDetail());
      if (path === '/api/v1/platform-accounts') return response(currentAccounts);
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: {
        code: 'PLATFORM_ACCOUNT_IDENTIFIER_EXISTS',
        message: '该平台已存在相同的运营账号标识',
        details: { errors: [{ loc: ['body', 'account_identifier'], msg: '账号标识已存在' }] },
        request_id: 'req-account-duplicate',
      } },
      response: Response.json({}, { status: 409 }),
    } as never);
    vi.spyOn(api, 'PATCH').mockResolvedValue({
      error: { error: {
        code: 'REVISION_CONFLICT',
        message: '发布账号已被其他请求修改',
        details: {},
        request_id: 'req-account-conflict',
      } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderWorkspace(`/settings/platforms/${platformId}?tab=accounts`);

    await userEvent.click(await screen.findByRole('button', { name: '创建发布账号' }));
    let dialog = screen.getByRole('dialog', { name: '创建发布账号' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '业务标签' }), '重复账号');
    const identifier = within(dialog).getByRole('textbox', { name: '内部账号标识' });
    await userEvent.type(identifier, ' COMMUNITY-MAIN ');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建账号' }));
    expect((await within(dialog).findAllByText('账号标识已存在')).length).toBeGreaterThan(0);
    expect(identifier).toHaveValue(' COMMUNITY-MAIN ');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建发布账号' })).not.toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: '编辑账号' })[0]!);
    dialog = screen.getByRole('dialog', { name: '编辑发布账号' });
    const label = within(dialog).getByRole('textbox', { name: '业务标签' });
    await userEvent.clear(label);
    await userEvent.type(label, '未提交名称');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存账号' }));
    expect(await within(dialog).findByText(/当前输入已保留/)).toBeInTheDocument();
    expect(label).toHaveValue('未提交名称');

    currentAccounts.items[0] = { ...currentAccounts.items[0]!, label: '服务端名称', revision: 9 };
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载服务端版本' }));
    await waitFor(() => expect(label).toHaveValue('服务端名称'));
  });

  it('blocker 与 ENGINEER 无删除 projection 均只按服务端动作展示', async () => {
    const blocked: components['schemas']['PlatformAccountList'] = {
      items: [{
        ...accounts.items[0] as PlatformAccount,
        available_actions: ['UPDATE', 'DISABLE'],
        deletion: { blockers: [{ type: 'PUBLICATION_WORK', count: 2 }] },
      }],
    };
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(workspaceDetail());
      if (path === '/api/v1/platform-accounts') return response(blocked);
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    renderWorkspace(`/settings/platforms/${platformId}?tab=accounts`, {
      ...auth,
      user: { ...adminUser, account_type: 'ENGINEER' },
      isAdmin: false,
    });
    expect(await screen.findByRole('button', { name: '创建发布账号' })).toBeInTheDocument();
    await screen.findAllByText('运营主账号');
    await userEvent.click(screen.getAllByRole('button', { name: '更多操作：运营主账号' })[0]!);
    expect(screen.queryByRole('menuitem', { name: '删除账号' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('menuitem', { name: '查看删除条件' }));
    const dialog = await screen.findByRole('dialog', { name: '发布账号暂时不能删除' });
    expect(within(dialog).getByText(/发布工作：2/)).toBeInTheDocument();
  });

  it('账号空状态保持页面级创建入口', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles/{platform_profile_id}') return response(workspaceDetail());
      if (path === '/api/v1/platform-accounts') return response({ items: [] });
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    renderWorkspace(`/settings/platforms/${platformId}?tab=accounts`);
    expect(await screen.findByText(/创建第一个账号/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建发布账号' })).toBeInTheDocument();
  });
});
