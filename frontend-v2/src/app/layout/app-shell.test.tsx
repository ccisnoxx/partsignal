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
type ProductList = components['schemas']['ProductList'];
type WorkbenchAggregate = components['schemas']['WorkbenchAggregate'];

const emptyWorkbenchAggregate = {
  generated_at: '2026-08-23T08:00:00Z',
  actionable_counts: {
    fact_reviews: { value: 0, href: '/products?workbench=fact-review' },
    content_reviews: { value: 0, href: '/content/tasks?workbench=content-review' },
    publication_verifications: { value: 0, href: '/publishing/work?workbench=verification' },
    publication_actions: { value: 0, links: [{ label: '处理待开始发布', href: '/publishing/work?workbench=ready' }] },
    content_issues: { value: 0, href: '/publishing/issues?workbench=open' },
    geo_accuracy_issues: { value: 0, links: [{ label: '检查准确性异常', href: '/geo/observations?workbench=accuracy' }] },
  },
  workflow_health: {
    product_facts: { status: 'CLEAR', summary: '产品事实流程正常' },
    content: { status: 'CLEAR', summary: '内容流程正常' },
    publication: { status: 'CLEAR', summary: '发布流程正常' },
    geo: { status: 'CLEAR', summary: 'GEO 流程正常' },
  },
  geo_summary: {
    window: { date_from: '2026-07-25', date_to: '2026-08-23' },
    discovery_rate: { numerator: 0, denominator: 0, value: null },
    mention_rate: { numerator: 0, denominator: 0, value: null },
    accuracy_rate: { numerator: 0, denominator: 0, value: null },
  },
  recent_attention_items: [],
} satisfies WorkbenchAggregate;

const emptyProductList = {
  items: [], page: 1, page_size: 20, total: 0,
} satisfies ProductList;

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

function renderRoute(path: string, auth = authValue(engineer)) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['auth', 'session'], auth.user
    ? { user: auth.user, csrfToken: auth.csrfToken }
    : null);
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
    expect(await screen.findByRole('menuitem', { name: '修改密码' })).toHaveAttribute('href', '/account/security');
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }));

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('pathname 导航聚焦主内容，search-only 更新不抢焦点', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/workbench') {
        return { data: emptyWorkbenchAggregate, response: Response.json(emptyWorkbenchAggregate) } as never;
      }
      if (path === '/api/v1/products') {
        return { data: emptyProductList, response: Response.json(emptyProductList) } as never;
      }
      throw new Error(`App Shell 测试收到未声明的 GET ${path}`);
    });
    const router = renderRoute('/');
    const user = userEvent.setup();
    const productLink = await screen.findByRole('link', { name: '产品' });
    await user.click(productLink);
    await screen.findByRole('heading', { name: '产品事实' });
    const tableRegion = await screen.findByRole('region', { name: '产品事实列表' });

    const main = screen.getByRole('main');
    await waitFor(() => expect(main).toHaveFocus());
    tableRegion.focus();

    await router.navigate({ to: '/products', search: { q: 'router', page: 2 } });
    expect(tableRegion).toHaveFocus();
  });

  it('打印路由保留鉴权上下文但不渲染应用导航与账户外壳', async () => {
    vi.spyOn(api, 'GET').mockImplementation(() => new Promise(() => undefined));
    renderRoute('/geo/insights/print?from=2026-07-15&to=2026-08-13', authValue(admin));

    expect(await screen.findByText('正在生成打印报告…')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('geo-insights-print-shell');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '面包屑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /系统管理员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '跳到主内容' })).not.toBeInTheDocument();
  });
});
