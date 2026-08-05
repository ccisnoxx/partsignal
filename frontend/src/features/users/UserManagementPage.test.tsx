/** 验证用户管理只消费服务端统计、筛选分页和命令结果。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { AuthProvider } from '../auth/AuthProvider';
import { UserManagementPage } from './UserManagementPage';

const admin = {
  id: '10000000-0000-4000-8000-000000000001', username: 'admin', display_name: '管理员',
  account_type: 'ADMIN', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: ['UPDATE', 'DISABLE'], revision: 1, created_at: '2026-07-10T00:00:00Z',
  deletion: null,
} satisfies Schema<'User'>;

const inactiveEngineer = {
  id: '10000000-0000-4000-8000-000000000002', username: 'inactive-engineer', display_name: '停用工程师',
  account_type: 'ENGINEER', is_active: false, must_change_password: true, workflow_stage: 'DISABLED', primary_task: 'ENABLE_USER', available_actions: ['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DELETE'], revision: 2, created_at: '2026-07-11T00:00:00Z',
  deletion: { blockers: [] },
} satisfies Schema<'User'>;

const activeEngineer = {
  ...inactiveEngineer,
  username: 'active-engineer',
  display_name: '启用工程师',
  is_active: true,
  workflow_stage: 'FIRST_PASSWORD_CHANGE',
  primary_task: 'MANAGE_LOGIN_SECURITY',
  available_actions: ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
} satisfies Schema<'User'>;

const summary = {
  user_total: 2,
  enabled_total: 1,
  disabled_total: 1,
  must_change_password_total: 1,
  admin_total: 1,
} satisfies Schema<'UserSummary'>;

function userList(items: Schema<'User'>[], query: URLSearchParams): Schema<'UserList'> {
  return {
    items,
    page: Number(query.get('page') ?? 1),
    page_size: Number(query.get('page_size') ?? 20),
    total: items.length,
    summary,
  };
}

function renderPage() {
  return render(
    <ThemeProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/users" element={<UserManagementPage />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ThemeProvider>,
  );
}

beforeEach(() => queryClient.clear());

test('默认请求启用用户并以服务端 summary 渲染五张统计卡', async () => {
  const requests: URL[] = [];
  window.history.pushState({}, '', '/users');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/users')) {
      requests.push(url);
      return { body: userList(url.searchParams.get('status') === 'ENABLED' ? [admin] : [admin, inactiveEngineer], url.searchParams) };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  expect(await screen.findByRole('heading', { name: '用户管理' })).toBeInTheDocument();
  await waitFor(() => expect(requests[0]?.searchParams.get('status')).toBe('ENABLED'));
  expect(requests[0]?.searchParams.get('page')).toBe('1');
  expect(requests[0]?.searchParams.get('page_size')).toBe('20');
  expect(screen.getByText('用户总数').parentElement).toHaveTextContent('2');
  expect(screen.getByText('已启用用户').parentElement).toHaveTextContent('1');
  const summaryRegion = screen.getByRole('region', { name: '用户统计' });
  expect(within(summaryRegion).getByText('必须修改密码').parentElement).toHaveTextContent('1');
  expect(summaryRegion.querySelectorAll('.metric-tile')).toHaveLength(5);
  const tableRegion = screen.getByRole('region', { name: '用户列表' });
  expect(within(tableRegion).getByText('admin')).toBeInTheDocument();
  expect(tableRegion.querySelectorAll('.status-tag-compact')).toHaveLength(2);
  expect(screen.queryByText('inactive-engineer')).not.toBeInTheDocument();
  expect(screen.getAllByText('暂无历史基线')).toHaveLength(5);

  fireEvent.click(screen.getByRole('switch', { name: '显示停用账号' }));
  expect(await screen.findByText('inactive-engineer')).toBeInTheDocument();
  expect(window.location.search).toBe('?status=ALL');
  await waitFor(() => expect(requests.at(-1)?.searchParams.has('status')).toBe(false));
});

test('停用用户有业务历史时显示查看条件并下钻审计记录', async () => {
  const user = userEvent.setup();
  const blocked = {
    ...inactiveEngineer,
    available_actions: ['UPDATE', 'RESET_PASSWORD', 'ENABLE'] as Schema<'User'>['available_actions'],
    deletion: { blockers: [{ type: 'USER_BUSINESS_HISTORY' as const, count: 6 }] },
  };
  window.history.pushState({}, '', '/users?status=ALL');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/users')) return { body: userList([blocked], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await user.click(await screen.findByRole('button', { name: '更多操作：inactive-engineer' }));
  await user.click(screen.getByRole('menuitem', { name: /查看删除条件/ }));
  expect(screen.getByText('业务历史：6')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看历史' })).toHaveAttribute('href', `/audit?actor_id=${blocked.id}`);
});

test('清理非法 URL，并由筛选和分页参数直接驱动服务端请求', async () => {
  const requests: URL[] = [];
  window.history.pushState({}, '', '/users?q=%20admin%20&account_type=ADMIN&status=DISABLED&page=2&page_size=50&inactive=1&unknown=x');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/users')) {
      requests.push(url);
      return { body: { ...userList([inactiveEngineer], url.searchParams), total: 60 } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  expect(await screen.findByText('inactive-engineer')).toBeInTheDocument();
  await waitFor(() => expect(window.location.search).toBe('?q=admin&account_type=ADMIN&status=DISABLED&page=2&page_size=50'));
  expect(requests[0]?.searchParams.get('q')).toBe('admin');
  expect(requests[0]?.searchParams.get('account_type')).toBe('ADMIN');
  expect(requests[0]?.searchParams.get('status')).toBe('DISABLED');
  expect(requests[0]?.searchParams.get('page')).toBe('2');
  expect(requests[0]?.searchParams.get('page_size')).toBe('50');

  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  await waitFor(() => expect(window.location.search).toBe(''));
  await waitFor(() => expect(requests.at(-1)?.searchParams.get('status')).toBe('ENABLED'));
});

test('批量停用展示服务端逐项失败，不把部分成功伪装成全部成功', async () => {
  window.history.pushState({}, '', '/users?status=ALL');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/users/bulk-status')) return {
      body: {
        succeeded: [{ ...activeEngineer, is_active: false, available_actions: ['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DELETE'], revision: 3 }],
        failures: [{ user_id: admin.id, code: 'LAST_ADMIN_REQUIRED', message: '系统必须保留至少一个有效管理员' }],
      } satisfies Schema<'UserBulkStatusResult'>,
    };
    if (url.pathname.endsWith('/users')) return { body: userList([admin, activeEngineer], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByText('active-engineer');
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.click(checkboxes[1]!);
  fireEvent.click(checkboxes[2]!);
  fireEvent.click(screen.getByRole('button', { name: '批量停用' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '批量停用' }));

  expect(await screen.findByText(/批量操作部分完成：成功 1，失败 1/)).toBeInTheDocument();
  expect(screen.getByText(/系统必须保留至少一个有效管理员/)).toBeInTheDocument();
  expect(screen.getByText(/LAST_ADMIN_REQUIRED/)).toBeInTheDocument();
});

test('创建用户只提交临时密码字段，并在关闭后销毁敏感表单', async () => {
  let submittedBody: Promise<Schema<'UserCreate'>> | undefined;
  window.history.pushState({}, '', '/users');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/users') && request.method === 'POST') {
      submittedBody = request.clone().json() as Promise<Schema<'UserCreate'>>;
      return { body: { ...inactiveEngineer, username: 'new-user', display_name: '新用户', is_active: true, must_change_password: true } };
    }
    if (url.pathname.endsWith('/users')) return { body: userList([admin], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByRole('heading', { name: '用户管理' });
  fireEvent.click(screen.getByRole('button', { name: '新增用户' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('用户名'), { target: { value: 'new-user' } });
  fireEvent.change(within(dialog).getByLabelText('显示名称'), { target: { value: '新用户' } });
  fireEvent.change(within(dialog).getByLabelText('临时密码'), { target: { value: 'temporary-1234' } });
  await userEvent.click(within(dialog).getByRole('combobox', { name: '账号类型' }));
  const engineerOption = (await screen.findAllByText('工程师')).find((element) => element.closest('.ant-select-item-option'));
  expect(engineerOption).toBeDefined();
  await userEvent.click(engineerOption!);
  fireEvent.click(within(dialog).getByRole('button', { name: '创建用户' }));

  await waitFor(() => expect(submittedBody).toBeDefined());
  expect(await submittedBody).toEqual({ username: 'new-user', display_name: '新用户', temporary_password: 'temporary-1234', account_type: 'ENGINEER' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: '新增用户' }));
  expect(within(await screen.findByRole('dialog')).getByLabelText('临时密码')).toHaveValue('');
});

test('停用用户经影响确认后删除并刷新当前列表', async () => {
  let deleted = false;
  let deleteRequest: Request | undefined;
  window.history.pushState({}, '', '/users?status=ALL');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname === `/api/v1/users/${inactiveEngineer.id}` && request.method === 'DELETE') {
      deleteRequest = request;
      deleted = true;
      return { body: undefined, status: 204 };
    }
    if (url.pathname.endsWith('/users')) return { body: userList(deleted ? [admin] : [admin, inactiveEngineer], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByText('inactive-engineer');
  fireEvent.click(screen.getByRole('button', { name: '更多操作：inactive-engineer' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /删除用户/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/会话会被清理/)).toBeInTheDocument();
  expect(within(dialog).getByText(/历史审计记录保留但操作者会置空/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '删除用户' }));

  await waitFor(() => expect(deleteRequest?.method).toBe('DELETE'));
  await waitFor(() => expect(screen.queryByText('inactive-engineer')).not.toBeInTheDocument());
});

test('用户删除被业务引用阻断时保留当前行并展示错误', async () => {
  window.history.pushState({}, '', '/users?status=ALL');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname === `/api/v1/users/${inactiveEngineer.id}` && request.method === 'DELETE') {
      return {
        body: { error: { code: 'USER_IN_USE', message: '用户仍有业务历史引用，不能删除', details: {}, request_id: 'delete-user-test' } },
        status: 409,
      };
    }
    if (url.pathname.endsWith('/users')) return { body: userList([admin, inactiveEngineer], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByText('inactive-engineer');
  fireEvent.click(screen.getByRole('button', { name: '更多操作：inactive-engineer' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /删除用户/ }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除用户' }));

  expect(await screen.findByText('用户仍有业务历史引用，不能删除')).toBeInTheDocument();
  expect(screen.getByText('inactive-engineer')).toBeInTheDocument();
});

test('重置临时密码只在八位边界提交，七位留在表单校验', async () => {
  let submittedBody: Promise<Schema<'ResetPasswordRequest'>> | undefined;
  window.history.pushState({}, '', '/users?status=ALL');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname === `/api/v1/users/${inactiveEngineer.id}/reset-password` && request.method === 'POST') {
      submittedBody = request.clone().json() as Promise<Schema<'ResetPasswordRequest'>>;
      return { body: undefined, status: 204 };
    }
    if (url.pathname.endsWith('/users')) return { body: userList([admin, inactiveEngineer], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  await screen.findByText('inactive-engineer');
  fireEvent.click(screen.getByRole('button', { name: '更多操作：inactive-engineer' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /重置临时密码/ }));
  const dialog = await screen.findByRole('dialog');
  const passwordInput = within(dialog).getByLabelText('临时密码');
  await userEvent.type(passwordInput, '1234567');
  await userEvent.click(within(dialog).getByRole('button', { name: '重置临时密码' }));
  expect(submittedBody).toBeUndefined();

  await userEvent.type(passwordInput, '8');
  await userEvent.click(within(dialog).getByRole('button', { name: '重置临时密码' }));
  await waitFor(() => expect(submittedBody).toBeDefined());
  expect(await submittedBody).toEqual({ temporary_password: '12345678' });
});

test('按文本解析中文 CSV，触发下载并释放对象 URL', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:users');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  window.history.pushState({}, '', '/users');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return Response.json(admin);
    if (url.pathname.endsWith('/auth/csrf')) return Response.json({ csrf_token: 'x'.repeat(32) });
    if (url.pathname.endsWith('/users/export')) {
      return new Response('\ufeff用户名,显示名称\r\nadmin,系统管理员\r\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="users-20260729.csv"',
        },
      });
    }
    if (url.pathname.endsWith('/users')) return Response.json(userList([admin], url.searchParams));
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  expect(await screen.findByText('admin')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '导出列表' }));

  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(click.mock.instances[0]).toMatchObject({ download: 'users-20260729.csv', href: 'blob:users' });
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:users');
});

test('导出 JSON 错误沿用现有错误展示且不创建下载', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:users');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  window.history.pushState({}, '', '/users');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return Response.json(admin);
    if (url.pathname.endsWith('/auth/csrf')) return Response.json({ csrf_token: 'x'.repeat(32) });
    if (url.pathname.endsWith('/users/export')) {
      return Response.json(
        { error: { code: 'EXPORT_FORBIDDEN', message: '无权导出用户', details: {}, request_id: 'export-test' } },
        { status: 403 },
      );
    }
    if (url.pathname.endsWith('/users')) return Response.json(userList([admin], url.searchParams));
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  expect(await screen.findByText('admin')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '导出列表' }));

  expect(await screen.findByText('无权导出用户')).toBeInTheDocument();
  expect(screen.getByText(/EXPORT_FORBIDDEN/)).toBeInTheDocument();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});
