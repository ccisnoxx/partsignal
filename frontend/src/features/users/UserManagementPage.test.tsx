/** 验证用户管理只消费服务端统计、筛选分页和命令结果。 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const admin = {
  id: '10000000-0000-4000-8000-000000000001', username: 'admin', display_name: '管理员',
  account_type: 'ADMIN', is_active: true, must_change_password: false, revision: 1, created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'User'>;

const inactiveEngineer = {
  id: '10000000-0000-4000-8000-000000000002', username: 'inactive-engineer', display_name: '停用工程师',
  account_type: 'ENGINEER', is_active: false, must_change_password: true, revision: 2, created_at: '2026-07-11T00:00:00Z',
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

  render(<App />);
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

  render(<App />);
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
        succeeded: [{ ...inactiveEngineer, is_active: false, revision: 3 }],
        failures: [{ user_id: admin.id, code: 'LAST_ADMIN_REQUIRED', message: '系统必须保留至少一个有效管理员' }],
      } satisfies Schema<'UserBulkStatusResult'>,
    };
    if (url.pathname.endsWith('/users')) return { body: userList([admin, inactiveEngineer], url.searchParams) };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  await screen.findByText('inactive-engineer');
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

  render(<App />);
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
