/** 验证用户管理默认聚焦有效账号，同时保留停用账号治理入口。 */
import { render, screen } from '@testing-library/react';
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
  account_type: 'ENGINEER', is_active: false, must_change_password: false, revision: 2, created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'User'>;

test('默认隐藏停用账号，并允许管理员显式查看', async () => {
  window.history.pushState({}, '', '/users');
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: admin };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/users')) {
      return { body: { items: [admin, inactiveEngineer], page: 1, page_size: 20, total: 2 } satisfies Schema<'UserList'> };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: '用户管理' })).toBeInTheDocument();
  expect(screen.getByText('admin')).toBeInTheDocument();
  expect(screen.queryByText('inactive-engineer')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('switch', { name: '显示停用账号' }));
  expect(await screen.findByText('inactive-engineer')).toBeInTheDocument();
});
