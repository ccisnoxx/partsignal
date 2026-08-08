import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { within } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { routeTree } from '@/routeTree.gen';

const engineer: AuthUser = {
  id: '00000000-0000-4000-8000-000000000002',
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_LOGIN_SECURITY',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
};

const admin: AuthUser = {
  ...engineer,
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  primary_task: 'MANAGE_USER',
};

function authValue(user: AuthUser | null): AuthContextValue {
  return {
    user,
    isLoading: false,
    isSigningOut: false,
    error: null,
    isAdmin: user?.account_type === 'ADMIN',
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderRoute(path: string, auth = authValue(null)) {
  const queryClient = new QueryClient();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, auth },
  });
  render(<RouterProvider router={router} context={{ queryClient, auth }} />);
  return router;
}

describe('AppShell', () => {
  it('由 match metadata 激活父级导航并生成详情面包屑', async () => {
    renderRoute('/products/router-foundation');

    expect(await screen.findByRole('heading', { name: '产品详情' })).toBeInTheDocument();
    const mainNavigation = screen.getByRole('navigation', { name: '主导航' });
    expect(within(mainNavigation).getByRole('link', { name: '产品' })).toHaveAttribute('aria-current', 'page');
    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' });
    expect(breadcrumb).toHaveTextContent('产品');
    expect(breadcrumb).toHaveTextContent('产品详情');
  });

  it('移动导航支持打开、关闭和触发器焦点恢复', async () => {
    renderRoute('/');
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: '打开主导航' });

    await user.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('隐藏非管理员入口并在直接 URL 保留可聚焦 403', async () => {
    const router = renderRoute('/system/users', authValue(engineer));

    const forbidden = await screen.findByRole('heading', { name: '无权访问系统管理' });
    expect(screen.queryByRole('link', { name: '用户管理' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/system/users');
    await waitFor(() => expect(forbidden.closest('section')).toHaveFocus());
  });

  it('仅用真实身份显示管理员入口和账户退出动作', async () => {
    const auth = authValue(admin);
    renderRoute('/', auth);
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: '用户管理' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /系统管理员/ }));
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }));

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('pathname 导航聚焦主内容，search-only 更新不抢焦点', async () => {
    const router = renderRoute('/');
    const user = userEvent.setup();
    const productLink = await screen.findByRole('link', { name: '产品' });
    await user.click(productLink);
    await screen.findByRole('heading', { name: '产品' });

    const main = screen.getByRole('main');
    await waitFor(() => expect(main).toHaveFocus());
    const detailLink = screen.getByRole('link', { name: '查看产品详情路由' });
    detailLink.focus();

    await router.navigate({ to: '/products', search: { q: 'router', page: 2 } });
    expect(detailLink).toHaveFocus();
  });

  it('把无效产品页码归一为 1 并 trim 搜索词', async () => {
    renderRoute('/products?q=%20router%20&page=invalid');

    expect(await screen.findByText('当前页码：1；搜索词：router')).toBeInTheDocument();
  });
});
