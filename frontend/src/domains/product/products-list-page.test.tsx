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

type ProductList = components['schemas']['ProductList'];
type ProductListItem = components['schemas']['ProductListItem'];

const admin: AuthUser = {
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
  created_at: '2026-08-08T00:00:00Z',
};

const auth: AuthContextValue = {
  user: admin,
  csrfToken: 'component-test-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  part_number: 'PS-VERY-LONG-MODEL-001',
  brand: 'PartSignal Very Long Brand Name',
  category: 'High Reliability Microcontroller Category',
  status: 'ACTIVE',
  workflow_stage: 'FACT_APPROVED',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: ['UPDATE', 'DELETE'],
  deletion: { blockers: [] },
  revision: 7,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
  fact_status: 'APPROVED',
  current_fact: { version: 3, status: 'APPROVED' },
} satisfies ProductListItem;

function result(items: ProductListItem[], total = items.length): ProductList {
  return { items, page: 1, page_size: 20, total };
}

function renderProducts(entry = '/products?page=1') {
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

describe('ProductsListPage', () => {
  it('单次 GET 绘制严格六列、长文本和服务端 primary/overflow', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([product]),
      response: Response.json(result([product])),
    } as never);

    renderProducts();

    expect(await screen.findByRole('heading', { name: '产品事实' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '新建产品' })).toHaveAttribute('href', '/products/new');
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '产品', '类别', '事实状态', '当前事实', '最近更新', '操作',
    ]);
    expect(screen.getByRole('link', { name: product.part_number })).toHaveAttribute('href', `/products/${product.id}`);
    expect(screen.getByText(product.brand)).toBeInTheDocument();
    expect(screen.getByText(product.category)).toBeInTheDocument();
    expect(screen.getByText('已批准')).toBeInTheDocument();
    expect(screen.getByText('Approved v3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建内容' })).toHaveAttribute('href', `/content/tasks/new?productId=${product.id}`);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/products', {
      params: { query: { page: 1, page_size: 20, search: undefined, sort: 'UPDATED_DESC', fact_status: undefined, workflow_stage: undefined } },
    });

    await userEvent.click(screen.getByRole('button', { name: `更多操作：${product.part_number}` }));
    expect(await screen.findByRole('menuitem', { name: '编辑产品' })).toHaveAttribute('href', `/products/${product.id}`);
    expect(screen.getByRole('menuitem', { name: '删除产品' })).toBeInTheDocument();
  });

  it('区分 loading、initial empty、filtered empty 与 error retry', async () => {
    let resolveLoading: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation(() => new Promise((resolve) => { resolveLoading = resolve; }) as never);
    const first = renderProducts();
    expect(await screen.findByRole('rowgroup', { name: '正在加载表格' })).toHaveAttribute('aria-busy', 'true');
    resolveLoading?.({ data: result([]), response: Response.json(result([])) });
    expect(await screen.findByText('暂无产品')).toBeInTheDocument();
    first.queryClient.clear();
    first.view.unmount();

    get.mockResolvedValueOnce({ data: result([]), response: Response.json(result([])) } as never);
    const filtered = renderProducts('/products?q=missing&page=1');
    expect(await screen.findByText('未找到匹配产品')).toBeInTheDocument();
    filtered.view.unmount();

    get.mockResolvedValueOnce({
      error: { error: { code: 'PRODUCTS_UNAVAILABLE', message: '产品服务暂不可用', details: {}, request_id: 'req-products' } },
      response: Response.json({}, { status: 503 }),
    } as never).mockResolvedValueOnce({ data: result([product]), response: Response.json(result([product])) } as never);
    renderProducts('/products?q=error&page=1');
    expect(await screen.findByRole('alert')).toHaveTextContent('产品服务暂不可用');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: product.part_number })).toBeInTheDocument();
  });

  it('删除条件不静默隐藏，允许删除时携带 revision 和 CSRF', async () => {
    const blocked = {
      ...product,
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
    } satisfies ProductListItem;
    let rows: ProductListItem[] = [blocked];
    vi.spyOn(api, 'GET').mockImplementation(async () => ({ data: result(rows), response: Response.json(result(rows)) }) as never);
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async () => {
      rows = [];
      return { response: new Response(null, { status: 204 }) } as never;
    });
    renderProducts();

    await userEvent.click(await screen.findByRole('button', { name: `更多操作：${product.part_number}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '查看删除条件' }));
    const conditions = await screen.findByRole('dialog', { name: `产品“${product.part_number}”暂时不能删除` });
    expect(within(conditions).getByText('内容任务')).toBeInTheDocument();
    expect(within(conditions).getByText('2')).toBeInTheDocument();

    rows = [{
      ...blocked,
      deletion: { blockers: [{ type: 'CONTENT_TASK', count: 3 }] },
    }];
    await userEvent.click(within(conditions).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(within(conditions).getByText('3')).toBeInTheDocument());
    expect(conditions).toBeInTheDocument();

    rows = [product];
    await userEvent.click(within(conditions).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `产品“${product.part_number}”暂时不能删除` })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: `更多操作：${product.part_number}` })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: `更多操作：${product.part_number}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除产品' }));
    const confirm = await screen.findByRole('dialog', { name: `确认删除产品“${product.part_number}”` });
    await userEvent.click(within(confirm).getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('/api/v1/products/{product_id}', {
      params: {
        path: { product_id: product.id },
        query: { expected_revision: product.revision },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    }));
  });

  it('删除 revision conflict 显示服务端错误并刷新 Products projection', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: result([product]),
      response: Response.json(result([product])),
    } as never);
    vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: { error: { code: 'REVISION_CONFLICT', message: '产品已被其他操作更新', details: {}, request_id: 'req-delete-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderProducts();

    await userEvent.click(await screen.findByRole('button', { name: `更多操作：${product.part_number}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除产品' }));
    const confirm = await screen.findByRole('dialog', { name: `确认删除产品“${product.part_number}”` });
    await userEvent.click(within(confirm).getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('产品已被其他操作更新（请求 ID：req-delete-conflict）');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
