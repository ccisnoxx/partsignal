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

type ProductDetail = components['schemas']['ProductDetail'];

const productId = '00000000-0000-4000-8000-000000000001';
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

const detail = {
  product: {
    id: productId,
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_APPROVED',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['UPDATE', 'DELETE'],
    deletion: { blockers: [] },
    revision: 4,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  },
  approved_fact: {
    id: '00000000-0000-4000-8000-000000000011',
    version: 3,
    status: 'APPROVED',
    classification: 'PUBLIC',
    approved_at: '2026-08-08T12:00:00Z',
  },
  pending_fact: {
    id: '00000000-0000-4000-8000-000000000012',
    version: 4,
    status: 'CHANGES_REQUESTED',
    classification: 'INTERNAL',
    created_at: '2026-08-09T01:00:00Z',
  },
  content: {
    task_count: 2,
    latest_task: {
      task_id: '00000000-0000-4000-8000-000000000021',
      workflow_stage: 'REVIEW_PENDING',
      created_at: '2026-08-09T02:00:00Z',
    },
  },
  publishing: {
    published_article_count: 1,
    latest: {
      work_id: '00000000-0000-4000-8000-000000000031',
      article_id: '00000000-0000-4000-8000-000000000031',
      status: 'COMPLETED',
      actual_title: 'PS-001 选型指南',
      updated_at: '2026-08-09T03:00:00Z',
    },
  },
  geo: {
    observation_count: 3,
    article_result_count: 2,
    discovery_rate: 0.5,
    mention_rate: null,
    accuracy_rate: 1,
  },
  activity: [
    {
      id: '00000000-0000-4000-8000-000000000041',
      kind: 'GEO_OBSERVATION',
      label: '创建 GEO 观测',
      timestamp: '2026-08-09T04:00:00Z',
      actor: {
        id: admin.id,
        username: admin.username,
        display_name: admin.display_name,
      },
      target: {
        kind: 'GEO_OBSERVATION',
        id: '00000000-0000-4000-8000-000000000042',
        label: 'GEO 观测',
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000043',
      kind: 'PRODUCT',
      label: '创建产品',
      timestamp: '2026-08-08T00:00:00Z',
      actor: null,
      target: { kind: 'PRODUCT', id: productId, label: '产品' },
    },
  ],
} satisfies ProductDetail;

function renderDetail(entry = `/products/${productId}`) {
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

function detailResponse(value: ProductDetail) {
  return { data: value, response: Response.json(value) } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('ProductDetailPage', () => {
  it('单次 detail GET 按批准顺序展示全部 compact summary、Activity 和服务端动作', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(detail));
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'PS-001', level: 1 })).toBeInTheDocument();
    const detailArticle = screen.getByRole('article', { name: 'PS-001' });
    expect(within(detailArticle).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      '摘要', '基本信息', '事实', '内容任务', '发布成果', 'GEO 摘要', '最近 Activity',
    ]);
    expect(screen.getByText('CREATE_CONTENT_TASK')).toBeInTheDocument();
    expect(screen.getByText('v3')).toHaveAttribute('href', `/products/${productId}/facts/versions/${detail.approved_fact.id}`);
    expect(screen.getByText(/最近任务：内容待审核/)).toBeInTheDocument();
    expect(screen.getByText(/PS-001 选型指南 · 已完成/)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getAllByText('暂无').length).toBeGreaterThan(0);
    expect(screen.getByText('创建 GEO 观测')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建内容' })).toHaveAttribute('href', `/content/tasks/new?productId=${productId}`);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/products/{product_id}/detail', {
      params: { path: { product_id: productId } },
    });

    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' });
    expect(breadcrumb).toHaveTextContent('产品');
    expect(breadcrumb).toHaveTextContent('产品详情');
    expect(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: '产品' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it.each([
    [404, '未找到产品'],
    [403, '无法访问产品详情'],
  ])('区分 HTTP %s 预期错误', async (status, heading) => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: status === 404 ? 'PRODUCT_NOT_FOUND' : 'PERMISSION_DENIED', message: heading, details: {}, request_id: `req-${status}` } },
      response: Response.json({}, { status }),
    } as never);
    renderDetail();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('普通错误保留 retry，空摘要不伪造数据', async () => {
    const empty = {
      ...detail,
      approved_fact: null,
      pending_fact: null,
      content: { task_count: 0, latest_task: null },
      publishing: { published_article_count: 0, latest: null },
      geo: { observation_count: 0, article_result_count: 0, discovery_rate: null, mention_rate: null, accuracy_rate: null },
      activity: [],
    } satisfies ProductDetail;
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({
        error: { error: { code: 'DETAIL_UNAVAILABLE', message: '详情服务暂不可用', details: {}, request_id: 'req-error' } },
        response: Response.json({}, { status: 503 }),
      } as never)
      .mockResolvedValueOnce(detailResponse(empty));
    renderDetail();
    expect(await screen.findByRole('heading', { name: '产品详情加载失败' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无 Activity')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('UPDATE Dialog 只提交四字段与 expected_revision，并刷新 canonical detail', async () => {
    let current = detail;
    vi.spyOn(api, 'GET').mockImplementation(async () => detailResponse(current));
    const patch = vi.spyOn(api, 'PATCH').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: components['schemas']['ProductUpdate'] }).body;
      current = { ...current, product: { ...current.product, category: body.category, revision: 5 } };
      return { data: current.product, response: Response.json(current.product) } as never;
    });
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：PS-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑产品' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑产品基本信息' });
    const category = within(dialog).getByRole('textbox', { name: '类别' });
    await userEvent.clear(category);
    await userEvent.type(category, 'Processor');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/products/{product_id}', {
      body: {
        expected_revision: 4,
        part_number: 'PS-001',
        brand: 'PartSignal',
        category: 'Processor',
        status: 'ACTIVE',
      },
      params: {
        path: { product_id: productId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    }));
    expect(await screen.findByText('Processor')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '编辑产品基本信息' })).not.toBeInTheDocument();
  });

  it('REVISION_CONFLICT 明确展示并重置为最新 canonical detail', async () => {
    let getCount = 0;
    vi.spyOn(api, 'GET').mockImplementation(async () => {
      getCount += 1;
      return detailResponse(getCount === 1 ? detail : {
        ...detail,
        product: { ...detail.product, brand: 'Canonical Brand', revision: 5 },
      });
    });
    vi.spyOn(api, 'PATCH').mockResolvedValue({
      error: { error: { code: 'REVISION_CONFLICT', message: '产品已被其他请求修改', details: {}, request_id: 'req-conflict' } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：PS-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑产品' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑产品基本信息' });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('产品已被其他请求修改');
    expect(within(dialog).getByRole('textbox', { name: '品牌' })).toHaveValue('Canonical Brand');
    expect(within(dialog).getByText('请求 ID：req-conflict')).toBeInTheDocument();
  });

  it('DELETE blocker 使用最新 projection，成功删除后导航且不重取旧详情', async () => {
    let current: ProductDetail = {
      ...detail,
      product: {
        ...detail.product,
        available_actions: ['UPDATE'],
        deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
      },
    };
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/products') {
        return { data: { items: [], page: 1, page_size: 20, total: 0 }, response: Response.json({}) } as never;
      }
      return detailResponse(current);
    });
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const rendered = renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：PS-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '查看删除条件' }));
    const conditions = await screen.findByRole('dialog', { name: '产品“PS-001”暂时不能删除' });
    expect(within(conditions).getByText('2')).toBeInTheDocument();

    current = { ...detail, product: { ...detail.product, available_actions: ['UPDATE', 'DELETE'], deletion: { blockers: [] } } };
    await userEvent.click(within(conditions).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '产品“PS-001”暂时不能删除' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '更多操作：PS-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除产品' }));
    const confirm = await screen.findByRole('dialog', { name: '确认删除产品“PS-001”' });
    await userEvent.click(within(confirm).getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(rendered.router.state.location.pathname).toBe('/products'));
    expect(remove).toHaveBeenCalledWith('/api/v1/products/{product_id}', {
      params: {
        path: { product_id: productId },
        query: { expected_revision: 4 },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    const detailCalls = get.mock.calls as unknown as Array<[string]>;
    expect(detailCalls.filter(([path]) => path === '/api/v1/products/{product_id}/detail')).toHaveLength(2);
  });
});
