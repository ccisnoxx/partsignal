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

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileList = components['schemas']['PlatformProfileList'];

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
  csrfToken: 'platform-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const platformType = {
  id: '00000000-0000-4000-8000-000000000010',
  name: '技术社区',
  slug: 'technical-community',
};

function platform(overrides: Partial<PlatformProfile> = {}): PlatformProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: '工程师社区',
    slug: 'engineer-community',
    allowed_domains: ['community.example.invalid'],
    platform_type_id: platformType.id,
    platform_type: platformType,
    website_url: null,
    logo: { source: 'EXTERNAL', url: 'https://cdn.example.invalid/community.png' },
    revision: 4,
    is_active: true,
    platform_prompt: {
      id: '00000000-0000-4000-8000-000000000020',
      name: '社区 Prompt',
      revision: 1,
      updated_at: '2026-08-08T00:00:00Z',
    },
    configuration_complete: true,
    platform_account_count: 3,
    enabled_platform_account_count: 2,
    readiness_status: 'COMPLETE',
    workflow_stage: 'OPERATIONAL',
    primary_task: 'VIEW_PLATFORM_OPERATION',
    available_actions: ['UPDATE', 'DISABLE'],
    deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
    updated_at: '2026-08-09T00:00:00Z',
    ...overrides,
  };
}

function result(items: PlatformProfile[], total = items.length): PlatformProfileList {
  return {
    items,
    page: 1,
    page_size: 20,
    total,
    summary: {
      platform_total: total,
      enabled_total: items.filter((item) => item.is_active).length,
      missing_prompt_total: items.filter((item) => item.readiness_status === 'MISSING_PROMPT').length,
      configuration_complete_total: items.filter((item) => item.configuration_complete).length,
      readiness_complete_total: items.filter((item) => item.readiness_status === 'COMPLETE').length,
      missing_account_total: items.filter((item) => item.readiness_status === 'MISSING_ACCOUNT').length,
    },
    platform_type_options: [platformType],
  };
}

