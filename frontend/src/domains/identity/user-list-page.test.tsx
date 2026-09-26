import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authSessionQueryKey,
  type AuthContextValue,
  type AuthSession,
} from '@/app/auth/auth-provider';
import {
  advancePrincipalEpoch,
  capturePrincipalContinuation,
} from '@/app/auth/principal-epoch';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { UserRequestError, bulkUpdateUserStatus, userKeys } from './user.api';
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
  reconcileUnknownPrincipalResult: vi.fn(async () => {}),
  runPrincipalBoundary: vi.fn(async (command) => command(
    new AbortController().signal,
    { assertCanSend: () => {} },
  )),
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

function renderUsers(
  entry = '/system/users?status=ENABLED&page=1&pageSize=20',
  authContext: AuthContextValue = auth,
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

  it('用户名 duplicate 只定位 username，保留安全草稿、清除密码并允许显式重试', async () => {
    const list = result([]);
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const created = managedUser({ id: '00000000-0000-4000-8000-000000000010', username: 'renamed-user', revision: 0 });
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce({
      error: {
        error: {
          code: 'USER_USERNAME_EXISTS',
          message: '服务端用户名冲突',
          details: {
            errors: [{ loc: ['body', 'username'], msg: '用户名已存在', type: 'user_username_exists' }],
          },
          request_id: 'req-user-duplicate',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never).mockResolvedValueOnce({
      data: created,
      response: Response.json(created, { status: 201 }),
    } as never);
    const { queryClient } = renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: '新增用户' }));
    const dialog = await screen.findByRole('dialog', { name: '新增用户' });
    const username = within(dialog).getByRole('textbox', { name: '用户名' });
    const displayName = within(dialog).getByRole('textbox', { name: '显示名称' });
    const password = within(dialog).getByLabelText(/临时密码/);
    await userEvent.type(username, 'existing-user');
    await userEvent.type(displayName, '保留名称');
    await userEvent.type(password, 'duplicate-secret-123');
    await userEvent.click(within(dialog).getByRole('combobox', { name: '账号类型' }));
    await userEvent.click(await screen.findByRole('option', { name: 'ADMIN' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '创建用户' }));

    expect(await within(dialog).findByText('用户名已存在', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('请求 ID：req-user-duplicate');
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAttribute('aria-describedby', 'user-create-username-error');
    expect(username).toHaveFocus();
    expect(username).toHaveValue('existing-user');
    expect(displayName).toHaveValue('保留名称');
    expect(within(dialog).getByRole('combobox', { name: '账号类型' })).toHaveTextContent('ADMIN');
    expect(password).toHaveValue('');
    expect(get).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    await waitFor(() => expect(JSON.stringify(
      queryClient.getMutationCache().getAll().map((item) => item.state.variables),
    )).not.toContain('duplicate-secret-123'));
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/users', {
      body: {
        username: 'existing-user',
        display_name: '保留名称',
        temporary_password: 'duplicate-secret-123',
        account_type: 'ADMIN',
      },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    });

    await userEvent.clear(username);
    await userEvent.type(username, 'renamed-user');
    await userEvent.type(password, 'retry-secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建用户' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增用户' })).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/users', {
      body: {
        username: 'renamed-user',
        display_name: '保留名称',
        temporary_password: 'retry-secret-123',
        account_type: 'ADMIN',
      },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('malformed 或未知 duplicate diagnostics 只显示 summary，不猜字段且清除密码', async () => {
    const list = result([]);
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: {
        error: {
          code: 'USER_USERNAME_EXISTS',
          message: '用户名已存在，请检查输入',
          details: { errors: [{ loc: ['body', 'display_name'], msg: '用户名已存在' }] },
          request_id: 'req-user-malformed',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);
    const { queryClient } = renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: '新增用户' }));
    const dialog = await screen.findByRole('dialog', { name: '新增用户' });
    const username = within(dialog).getByRole('textbox', { name: '用户名' });
    const displayName = within(dialog).getByRole('textbox', { name: '显示名称' });
    const password = within(dialog).getByLabelText(/临时密码/);
    await userEvent.type(username, 'existing-user');
    await userEvent.type(displayName, '保留名称');
    await userEvent.type(password, 'malformed-secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建用户' }));

    const summary = await within(dialog).findByRole('alert', { name: '请修正以下问题' });
    expect(summary).toHaveTextContent('用户名已存在，请检查输入');
    expect(summary).toHaveTextContent('请求 ID：req-user-malformed');
    expect(username).toHaveAttribute('aria-invalid', 'false');
    expect(username).not.toHaveAttribute('aria-describedby', 'user-create-username-error');
    expect(username).toHaveValue('existing-user');
    expect(displayName).toHaveValue('保留名称');
    expect(within(dialog).getByRole('combobox', { name: '账号类型' })).toHaveTextContent('ENGINEER');
    expect(password).toHaveValue('');
    expect(screen.getByRole('dialog', { name: '新增用户' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    await waitFor(() => expect(JSON.stringify(
      queryClient.getMutationCache().getAll().map((item) => item.state.variables),
    )).not.toContain('malformed-secret-123'));
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

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务端提交结果未知');
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
    let dialog = await screen.findByRole('dialog', { name: '删除用户“conflicted-user”？' });
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

    await userEvent.click(within(dialog).getAllByRole('button', { name: '关闭' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: '更多操作：passive-latest-user' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
    dialog = await screen.findByRole('dialog', { name: '删除用户“passive-latest-user”？' });
    expect(within(dialog).getByRole('button', { name: '删除用户' })).toBeDisabled();
    expect(within(dialog).getByText(/请求 ID：req-user-delete-conflict/)).toBeInTheDocument();

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

  it('两个用户先后删除 409 时，各自冻结不会被另一目标覆盖', async () => {
    const first = managedUser({
      username: 'first-conflict',
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_USER',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    });
    const second = managedUser({ ...first, id: '00000000-0000-4000-8000-000000000008', username: 'second-conflict' });
    const list = result([first, second]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: { error: { code: 'USER_IN_USE', message: '用户仍有业务历史引用', details: {}, request_id: 'req-two-users-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderUsers();

    for (const username of ['first-conflict', 'second-conflict']) {
      await userEvent.click(await screen.findByRole('button', { name: `更多操作：${username}` }));
      await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
      const dialog = await screen.findByRole('dialog', { name: `删除用户“${username}”？` });
      await userEvent.click(within(dialog).getByRole('button', { name: '删除用户' }));
      expect(await within(dialog).findByText(/req-two-users-conflict/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getAllByRole('button', { name: '关闭' })[0]!);
    }
    expect(remove).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: '更多操作：first-conflict' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
    const firstAgain = await screen.findByRole('dialog', { name: '删除用户“first-conflict”？' });
    expect(within(firstAgain).getByRole('button', { name: '删除用户' })).toBeDisabled();
    await userEvent.click(within(firstAgain).getByRole('button', { name: '重新加载当前用户列表' }));
    await waitFor(() => expect(within(firstAgain).getByRole('button', { name: '删除用户' })).toBeEnabled());
    await userEvent.click(within(firstAgain).getAllByRole('button', { name: '关闭' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: '更多操作：second-conflict' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除用户' }));
    const secondAgain = await screen.findByRole('dialog', { name: '删除用户“second-conflict”？' });
    expect(within(secondAgain).getByRole('button', { name: '删除用户' })).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(2);
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


describe('Users lifecycle boundaries', () => {
  it.each(['create', 'reset'] as const)('%s pending 离开页面时密码从未进入共享 cache，迟到响应不回写 DOM', async (kind) => {
    const target = managedUser({ must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE', primary_task: 'MANAGE_LOGIN_SECURITY' });
    const list = result([target]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }) as never);
    const { queryClient, view } = renderUsers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: kind === 'create' ? '新增用户' : '重置临时密码' }));
    const dialog = await screen.findByRole('dialog');
    if (kind === 'create') {
      await userEvent.type(within(dialog).getByRole('textbox', { name: '用户名' }), 'pending-user');
      await userEvent.type(within(dialog).getByRole('textbox', { name: '显示名称' }), '等待中的用户');
    }
    const secret = `pending-${kind}-password-123`;
    await userEvent.type(within(dialog).getByLabelText(/临时密码/), secret);
    await userEvent.click(within(dialog).getByRole('button', { name: kind === 'create' ? '创建用户' : '重置临时密码' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const assertNoCachedSecret = () => {
      expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state))).not.toContain(secret);
      expect(JSON.stringify(queryClient.getQueryCache().getAll().map((item) => item.state))).not.toContain(secret);
    };
    assertNoCachedSecret();
    view.unmount();
    assertNoCachedSecret();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await act(async () => resolvePost?.({ data: target, response: Response.json(target) }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.lists() });
    assertNoCachedSecret();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['scope', 'selection', 'missing', 'revision'] as const)('bulk 确认在 %s 漂移后撤销，旧确认不能提交', async (change) => {
    const target = managedUser();
    const list = result([target]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST');
    const { queryClient, router } = renderUsers();
    const checkbox = await screen.findByRole('checkbox', { name: '选择用户 operator' });
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    const confirm = within(dialog).getByRole('button', { name: '批量停用' });
    if (change === 'scope') {
      await act(() => router.navigate({ to: '/system/users', search: { q: 'new', status: 'ENABLED', page: 1, pageSize: 20 } }));
    } else {
      act(() => {
        if (change === 'selection') fireEvent.click(checkbox);
        else queryClient.setQueryData(userKeys.list(userSearchToApiParams({ status: 'ENABLED', page: 1, pageSize: 20 })), result(change === 'missing' ? [] : [{ ...target, revision: target.revision + 1 }]));
        // 同一事件批次先改变权威来源，再触发旧节点：不能依赖下一次 React render。
        fireEvent.click(confirm);
      });
    }
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '批量停用 1 个用户？' })).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['scope', 'selection'] as const)('旧 bulk 响应迟到后不清除 %s 的新选择', async (change) => {
    const first = managedUser();
    const second = managedUser({ id: '00000000-0000-4000-8000-000000000007', username: 'second-user' });
    vi.spyOn(api, 'GET').mockImplementation(async (_path, options) => {
      const q = (options as { params?: { query?: { q?: string } } })?.params?.query?.q;
      const data = result(q === 'new' ? [second] : [first]);
      return { data, response: Response.json(data) } as never;
    });
    let finishBulk: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { finishBulk = resolve; }) as never);
    const { router } = renderUsers();
    const firstCheckbox = await screen.findByRole('checkbox', { name: '选择用户 operator' });
    await userEvent.click(firstCheckbox);
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    if (change === 'scope') {
      await act(() => router.navigate({ to: '/system/users', search: { q: 'new', status: 'ENABLED', page: 1, pageSize: 20 } }));
      await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 second-user' }));
    } else {
      await userEvent.click(firstCheckbox);
      await userEvent.click(firstCheckbox);
    }
    await act(async () => finishBulk?.({
      data: { succeeded: [], failures: [{ user_id: first.id, code: 'REVISION_CONFLICT', message: '旧范围冲突' }] },
      response: Response.json({}, { status: 200 }),
    }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toHaveTextContent('已选择 1 项');
    if (change === 'scope') {
      expect(screen.getByRole('checkbox', { name: '选择用户 second-user' })).toBeChecked();
      expect(screen.queryByText(/旧范围冲突/)).not.toBeInTheDocument();
    } else {
      expect(firstCheckbox).toBeChecked();
    }
    expect(post).toHaveBeenCalledOnce();
  });

  it.each(['role', 'status'] as const)('当前管理员 %s 成功变化立即刷新 auth，不等待 Users invalidation', async (kind) => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    const list = result([current]);
    vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const saved = kind === 'role' ? { ...current, account_type: 'ENGINEER', revision: current.revision + 1 } : { ...current, is_active: false, revision: current.revision + 1 };
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({ data: saved, response: Response.json(saved) } as never);
    const refresh = vi.spyOn(auth, 'refresh').mockResolvedValue(undefined).mockClear();
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const { queryClient } = renderUsers();
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    await userEvent.click(await screen.findByRole('button', { name: '管理用户' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑用户 admin' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: kind === 'role' ? '账号类型' : '状态' }));
    await userEvent.click(await screen.findByRole('option', { name: kind === 'role' ? 'ENGINEER' : 'Disabled' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    await waitFor(() => expect(boundary).toHaveBeenCalledOnce());
    expect(refresh).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith('/api/v1/users/{user_id}', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('当前管理员单次停用从请求发出前进入 principal boundary', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    const saved = { ...current, is_active: false, revision: current.revision + 1 };
    vi.spyOn(api, 'GET').mockResolvedValue({ data: result([current]), response: Response.json(result([current])) } as never);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({ data: saved, response: Response.json(saved) } as never);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const refresh = vi.spyOn(auth, 'refresh').mockResolvedValue(undefined).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：admin' }));
    expect(screen.queryByRole('menuitem', { name: '重置临时密码' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: '停用用户' }));
    const dialog = await screen.findByRole('dialog', { name: '停用用户“admin”？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '停用用户' }));

    await waitFor(() => expect(boundary).toHaveBeenCalledOnce());
    expect(boundary.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]!);
    expect(patch).toHaveBeenCalledWith('/api/v1/users/{user_id}', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('批量停用只有当前主体实际成功后才执行 post-result canonical reconciliation', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    const saved = { ...current, is_active: false, revision: current.revision + 1 };
    vi.spyOn(api, 'GET').mockResolvedValue({ data: result([current]), response: Response.json(result([current])) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: { succeeded: [saved], failures: [] },
      response: Response.json({}, { status: 200 }),
    } as never);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult).mockClear();
    const refresh = vi.spyOn(auth, 'refresh').mockResolvedValue(undefined).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    await waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(reconcile.mock.invocationCallOrder[0]!);
    expect(boundary).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('成功 1，失败 0');
  });

  it('较早 binding reconciliation 不能替代 bulk exact success 后的 canonical boundary', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    const saved = { ...current, is_active: false, revision: current.revision + 1 };
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([current]),
      response: Response.json(result([current])),
    } as never);
    let releaseBulk!: (value: unknown) => void;
    const events: string[] = [];
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      events.push('bulk-started');
      releaseBulk = (value) => {
        events.push('bulk-result-known');
        resolve(value);
      };
    }) as never);
    const reconcile = vi.fn(async () => {
      events.push('post-result-reconciliation');
      expect(events).toEqual([
        'bulk-started',
        'earlier-binding-reconciliation',
        'bulk-result-known',
        'post-result-reconciliation',
      ]);
      advancePrincipalEpoch(queryClient, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0],
      });
      queryClient.setQueryData<AuthSession | null>(authSessionQueryKey, null);
    });
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const authContext: AuthContextValue = {
      ...auth,
      reconcileUnknownPrincipalResult: reconcile,
      runPrincipalBoundary: boundary,
    };
    const { queryClient } = renderUsers(undefined, authContext);
    const commandContinuation = capturePrincipalContinuation(queryClient);
    queryClient.setQueryData(['audit', 'bulk-stale-command'], { value: '旧 ADMIN 缓存' });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: '批量停用 1 个用户？' }))
      .getByRole('button', { name: '批量停用' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());

    const replacementSession: AuthSession = {
      user: { ...current, revision: current.revision + 1 },
      csrfToken: 'replacement-csrf',
      sessionBinding: 'b'.repeat(64),
    };
    advancePrincipalEpoch(queryClient, JSON.stringify([
      replacementSession.sessionBinding,
      replacementSession.user.id,
      replacementSession.user.account_type,
      replacementSession.user.is_active,
      replacementSession.user.must_change_password,
      replacementSession.user.workflow_stage,
    ]));
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0],
    });
    queryClient.setQueryData(authSessionQueryKey, replacementSession);
    events.push('earlier-binding-reconciliation');
    expect(commandContinuation.isCurrent()).toBe(false);

    await act(async () => releaseBulk({
      data: { succeeded: [saved], failures: [] },
      response: Response.json({}, { status: 200 }),
    }));

    await waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(authSessionQueryKey)).toBeNull();
    expect(queryClient.getQueryData(['audit', 'bulk-stale-command'])).toBeUndefined();
    expect(screen.queryByText('批量操作完成：成功 1，失败 0')).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: userKeys.lists() });
  });

  it('批量停用当前主体失败时不进入 principal boundary', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([current]),
      response: Response.json(result([current])),
    } as never);
    vi.spyOn(api, 'POST').mockResolvedValue({
      data: {
        succeeded: [],
        failures: [{ user_id: current.id, code: 'REVISION_CONFLICT', message: '修订冲突' }],
      },
      response: Response.json({}, { status: 200 }),
    } as never);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    expect(await screen.findByRole('status')).toHaveTextContent('成功 0，失败 1');
    expect(boundary).not.toHaveBeenCalled();
  });

  it('批量停用包含当前主体且 transport 结果未知时执行一次 canonical principal reconciliation', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([current]),
      response: Response.json(result([current])),
    } as never);
    const transportError = new TypeError('Failed to fetch');
    const post = vi.spyOn(api, 'POST').mockRejectedValue(transportError);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult!).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    await waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled();
  });

  it('批量停用当前主体收到结构化 HTTP 失败时不把结果误判为 unknown', async () => {
    const current = { ...admin, available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'] };
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([current]),
      response: Response.json(result([current])),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      error: {
        error: {
          code: 'INVALID_REQUEST',
          message: '批量操作未提交',
          details: {},
          request_id: 'req-current-bulk-failed',
        },
      },
      response: Response.json({}, { status: 422 }),
    } as never);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult!).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 1 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('req-current-bulk-failed');
    expect(post).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  describe('canonical current actor UUID', () => {
    const currentId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const current = managedUser({
      ...admin,
      id: currentId,
      available_actions: ['UPDATE', 'DISABLE'],
    });
    const uppercaseAuth: AuthContextValue = {
      ...auth,
      user: { ...admin, id: currentId.toUpperCase() },
    };

    it('uppercase actor 的 exact success 使用 canonical request/response 并进入 post-result reconciliation', async () => {
      vi.spyOn(api, 'GET').mockResolvedValue({
        data: result([current]),
        response: Response.json(result([current])),
      } as never);
      const post = vi.spyOn(api, 'POST').mockResolvedValue({
        data: {
          succeeded: [{ ...current, id: currentId.toUpperCase(), is_active: false }],
          failures: [],
        },
        response: Response.json({}, { status: 200 }),
      } as never);
      const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
      const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult).mockClear();
      renderUsers(undefined, uppercaseAuth);

      await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
      await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: '批量停用 1 个用户？' }))
        .getByRole('button', { name: '批量停用' }));

      await waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
      expect(boundary).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith('/api/v1/users/bulk-status', expect.objectContaining({
        body: {
          items: [{ expected_revision: current.revision, user_id: currentId }],
          status: 'DISABLED',
        },
      }));
    });

    it('uppercase actor 的 explicit failure 不进入 boundary 或 unknown reconciliation', async () => {
      vi.spyOn(api, 'GET').mockResolvedValue({
        data: result([current]),
        response: Response.json(result([current])),
      } as never);
      vi.spyOn(api, 'POST').mockResolvedValue({
        data: {
          succeeded: [],
          failures: [{
            user_id: currentId.toUpperCase(),
            code: 'REVISION_CONFLICT',
            message: '修订冲突',
          }],
        },
        response: Response.json({}, { status: 200 }),
      } as never);
      const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
      const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult).mockClear();
      renderUsers(undefined, uppercaseAuth);

      await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
      await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: '批量停用 1 个用户？' }))
        .getByRole('button', { name: '批量停用' }));

      expect(await screen.findByRole('status')).toHaveTextContent('成功 0，失败 1');
      expect(boundary).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
    });

    it('uppercase actor 的 unknown 只提交一次并执行一次 canonical reconciliation', async () => {
      vi.spyOn(api, 'GET').mockResolvedValue({
        data: result([current]),
        response: Response.json(result([current])),
      } as never);
      const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('Failed to fetch'));
      const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult).mockClear();
      renderUsers(undefined, uppercaseAuth);

      await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
      await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: '批量停用 1 个用户？' }))
        .getByRole('button', { name: '批量停用' }));

      await waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
      expect(post).toHaveBeenCalledOnce();
    });

    it('uppercase actor 的 self-edit 在请求前进入 boundary 并使用 canonical path', async () => {
      vi.spyOn(api, 'GET').mockResolvedValue({
        data: result([current]),
        response: Response.json(result([current])),
      } as never);
      const saved = { ...current, id: currentId.toUpperCase(), account_type: 'ENGINEER' as const };
      const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({
        data: saved,
        response: Response.json(saved),
      } as never);
      const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
      renderUsers(undefined, uppercaseAuth);

      await userEvent.click(await screen.findByRole('button', { name: '管理用户' }));
      const dialog = await screen.findByRole('dialog', { name: '编辑用户 admin' });
      await userEvent.click(within(dialog).getByRole('combobox', { name: '账号类型' }));
      await userEvent.click(await screen.findByRole('option', { name: 'ENGINEER' }));
      await userEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));

      await waitFor(() => expect(boundary).toHaveBeenCalledOnce());
      expect(boundary.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]!);
      expect(patch).toHaveBeenCalledWith('/api/v1/users/{user_id}', expect.objectContaining({
        params: expect.objectContaining({ path: { user_id: currentId } }),
      }));
    });
  });
});

