import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authSessionQueryKey, type AuthContextValue } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (!auth.user || !auth.csrfToken) throw new Error('用户管理测试必须提供登录会话');
  queryClient.setQueryData(authSessionQueryKey, { user: auth.user, csrfToken: auth.csrfToken });
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
});