function renderPlatforms(entry = '/settings/platforms?page=1&pageSize=20') {
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

afterEach(() => vi.restoreAllMocks());

describe('PlatformListPage', () => {
  it('单次 GET 绘制七列、摘要、缺失值、三态和 actor-aware actions', async () => {
    const engineer = platform({
      id: '00000000-0000-4000-8000-000000000002',
      name: '只读平台',
      platform_type_id: null,
      platform_type: null,
      logo: null,
      platform_prompt: null,
      configuration_complete: false,
      enabled_platform_account_count: 0,
      readiness_status: 'MISSING_PROMPT',
      workflow_stage: 'GENERATION_UNCONFIGURED',
      primary_task: null,
      available_actions: [],
      deletion: null,
      updated_at: null,
    });
    const missingAccount = platform({
      id: '00000000-0000-4000-8000-000000000004',
      name: '缺账号平台',
      logo: null,
      enabled_platform_account_count: 0,
      readiness_status: 'MISSING_ACCOUNT',
    });
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([platform(), engineer, missingAccount]),
      response: Response.json(result([platform(), engineer, missingAccount])),
    } as never);

    const { view } = renderPlatforms();
    expect(await screen.findByRole('heading', { name: '平台与账号' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '平台', '类型', '配置状态', '发布账号', '状态', '更新时间', '操作',
    ]);
    expect(screen.getByRole('region', { name: '全部平台摘要' })).toHaveTextContent('缺 Prompt 1 · 缺账号 1');
    expect(screen.getByRole('link', { name: '工程师社区' })).toHaveAttribute(
      'href',
      '/settings/platforms/00000000-0000-4000-8000-000000000001?tab=overview',
    );
    expect(screen.getByText('2 个可用')).toBeInTheDocument();
    expect(screen.getByText('未归类')).toBeInTheDocument();
    expect(screen.getByText('无可用操作')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /缺账号平台/ })).getByText('缺账号'))
      .toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /工程师社区/ })).getByRole('link', { name: '查看运营' }))
      .toBeInTheDocument();
    expect(view.container.querySelectorAll('img')).toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/api/v1/platform-profiles', {
      params: { query: {
        q: undefined,
        platform_type_id: undefined,
        status: undefined,
        readiness_status: undefined,
        page: 1,
        page_size: 20,
      } },
    });

    await userEvent.click(screen.getByRole('button', { name: '更多操作：工程师社区' }));
    expect(await screen.findByRole('menuitem', { name: '编辑平台' })).toHaveAttribute(
      'href',
      '/settings/platforms/00000000-0000-4000-8000-000000000001?tab=overview',
    );
    expect(screen.getByRole('menuitem', { name: '停用平台' })).toBeInTheDocument();
  });

  it('区分 loading、filtered empty 与 error retry，并由 URL 恢复搜索', async () => {
    let resolveLoading: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation(() => new Promise((resolve) => {
      resolveLoading = resolve;
    }) as never);
    const first = renderPlatforms();
    expect(await screen.findByRole('rowgroup', { name: '正在加载表格' })).toBeInTheDocument();
    resolveLoading?.({ data: result([]), response: Response.json(result([])) });
    expect(await screen.findByText('暂无平台')).toBeInTheDocument();
    first.view.unmount();
    first.queryClient.clear();

    get.mockResolvedValueOnce({ data: result([]), response: Response.json(result([])) } as never);
    const filtered = renderPlatforms('/settings/platforms?q=missing&page=1&pageSize=20');
    expect(await screen.findByText('未找到匹配平台')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索平台' })).toHaveValue('missing');
    filtered.view.unmount();

    get.mockResolvedValueOnce({
      error: { error: { code: 'PLATFORMS_UNAVAILABLE', message: '平台服务暂不可用', details: {}, request_id: 'req-platforms' } },
      response: Response.json({}, { status: 503 }),
    } as never).mockResolvedValueOnce({
      data: result([platform()]),
      response: Response.json(result([platform()])),
    } as never);
    renderPlatforms('/settings/platforms?q=error&page=1&pageSize=20');
    expect(await screen.findByRole('alert')).toHaveTextContent('平台服务暂不可用');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: '工程师社区' })).toBeInTheDocument();
  });

  it('筛选和 pageSize 变化回第一页，翻页保留 URL 状态', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([platform()], 25),
      response: Response.json(result([platform()], 25)),
    } as never);
    const { router } = renderPlatforms('/settings/platforms?page=2&pageSize=20');
    await screen.findByRole('link', { name: '工程师社区' });

    const query = screen.getByRole('searchbox', { name: '搜索平台' });
    await userEvent.type(query, '社区');
    await userEvent.click(screen.getByRole('button', { name: /^搜索$/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: '社区', page: 1 }));

    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: '社区', page: 2 }));
    expect(get.mock.calls.at(-1)?.[1]).toEqual({ params: { query: expect.objectContaining({ q: '社区', page: 2 }) } });
  });

  it('刷新失败保留 stale rows，越界页返回最后一页', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({
        data: result([platform()]),
        response: Response.json(result([platform()])),
      } as never)
      .mockResolvedValueOnce({
        error: { error: { code: 'PLATFORMS_UNAVAILABLE', message: '刷新暂不可用', details: {}, request_id: 'req-platforms-stale' } },
        response: Response.json({}, { status: 503 }),
      } as never);
    const stale = renderPlatforms();
    await screen.findByRole('link', { name: '工程师社区' });
    await stale.queryClient.refetchQueries();
    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败，已保留当前列表');
    expect(screen.getByRole('link', { name: '工程师社区' })).toBeInTheDocument();
    stale.view.unmount();
    stale.queryClient.clear();

    get.mockReset().mockResolvedValue({
      data: result([], 25),
      response: Response.json(result([], 25)),
    } as never);
    const overflow = renderPlatforms('/settings/platforms?page=3&pageSize=20');
    expect(await screen.findByText('当前页已超出范围')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回最后一页' }));
    await waitFor(() => expect(overflow.router.state.location.search).toMatchObject({ page: 2 }));
  });

  it('删除 blocker 恢复焦点，409 携带 revision 且不自动重放', async () => {
    const blocked = platform({ available_actions: ['UPDATE'], deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] } });
    const deletable = platform({
      id: '00000000-0000-4000-8000-000000000003',
      name: '待删除平台',
      revision: 7,
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_PLATFORM',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    });
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([blocked, deletable]),
      response: Response.json(result([blocked, deletable])),
    } as never);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: { error: { code: 'REVISION_CONFLICT', message: '平台已被其他请求修改', details: {}, request_id: 'req-platform-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderPlatforms();

    const blockedTrigger = await screen.findByRole('button', { name: '更多操作：工程师社区' });
    await userEvent.click(blockedTrigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '查看删除条件' }));
    const blockers = await screen.findByRole('dialog', { name: '“工程师社区”当前不能删除' });
    expect(within(blockers).getByText('开放内容任务')).toBeInTheDocument();
    await userEvent.click(within(blockers).getAllByRole('button', { name: '关闭' })[0]!);
    await waitFor(() => expect(blockedTrigger).toHaveFocus());

    await userEvent.click(screen.getByRole('button', { name: '更多操作：待删除平台' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除平台' }));
    const confirm = await screen.findByRole('dialog', { name: '确认删除平台“待删除平台”' });
    await userEvent.click(within(confirm).getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('平台已被其他请求修改（请求 ID：req-platform-conflict）');
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('/api/v1/platform-profiles/{platform_profile_id}', {
      params: {
        path: { platform_profile_id: deletable.id },
        query: { expected_revision: 7 },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
