import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { within } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ProductDetail = components['schemas']['ProductDetail'];

const productId = '00000000-0000-4000-8000-000000000001';
const productDetail = {
  product: {
    id: productId,
    part_number: 'ROUTER-FOUNDATION',
    brand: 'PartSignal',
    category: '测试产品',
    status: 'ACTIVE',
    workflow_stage: 'FACTS_EMPTY',
    primary_task: 'ENTER_FACTS',
    available_actions: ['UPDATE', 'DELETE'],
    deletion: { blockers: [] },
    revision: 1,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  },
  approved_fact: null,
  pending_fact: null,
  content: { task_count: 0, latest_task: null },
  publishing: { published_article_count: 0, latest: null },
  geo: {
    observation_count: 0,
    article_result_count: 0,
    discovery_rate: null,
    mention_rate: null,
    accuracy_rate: null,
  },
  activity: [],
} satisfies ProductDetail;

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
    csrfToken: user ? 'test-csrf-token' : null,
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
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => vi.restoreAllMocks());

describe('AppShell', () => {
  it('由 match metadata 激活父级导航并生成详情面包屑', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: productDetail,
      response: Response.json(productDetail),
    } as never);
    renderRoute(`/products/${productId}`);

    expect(await screen.findByRole('heading', { name: productDetail.product.part_number })).toBeInTheDocument();
    const mainNavigation = screen.getByRole('navigation', { name: '主导航' });
    expect(within(mainNavigation).getByRole('link', { name: '产品' })).toHaveAttribute('aria-current', 'page');
    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' });
    expect(breadcrumb).toHaveTextContent('产品');
    expect(breadcrumb).toHaveTextContent('产品详情');
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/products/{product_id}/detail', {
      params: { path: { product_id: productId } },
    });
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
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      const data = { items: [], page: 1, page_size: 20, total: 0 };
      return { data, response: Response.json(data) } as never;
    });
    const router = renderRoute('/');
    const user = userEvent.setup();
    const productLink = await screen.findByRole('link', { name: '产品' });
    await user.click(productLink);
    await screen.findByRole('heading', { name: '产品事实' });

    const main = screen.getByRole('main');
    await waitFor(() => expect(main).toHaveFocus());
    const tableRegion = screen.getByRole('region', { name: '产品事实列表' });
    tableRegion.focus();

    await router.navigate({ to: '/products', search: { q: 'router', page: 2 } });
    expect(tableRegion).toHaveFocus();
  });
});
