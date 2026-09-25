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
import { platformKeys } from './platform.api';

type PlatformType = components['schemas']['PlatformType'];
type PlatformTypeList = components['schemas']['PlatformTypeList'];

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
  created_at: '2026-08-13T00:00:00Z',
};

const adminAuth: AuthContextValue = {
  user: adminUser,
  csrfToken: 'platform-type-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function platformType(overrides: Partial<PlatformType> = {}): PlatformType {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    name: '技术社区',
    slug: 'technical-community',
    platform_count: 0,
    available_actions: ['UPDATE', 'DELETE'],
    deletion: { blockers: [] },
    primary_task: 'EDIT_CATEGORY',
    revision: 2,
    created_by: adminUser.id,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

function list(items: PlatformType[]): PlatformTypeList {
  return { items };
}

function response<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function errorResponse(code: string, message: string, details: Record<string, unknown> = {}) {
  const body = { error: { code, message, details, request_id: `request-${code}` } };
  return { error: body, response: Response.json(body, { status: 409 }) } as never;
}

function renderPlatformTypes(auth = adminAuth) {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/platforms/types'] }),
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

describe('PlatformTypesPage', () => {
  it('绘制固定四列、权威数量和 375px card-row 的全部字段与 overflow', async () => {
    const referenced = platformType({
      platform_count: 2,
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 2 }] },
    });
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([referenced])));
    const user = userEvent.setup();
    const { view } = renderPlatformTypes();

    expect(await screen.findByRole('heading', { name: '平台类型' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回平台与账号' })).toHaveAttribute(
      'href',
      '/settings/platforms?page=1&pageSize=20',
    );
    const table = screen.getByRole('region', { name: '平台类型列表' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['名称', 'Slug', '平台数量', '操作']);
    expect(within(table).getByRole('row', { name: /技术社区/ })).toHaveTextContent(
      '技术社区technical-community2',
    );
    const mobile = view.container.querySelector('.sm\\:hidden');
    expect(mobile).not.toBeNull();
    expect(mobile).toHaveTextContent('技术社区');
    expect(mobile).toHaveTextContent('technical-community');
    expect(mobile).toHaveTextContent('平台数量2');
    expect(within(mobile as HTMLElement).getByRole('button', { name: '更多操作：技术社区' }))
      .toBeInTheDocument();

    const trigger = within(table).getByRole('button', { name: '更多操作：技术社区' });
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: '编辑' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
    expect(await screen.findByRole('link', { name: '查看引用平台（2）' })).toHaveAttribute(
      'href',
      `/settings/platforms?platformTypeId=${referenced.id}&page=1&pageSize=20`,
    );
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' })[0]!);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('覆盖 loading、empty 与 error retry', async () => {
    let resolveList: ((value: ReturnType<typeof response<PlatformTypeList>>) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation(() => new Promise((resolve) => {
      resolveList = resolve as typeof resolveList;
    }) as never);
    const first = renderPlatformTypes();
    expect(await screen.findByLabelText('正在加载平台类型')).toBeInTheDocument();
    resolveList?.(response(list([])));
    expect((await screen.findAllByText('暂无平台类型')).length).toBeGreaterThan(0);
    first.view.unmount();

    get.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: '读取失败', details: {}, request_id: 'request-error' } },
      response: Response.json({}, { status: 500 }),
    } as never);
    renderPlatformTypes();
    expect((await screen.findAllByText(/读取失败/)).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: '重试' })[0]!);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it('创建时 trim Name、保留 Slug 规则并恢复创建按钮焦点', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(list([])));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(platformType({
      name: '行业媒体',
      slug: 'industry-media',
    })));
    const user = userEvent.setup();
    renderPlatformTypes();
    const trigger = await screen.findByRole('button', { name: '新建平台类型' });
    await user.click(trigger);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  行业媒体  ');
    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'industry-media');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/platform-types', {
      body: { name: '行业媒体', slug: 'industry-media' },
      params: { header: { 'X-CSRF-Token': 'platform-type-csrf' } },
    }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it('创建成功立即接受 canonical 并关闭 Dialog，不等待消费者失效完成', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([])));
    const saved = platformType({ name: 'Canonical 新类型', slug: 'canonical-type' });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(saved));
    const { queryClient } = renderPlatformTypes();
    await screen.findByRole('heading', { name: '平台类型' });
    const invalidation = new Promise<void>(() => undefined);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);

    await userEvent.click(screen.getByRole('button', { name: '新建平台类型' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Canonical 新类型');
    await userEvent.type(screen.getByRole('textbox', { name: 'Slug' }), 'canonical-type');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: '平台类型列表' }))
      .toHaveTextContent('Canonical 新类型canonical-type0');
    expect(post).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('编辑冲突保留输入，显式 reload 后才采用服务端 revision', async () => {
    let current = platformType();
    vi.spyOn(api, 'GET').mockImplementation(async () => response(list([current])));
    const patch = vi.spyOn(api, 'PATCH')
      .mockResolvedValueOnce(errorResponse('REVISION_CONFLICT', '平台类型已被其他请求修改'))
      .mockImplementationOnce(async (_path, options) => response(platformType({
        ...(options as { body: Record<string, unknown> }).body,
        revision: 5,
      })));
    const user = userEvent.setup();
    renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });
    const trigger = within(table).getByRole('button', { name: '更多操作：技术社区' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: '编辑' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, '本地输入');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText(/当前输入已保留/)).toBeInTheDocument();
    expect(name).toHaveValue('本地输入');
    expect(patch).toHaveBeenCalledTimes(1);
    current = platformType({ name: '服务端名称', revision: 4 });
    await user.click(screen.getByRole('button', { name: '重新读取服务端版本' }));
    await waitFor(() => expect(name).toHaveValue('服务端名称'));
    await user.clear(name);
    await user.type(name, '最终名称');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patch).toHaveBeenLastCalledWith(
      '/api/v1/platform-types/{platform_type_id}',
      expect.objectContaining({
        body: { name: '最终名称', slug: 'technical-community', expected_revision: 4 },
      }),
    ));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('编辑成功后的消费者失效失败只显示刷新 Notice，不会重发 PATCH', async () => {
    const initial = platformType();
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([initial])));
    const saved = platformType({ name: '服务端 Canonical', revision: 3 });
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(response(saved));
    const user = userEvent.setup();
    const { queryClient } = renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('types invalidation failed'))
      .mockRejectedValueOnce(new Error('lists invalidation failed'))
      .mockRejectedValueOnce(new Error('details invalidation failed'))
      .mockResolvedValue(undefined);

    await user.click(within(table).getByRole('button', { name: '更多操作：技术社区' }));
    await user.click(await screen.findByRole('menuitem', { name: '编辑' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, '服务端 Canonical');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(table).toHaveTextContent('服务端 Canonical');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作已成功，但刷新相关数据失败：types invalidation failed',
    );
    expect(patch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(screen.queryByText(/操作已成功，但刷新相关数据失败/)).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledTimes(6);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('删除只从 DELETE token 进入，提交 revision 并在竞态 blocker 时给出精确链接', async () => {
    let current = platformType();
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(list([current])))
      .mockResolvedValueOnce({
        error: { error: { code: 'LIST_REFRESH_FAILED', message: '平台类型刷新失败', details: {}, request_id: 'req-type-reload-failed' } },
        response: Response.json({}, { status: 500 }),
      } as never)
      .mockImplementation(async () => response(list([current])));
    const remove = vi.spyOn(api, 'DELETE')
      .mockResolvedValueOnce(errorResponse('REVISION_CONFLICT', '平台类型已被其他请求修改'))
      .mockResolvedValueOnce(errorResponse('PLATFORM_TYPE_IN_USE', '平台类型仍被引用', {
        references: [{ type: 'PLATFORM_PROFILE', count: 1 }],
    }));
    const user = userEvent.setup();
    renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });
    const trigger = within(table).getByRole('button', { name: '更多操作：技术社区' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByText(/已被其他请求修改/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenLastCalledWith(
      '/api/v1/platform-types/{platform_type_id}',
      expect.objectContaining({
        params: expect.objectContaining({ query: { expected_revision: 2 } }),
      }),
    );
    await user.click(screen.getByRole('button', { name: '重新读取服务端版本' }));
    expect(await within(screen.getByRole('dialog')).findByText(/平台类型刷新失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(1);

    current = platformType({ revision: 3 });
    await user.click(screen.getByRole('button', { name: '重新读取服务端版本' }));
    expect(await screen.findByText('已读取 revision 3，请重新确认。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('link', { name: '查看引用平台（1）' })).toHaveAttribute(
      'href',
      `/settings/platforms?platformTypeId=${current.id}&page=1&pageSize=20`,
    );
    expect(remove).toHaveBeenLastCalledWith(
      '/api/v1/platform-types/{platform_type_id}',
      expect.objectContaining({
        params: expect.objectContaining({ query: { expected_revision: 3 } }),
      }),
    );
  });

  it('成功删除后先从当前 types query 移除目标并关闭 Dialog', async () => {
    const target = platformType();
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([target])));
    vi.spyOn(api, 'DELETE').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const user = userEvent.setup();
    const { queryClient } = renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });
    const trigger = within(table).getByRole('button', { name: '更多操作：技术社区' });
    const invalidation = new Promise<void>(() => undefined);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).not.toBeInTheDocument();
    expect(queryClient.getQueryData<PlatformTypeList>(platformKeys.types())?.items).toEqual([]);
    expect(api.DELETE).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('删除 Dialog 随 exact types projection 在可删与 blocker 间切换并提交最新 revision', async () => {
    const initial = platformType({ name: '初始类型' });
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(list([initial])));
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderPlatformTypes();
    const trigger = (await screen.findAllByRole('button', { name: '更多操作：初始类型' }))[0]!;
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));

    const blocked = platformType({
      ...initial,
      name: '最新阻断类型',
      platform_count: 1,
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 1 }] },
      revision: 8,
    });
    queryClient.setQueryData(platformKeys.types(), list([blocked]));
    expect(await screen.findByRole('dialog', { name: '平台类型暂时不能删除' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();

    const latest = platformType({
      ...initial,
      name: '最新可删类型',
      revision: 9,
    });
    queryClient.setQueryData(platformKeys.types(), list([latest]));
    expect(await screen.findByText('将删除“最新可删类型”。服务端会校验当前 revision 与平台引用。'))
      .toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(
      '/api/v1/platform-types/{platform_type_id}',
      expect.objectContaining({ params: expect.objectContaining({ query: { expected_revision: 9 } }) }),
    ));
  });

  it('按 Type ID 保留删除 409，关闭重开与其他 Type reload 都不能绕过 hold', async () => {
    const firstId = '00000000-0000-4000-8000-000000000010';
    const secondId = '00000000-0000-4000-8000-000000000011';
    let current = [
      platformType({ id: firstId, name: '类型 A' }),
      platformType({ id: secondId, name: '类型 B' }),
    ];
    vi.spyOn(api, 'GET').mockImplementation(async () => response(list(current)));
    const remove = vi.spyOn(api, 'DELETE')
      .mockResolvedValueOnce(errorResponse('REVISION_CONFLICT', '类型 A 已被其他请求修改'))
      .mockResolvedValueOnce(errorResponse('PLATFORM_TYPE_IN_USE', '类型 B 仍被引用', {
        references: [{ type: 'PLATFORM_PROFILE', count: 1 }],
      }));
    const user = userEvent.setup();
    const { queryClient } = renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });
    const openDelete = async (name: string) => {
      await user.click(await within(table).findByRole('button', { name: `更多操作：${name}` }));
      await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    };
    const closeDelete = async () => {
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    };

    await openDelete('类型 A');
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText(/类型 A 已被其他请求修改/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
    await closeDelete();

    queryClient.setQueryData(platformKeys.types(), list([
      platformType({ id: firstId, name: '类型 A 新名称', revision: 4 }),
      current[1]!,
    ]));
    await openDelete('类型 A 新名称');
    expect(await screen.findByText(/类型 A 已被其他请求修改/)).toBeInTheDocument();
    expect(screen.getByText(/将删除“类型 A 新名称”/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(1);
    await closeDelete();

    await openDelete('类型 B');
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText(/类型 B 仍被引用/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看引用平台（1）' })).toHaveAttribute(
      'href',
      `/settings/platforms?platformTypeId=${secondId}&page=1&pageSize=20`,
    );
    expect(remove).toHaveBeenCalledTimes(2);
    await closeDelete();

    current = [
      platformType({ id: firstId, name: '类型 A', revision: 7 }),
      platformType({ id: secondId, name: '类型 B', revision: 8 }),
    ];
    await openDelete('类型 A 新名称');
    expect(await screen.findByText(/类型 A 已被其他请求修改/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新读取服务端版本' }));
    expect(await screen.findByText('已读取 revision 7，请重新确认。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled();
    await closeDelete();

    await openDelete('类型 B');
    expect(await screen.findByText(/类型 B 仍被引用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('最新 types query 移除目标后关闭删除 Dialog 且不提交', async () => {
    const target = platformType({ name: '即将消失的类型' });
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([target])));
    const remove = vi.spyOn(api, 'DELETE');
    const { queryClient } = renderPlatformTypes();
    const trigger = (await screen.findAllByRole('button', { name: '更多操作：即将消失的类型' }))[0]!;
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(await screen.findByRole('dialog', { name: '删除平台类型？' })).toBeInTheDocument();

    queryClient.setQueryData(platformKeys.types(), list([]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('成功 types projection 确认目标消失后只清该 Type 的删除 hold', async () => {
    const target = platformType({ name: '短暂消失的类型' });
    vi.spyOn(api, 'GET').mockResolvedValue(response(list([target])));
    const remove = vi.spyOn(api, 'DELETE')
      .mockResolvedValueOnce(errorResponse('REVISION_CONFLICT', '目标 revision 冲突'));
    const user = userEvent.setup();
    const { queryClient } = renderPlatformTypes();
    const table = await screen.findByRole('region', { name: '平台类型列表' });

    await user.click(within(table).getByRole('button', { name: '更多操作：短暂消失的类型' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText(/目标 revision 冲突/)).toBeInTheDocument();

    queryClient.setQueryData(platformKeys.types(), list([]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    queryClient.setQueryData(platformKeys.types(), list([{ ...target, revision: 3 }]));
    const restoredTrigger = await within(table).findByRole('button', {
      name: '更多操作：短暂消失的类型',
    });
    await user.click(restoredTrigger);
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));

    expect(screen.queryByText(/目标 revision 冲突/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('非管理员由既有 admin boundary 明确拒绝', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'FORBIDDEN', message: '无权访问', details: {}, request_id: 'request-403' } },
      response: Response.json({}, { status: 403 }),
    } as never);
    renderPlatformTypes({
      ...adminAuth,
      user: { ...adminUser, account_type: 'ENGINEER' },
      isAdmin: false,
    });

    expect(await screen.findByRole('heading', { name: '无权访问系统管理' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '平台类型' })).not.toBeInTheDocument();
  });
});
