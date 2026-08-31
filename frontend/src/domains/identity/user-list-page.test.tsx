import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { userKeys } from './user.api';
import { userSearchToApiParams } from './user-list.model';

type User = components['schemas']['User'];
type UserList = components['schemas']['UserList'];

const admin = managedUser({
  id: '00000000-0000-4000-8000-000000000099',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  available_actions: [],
  deletion: null,
});

const auth: AuthContextValue = {
  user: admin,
  csrfToken: 'user-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function managedUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'operator',
    display_name: '运营人员',
    account_type: 'ENGINEER',
    is_active: true,
    must_change_password: false,
    workflow_stage: 'ACTIVE',
    primary_task: 'MANAGE_USER',
    available_actions: ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
    deletion: { blockers: [{ type: 'USER_BUSINESS_HISTORY', count: 2 }] },
    revision: 4,
    created_at: '2026-08-16T08:00:00Z',
    ...overrides,
  };
}

function result(items: User[], total = items.length): UserList {
  return {
    items,
    page: 1,
    page_size: 20,
    total,
    summary: {
      user_total: total,
      enabled_total: items.filter((item) => item.is_active).length,
      disabled_total: items.filter((item) => !item.is_active).length,
      must_change_password_total: items.filter((item) => item.must_change_password).length,
      admin_total: items.filter((item) => item.account_type === 'ADMIN').length,
    },
  };
}

