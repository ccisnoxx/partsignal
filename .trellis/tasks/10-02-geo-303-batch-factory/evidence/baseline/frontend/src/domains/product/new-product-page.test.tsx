import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { NewProductPage } from './new-product-page';

type Product = components['schemas']['Product'];
const csrfToken = 'component-test-csrf';

const createdProduct = {
  id: '00000000-0000-4000-8000-000000000001',
  part_number: 'PS-001',
  brand: 'PartSignal',
  category: 'MCU',
  status: 'ACTIVE',
  workflow_stage: 'FACTS_EMPTY',
  primary_task: 'ENTER_FACTS',
  available_actions: ['UPDATE'],
  deletion: null,
  revision: 0,
  created_at: '2026-08-09T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
} satisfies Product;

async function renderNewProduct(entry = '/products/new') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const rootRoute = createRootRoute({ component: Outlet });
  const newProductRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/products/new',
    component: TestNewProductRoute,
  });
  const productsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/products',
    component: () => <h1>产品事实</h1>,
  });
  const productRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/products/$productId',
    component: () => <h1>产品详情</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([newProductRoute, productsRoute, productRoute]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { invalidateQueries, router };
}

function TestNewProductRoute() {
  const router = useRouter();
  return (
    <NewProductPage
      csrfToken={csrfToken}
      onCancel={() => router.history.push('/products')}
      onCreated={(productId) => router.history.push(`/products/${productId}`)}
    />
  );
}

async function fillValidForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: '产品型号' }), '  PS-001 ');
  await user.type(screen.getByRole('textbox', { name: '品牌' }), ' PartSignal ');
  await user.type(screen.getByRole('textbox', { name: '类别' }), ' MCU ');
  return user;
}

afterEach(() => vi.restoreAllMocks());

describe('NewProductPage', () => {
  it('提交 trim 后的 generated DTO 与 CSRF，失效列表并跳转 canonical route', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: createdProduct,
      response: Response.json(createdProduct, { status: 201 }),
    } as never);
    const { invalidateQueries } = await renderNewProduct();
    const user = await fillValidForm();

    await user.click(screen.getByRole('button', { name: '创建产品' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/products', {
      body: { part_number: 'PS-001', brand: 'PartSignal', category: 'MCU' },
      params: { header: { 'X-CSRF-Token': csrfToken } },
    });
    expect(await screen.findByRole('heading', { name: '产品详情' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '要离开当前页面吗？' })).not.toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['products', 'list'] });
  });

  it('客户端拒绝必填和纯空白，并保持 label/description/error 关联', async () => {
    const post = vi.spyOn(api, 'POST');
    await renderNewProduct();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '产品型号' }), '   ');
    await user.click(screen.getByRole('button', { name: '创建产品' }));

    expect(await screen.findByText('产品型号不能为空', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '产品型号' })).toHaveAttribute(
      'aria-describedby',
      'new-product-part-number-description new-product-part-number-error',
    );
    expect(screen.getByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('品牌不能为空');
    expect(post).not.toHaveBeenCalled();
  });

  it('duplicate 定位两个字段并展示 request_id，修正后可重试', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce({
      error: {
        error: {
          code: 'PRODUCT_ALREADY_EXISTS',
          message: '品牌与产品型号组合已存在',
          details: {
            errors: [
              { loc: ['body', 'part_number'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
              { loc: ['body', 'brand'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
            ],
          },
          request_id: 'req-duplicate',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never).mockResolvedValueOnce({
      data: createdProduct,
      response: Response.json(createdProduct, { status: 201 }),
    } as never);
    await renderNewProduct();
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '创建产品' }));

    const summary = await screen.findByRole('alert', { name: '请修正以下问题' });
    expect(within(summary).getAllByText('品牌与产品型号组合已存在')).toHaveLength(2);
    expect(within(summary).getByText('请求 ID：req-duplicate')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '品牌' })).toHaveAttribute('aria-invalid', 'true');

    await user.clear(screen.getByRole('textbox', { name: '产品型号' }));
    await user.type(screen.getByRole('textbox', { name: '产品型号' }), 'PS-002');
    await user.click(screen.getByRole('button', { name: '创建产品' }));
    expect(await screen.findByRole('heading', { name: '产品详情' })).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('pending 禁止重复提交和丢失状态的操作', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }) as never);
    await renderNewProduct();
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '创建产品' }));

    expect(await screen.findByRole('button', { name: '创建中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '产品型号' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '创建中…' }));
    expect(post).toHaveBeenCalledOnce();

    resolvePost?.({ data: createdProduct, response: Response.json(createdProduct, { status: 201 }) });
    expect(await screen.findByRole('heading', { name: '产品详情' })).toBeInTheDocument();
  });

  it('dirty Cancel 可留在页面或确认返回 Products', async () => {
    await renderNewProduct();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: '产品型号' }), 'PS-001');
    await user.click(screen.getByRole('button', { name: '取消' }));

    let dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('heading', { name: '新建产品' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await user.click(within(dialog).getByRole('button', { name: '放弃修改并离开' }));
    expect(await screen.findByRole('heading', { name: '产品事实' })).toBeInTheDocument();
  });
});