describe('bulk status exact response boundary', () => {
  const current = {
    ...admin,
    available_actions: ['UPDATE', 'DISABLE'] as User['available_actions'],
  };
  const peer = managedUser({
    id: '00000000-0000-4000-8000-000000000007',
    username: 'peer-user',
  });
  const outsider = managedUser({
    id: '00000000-0000-4000-8000-000000000008',
    username: 'outsider-user',
  });
  const currentDisabled = { ...current, is_active: false, revision: current.revision + 1 };
  const peerDisabled = { ...peer, is_active: false, revision: peer.revision + 1 };
  const failure = (userId: string) => ({
    user_id: userId,
    code: 'REVISION_CONFLICT' as const,
    message: '修订冲突',
  });
  type ApiOutcome = {
    data?: unknown;
    error?: unknown;
    response: Response;
  } | Error;
  const resolved = (data: unknown, status = 200): ApiOutcome => ({
    data,
    response: Response.json({}, { status }),
  });
  const rejected = (error: Error): ApiOutcome => error;

  it.each([
    ['200 缺少 current actor', resolved({ succeeded: [peerDisabled], failures: [] })],
    ['200 缺少非 current actor 请求项', resolved({ succeeded: [currentDisabled], failures: [] })],
    ['success 内重复 ID', resolved({ succeeded: [currentDisabled, currentDisabled, peerDisabled], failures: [] })],
    ['failure 内重复 ID', resolved({ succeeded: [peerDisabled], failures: [failure(current.id), failure(current.id)] })],
    ['success/failure 交叉 ID', resolved({ succeeded: [currentDisabled, peerDisabled], failures: [failure(current.id)] })],
    ['响应含请求外 ID', resolved({ succeeded: [currentDisabled, peerDisabled, { ...outsider, is_active: false }], failures: [] })],
    ['success user 状态与目标状态不一致', resolved({ succeeded: [current, peerDisabled], failures: [] })],
    ['空 success/failure 但请求非空', resolved({ succeeded: [], failures: [] })],
    ['畸形 200', resolved({ succeeded: 'not-an-array', failures: [] })],
    ['4xx 缺少 details', {
      error: { error: { code: 'INVALID_REQUEST', message: '未提交', request_id: 'req-no-details' } },
      response: Response.json({}, { status: 422 }),
    }],
    ['4xx 缺少 request_id', {
      error: { error: { code: 'INVALID_REQUEST', message: '未提交', details: {} } },
      response: Response.json({}, { status: 422 }),
    }],
    ['4xx 字段类型错误', {
      error: { error: { code: 422, message: '未提交', details: [], request_id: 'req-wrong-types' } },
      response: Response.json({}, { status: 422 }),
    }],
    ['4xx 含合同禁止的额外字段', {
      error: {
        error: {
          code: 'INVALID_REQUEST',
          message: '未提交',
          details: {},
          request_id: 'req-extra-field',
          submitted: false,
        },
      },
      response: Response.json({}, { status: 422 }),
    }],
    ['transport error', rejected(new TypeError('Failed to fetch'))],
    ['abort/response loss', rejected(new DOMException('The operation was aborted', 'AbortError'))],
    ['畸形 JSON', rejected(new SyntaxError('Unexpected end of JSON input'))],
    ['意外 HTTP 状态', {
      error: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '服务暂不可用',
          details: {},
          request_id: 'req-unexpected-status',
        },
      },
      response: Response.json({}, { status: 503 }),
    }],
  ] as const)('%s 只提交一次并执行一次 canonical reconciliation', async (_name, outcome) => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([current, peer]),
      response: Response.json(result([current, peer])),
    } as never);
    const post = vi.spyOn(api, 'POST');
    if ('response' in outcome) post.mockResolvedValue(outcome as never);
    else post.mockRejectedValue(outcome);
    const boundary = vi.mocked(auth.runPrincipalBoundary).mockClear();
    const reconcile = vi.mocked(auth.reconcileUnknownPrincipalResult!).mockClear();
    renderUsers();

    await userEvent.click(await screen.findByRole('checkbox', { name: '选择用户 admin' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '选择用户 peer-user' }));
    await userEvent.click(screen.getByRole('button', { name: '批量停用' }));
    const dialog = await screen.findByRole('dialog', { name: '批量停用 2 个用户？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务端提交结果未知');
    expect(post).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled();
    expect(screen.queryByText(/批量操作完成：/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toHaveTextContent('已选择 2 项');
  });

  it.each([
    ['重复 user_id', [
      { user_id: admin.id, expected_revision: admin.revision },
      { user_id: admin.id, expected_revision: admin.revision },
    ]],
    ['大小写不同但 identity 相同的 user_id', [
      { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expected_revision: 1 },
      { user_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', expected_revision: 1 },
    ]],
    ['非法 user_id', [{ user_id: 'not-a-stable-user-id', expected_revision: admin.revision }]],
  ] as const)('%s 在发送前显式拒绝', async (_name, items) => {
    const post = vi.spyOn(api, 'POST');
    await expect(bulkUpdateUserStatus([...items], 'DISABLED', auth.csrfToken))
      .rejects.toBeInstanceOf(UserRequestError);
    expect(post).not.toHaveBeenCalled();
  });
});