function renderUsers(entry = '/system/users?status=ENABLED&page=1&pageSize=20') {
  const queryClient = createAuthenticatedTestQueryClient(auth);
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

describe('UserListPage', () => {
  it('单次 GET 绘制统计、固定列和合同动作', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([managedUser()]),
      response: Response.json(result([managedUser()])),
    } as never);

    renderUsers();
    expect(await screen.findByRole('heading', { name: '用户管理' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '', '用户', '账号类型', '状态', '登录安全', '创建时间', '操作',
    ]);
    expect(screen.getByRole('button', { name: '管理用户' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '用户统计' })).toHaveTextContent('用户总数1');
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/users', {
      params: { query: { q: undefined, account_type: undefined, status: 'ENABLED', page: 1, page_size: 20 } },
    });

    await userEvent.click(screen.getByRole('button', { name: '更多操作：operator' }));
    expect(await screen.findByRole('menuitem', { name: '重置临时密码' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '停用用户' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '查看删除条件' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
    expect(await screen.findByRole('link', { name: '查看审计历史' })).toHaveAttribute(
      'href',
      `/system/audit?actorId=${managedUser().id}`,
    );
    expect(get).toHaveBeenCalledOnce();
  });

  it('URL 恢复筛选并在变化时回到第一页', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([managedUser()], 21),
      response: Response.json(result([managedUser()], 21)),
    } as never);
    const { router } = renderUsers('/system/users?q=operator&accountType=ENGINEER&status=ALL&page=2&pageSize=20');

    expect(await screen.findByRole('searchbox', { name: '搜索用户' })).toHaveValue('operator');
    await userEvent.click(screen.getByRole('combobox', { name: '启用状态' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Disabled' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'DISABLED', page: 1 }));
  });

  it('创建只提交合同字段，完成后销毁临时密码 mutation 变量', async () => {
    const list = result([]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const created = managedUser({ id: '00000000-0000-4000-8000-000000000010', username: 'new-user', revision: 0 });
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: created,
      response: Response.json(created, { status: 201 }),
    } as never);
    const { queryClient } = renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: '新增用户' }));
    const dialog = await screen.findByRole('dialog', { name: '新增用户' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: '用户名' }), 'new-user');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '显示名称' }), '新用户');
    await userEvent.type(within(dialog).getByLabelText(/临时密码/), 'create-secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建用户' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增用户' })).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledWith('/api/v1/users', {
      body: {
        username: 'new-user',
        display_name: '新用户',
        temporary_password: 'create-secret-123',
        account_type: 'ENGINEER',
      },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables)))
      .not.toContain('create-secret-123');
    expect(document.body).not.toHaveTextContent('create-secret-123');
  });

  it('reset 409 保留对话框与输入、不重放，reload 时销毁密码', async () => {
    const target = managedUser({
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE',
      primary_task: 'MANAGE_LOGIN_SECURITY',
      available_actions: ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
      revision: 7,
    });
    const list = result([target]);
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: { code: 'REVISION_CONFLICT', message: '用户已被其他请求修改', details: {}, request_id: 'req-user-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    const { queryClient } = renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: '重置临时密码' }));
    const dialog = await screen.findByRole('dialog', { name: /重置 operator 的临时密码/ });
    const password = within(dialog).getByLabelText(/临时密码/);
    await userEvent.type(password, 'reset-secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: '重置临时密码' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求 ID：req-user-conflict');
    expect(password).toHaveValue('reset-secret-123');
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/v1/users/{user_id}/reset-password', {
      body: { temporary_password: 'reset-secret-123', expected_revision: 7 },
      params: { path: { user_id: target.id }, header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables)))
      .not.toContain('reset-secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载列表' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent('reset-secret-123');
  });

  it('批量停用携带选择时 revision，200 partial 后清空选择并显示脱敏反馈', async () => {
    const target = managedUser();
    const list = result([target]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: {
        succeeded: [],
        failures: [{ user_id: target.id, code: 'REVISION_CONFLICT', message: '修订冲突' }],
      },
      response: Response.json({}, { status: 200 }),
    } as never);
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 operator' }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toHaveTextContent('已选择 1 项');
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    await waitFor(() => expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('operator：修订冲突（REVISION_CONFLICT）');
    expect(post).toHaveBeenCalledWith('/api/v1/users/bulk-status', {
      body: { items: [{ user_id: target.id, expected_revision: 4 }], status: 'DISABLED' },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    });
  });

  it('后台刷新发现已选用户 revision 变化时清空整组选择', async () => {
    const target = managedUser();
    const changed = managedUser({ revision: target.revision + 1 });
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: result([target]), response: Response.json(result([target])) } as never)
      .mockResolvedValue({ data: result([changed]), response: Response.json(result([changed])) } as never);
    const { queryClient } = renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 operator' }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toBeInTheDocument();
    await queryClient.invalidateQueries({ queryKey: ['identity', 'users', 'list'] });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('列表数据已更新，已清除过期选择');
  });

  it('批量顶层失败保留 selection 和停用确认上下文', async () => {
    const target = managedUser();
    const list = result([target]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: { code: 'BULK_FAILED', message: '批量操作失败', details: {}, request_id: 'req-user-bulk-failed' } },
      response: Response.json({}, { status: 503 }),
    } as never);
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 operator' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求 ID：req-user-bulk-failed');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toHaveTextContent('已选择 1 项');
    expect(post).toHaveBeenCalledOnce();
  });

  it('删除用户 Dialog 从 exact users projection 读取最新用户名与 revision', async () => {
    const initial = managedUser({
      username: 'initial-user',
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_USER',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    });
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([initial]),
      response: Response.json(result([initial])),
    } as never);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderUsers();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：initial-user' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));

    const blocked = managedUser({
      ...initial,
      username: 'latest-blocked-user',
      available_actions: ['UPDATE', 'ENABLE'],
      deletion: { blockers: [{ type: 'USER_BUSINESS_HISTORY', count: 3 }] },
    });
    queryClient.setQueryData(
      userKeys.list(userSearchToApiParams({ status: 'ENABLED', page: 1, pageSize: 20 })),
      result([blocked]),
    );
    expect(await screen.findByRole('dialog', { name: '用户 latest-blocked-user 暂不可删除' }))
      .toHaveTextContent('USER_BUSINESS_HISTORY：3');
    expect(screen.queryByRole('button', { name: '删除用户' })).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    const latest = managedUser({
      ...initial,
      username: 'latest-user',
      revision: 10,
    });
    queryClient.setQueryData(
      userKeys.list(userSearchToApiParams({ status: 'ENABLED', page: 1, pageSize: 20 })),
      result([latest]),
    );
    const dialog = await screen.findByRole('dialog', { name: '删除用户“latest-user”？' });
    expect(get).toHaveBeenCalledOnce();
    await userEvent.click(within(dialog).getByRole('button', { name: '删除用户' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(
      '/api/v1/users/{user_id}',
      expect.objectContaining({ params: expect.objectContaining({ query: { expected_revision: 10 } }) }),
    ));
  });

  it('用户删除 409 在被动更新和 403 reload 失败后保持冻结，仅成功 reload 后采用最新 revision', async () => {
    const initial = managedUser({
      username: 'conflicted-user',
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_USER',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
      revision: 8,
    });
    let current = result([initial]);
    let failNextReload = false;
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      if (failNextReload) {
        failNextReload = false;
        return {
          error: { error: { code: 'FORBIDDEN', message: '用户列表权限已变化', details: {}, request_id: 'req-users-reload-forbidden' } },
          response: Response.json({}, { status: 403 }),
        } as never;
      }
      return { data: current, response: Response.json(current) } as never;
    });
    const remove = vi.spyOn(api, 'DELETE')
      .mockResolvedValueOnce({
        error: { error: { code: 'USER_IN_USE', message: '用户仍有业务历史引用', details: {}, request_id: 'req-user-delete-conflict' } },
        response: Response.json({}, { status: 409 }),
      } as never)
      .mockResolvedValueOnce({ response: new Response(null, { status: 204 }) } as never);
    const { queryClient } = renderUsers();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：conflicted-user' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
    const dialog = await screen.findByRole('dialog', { name: '删除用户“conflicted-user”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '删除用户' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求 ID：req-user-delete-conflict');
    expect(remove).toHaveBeenCalledOnce();
    const latest = managedUser({ ...initial, username: 'passive-latest-user', revision: 21 });
    current = result([latest]);
    queryClient.setQueryData(
      userKeys.list(userSearchToApiParams({ status: 'ENABLED', page: 1, pageSize: 20 })),
      current,
    );
    expect(await screen.findByRole('dialog', { name: '删除用户“passive-latest-user”？' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '删除用户' })).toBeDisabled();

    failNextReload = true;
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载当前用户列表' }));
    expect(await within(dialog).findByText(/请求 ID：req-users-reload-forbidden/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '删除用户' })).toBeDisabled();
    expect(remove).toHaveBeenCalledOnce();

    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载当前用户列表' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '删除用户' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: '删除用户' }));
    await waitFor(() => expect(remove).toHaveBeenLastCalledWith(
      '/api/v1/users/{user_id}',
      expect.objectContaining({ params: expect.objectContaining({ query: { expected_revision: 21 } }) }),
    ));
  });

  it('最新 users query 移除目标后关闭删除 Dialog 且不提交', async () => {
    const target = managedUser({
      username: 'vanishing-user',
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_USER',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    });
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([target]),
      response: Response.json(result([target])),
    } as never);
    const remove = vi.spyOn(api, 'DELETE');
    const { queryClient } = renderUsers();
    const trigger = await screen.findByRole('button', { name: '更多操作：vanishing-user' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
    expect(await screen.findByRole('dialog', { name: '删除用户“vanishing-user”？' })).toBeInTheDocument();

    queryClient.setQueryData(
      userKeys.list(userSearchToApiParams({ status: 'ENABLED', page: 1, pageSize: 20 })),
      result([]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });
});
