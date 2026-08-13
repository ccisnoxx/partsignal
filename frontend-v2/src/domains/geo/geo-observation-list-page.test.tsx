import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { productsKeys } from '@/domains/product/product.api';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { geoKeys } from './geo.api';

type GeoObservationListItem = components['schemas']['GeoObservationListItem'];
type GeoObservationListPage = components['schemas']['GeoObservationListPage'];

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
  csrfToken: 'geo-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const observation = {
  id: '10000000-0000-4000-8000-000000000001',
  observation_kind: 'MANUAL_ARTICLE_SEARCH',
  query_text: '这是一个用于验证长文本布局的标准问题',
  product: {
    id: '20000000-0000-4000-8000-000000000001',
    label: 'PartSignal PS-LONG-PRODUCT-001',
  },
  geo_platform: 'DeepSeek',
  outcomes: {
    discovered: { positive_count: 2, assessed_count: 3, total_count: 3 },
    mentioned: { positive_count: 1, assessed_count: 3, total_count: 3 },
    accuracy: { positive_count: 1, assessed_count: 1, total_count: 3 },
  },
  related_achievement_count: 3,
  evidence_count: 2,
  recorder: {
    id: admin.id,
    username: admin.username,
    display_name: admin.display_name,
  },
  observed_at: '2026-08-12T08:00:00Z',
  available_actions: ['CORRECT', 'DELETE'],
} satisfies GeoObservationListItem;

function page(items: GeoObservationListItem[], total = items.length): GeoObservationListPage {
  return { items, page: 1, page_size: 20, total };
}

function renderGeo(entry = '/geo/observations?page=1&pageSize=20') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe('GeoObservationListPage', () => {
  it('单次 compact GET 绘制八列、canonical links 和服务端动作', async () => {
    const data = page([observation]);
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    renderGeo();

    expect(await screen.findByRole('heading', { name: 'GEO 观测记录' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '新建 Observation' })).toHaveAttribute(
      'href',
      '/geo/observations/new',
    );
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '查询', 'GEO 平台', '发现 / 提及 / 准确', '关联成果', '证据', '记录人', '观测时间', '操作',
    ]);
    expect(screen.getByRole('link', { name: observation.query_text })).toHaveAttribute(
      'href',
      `/geo/observations/${observation.id}`,
    );
    expect(screen.getByText(observation.product.label)).toBeInTheDocument();
    expect(screen.getByText('发现 2/3')).toBeInTheDocument();
    expect(screen.getByText('准确 1/1（2 未评估）')).toBeInTheDocument();
    expect(screen.queryByText('查看详情')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `更多操作：${observation.query_text}` }));
    expect(await screen.findByRole('menuitem', { name: '更正' })).toHaveAttribute(
      'href',
      `/geo/observations/${observation.id}/correct`,
    );
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
  });

  it('无 available_actions 时不渲染 overflow，并区分 loading/empty/filtered-empty/error', async () => {
    let resolveLoading: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation(() => (
      new Promise((resolve) => { resolveLoading = resolve; }) as never
    ));
    const loading = renderGeo();
    expect(await screen.findByRole('rowgroup', { name: '正在加载表格' }))
      .toHaveAttribute('aria-busy', 'true');
    const noActions = { ...observation, available_actions: [] } satisfies GeoObservationListItem;
    resolveLoading?.({ data: page([noActions]), response: Response.json(page([noActions])) });
    expect(await screen.findByRole('link', { name: observation.query_text })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /更多操作/ })).not.toBeInTheDocument();
    loading.view.unmount();
    get.mockRestore();

    const empty = page([]);
    const emptyGet = vi.spyOn(api, 'GET').mockResolvedValue({ data: empty, response: Response.json(empty) } as never);
    const initialEmpty = renderGeo();
    expect(await screen.findByText('暂无 GEO 观测')).toBeInTheDocument();
    initialEmpty.view.unmount();
    emptyGet.mockRestore();

    const filteredGet = vi.spyOn(api, 'GET').mockResolvedValue({ data: empty, response: Response.json(empty) } as never);
    const filtered = renderGeo('/geo/observations?page=1&pageSize=20&q=missing');
    expect(await screen.findByText('未找到匹配观测')).toBeInTheDocument();
    filtered.view.unmount();
    filteredGet.mockRestore();

    let failed = true;
    vi.spyOn(api, 'GET').mockImplementation(async () => failed ? ({
      error: {
        error: {
          code: 'GEO_CONTEXT_INCOMPLETE',
          message: 'GEO 观测上下文不完整',
          details: {},
          request_id: 'req-geo-list',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never) : ({ data: page([observation]), response: Response.json(page([observation])) } as never));
    const refreshed = renderGeo('/geo/observations?page=1&pageSize=20&q=error');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GEO 观测上下文不完整（请求 ID：req-geo-list）',
    );
    failed = false;
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: observation.query_text })).toBeInTheDocument();
    failed = true;
    await refreshed.queryClient.invalidateQueries({
      queryKey: ['geo', 'observations', 'list'],
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '刷新失败，已保留当前观测列表',
    );
    expect(screen.getByRole('link', { name: observation.query_text })).toBeInTheDocument();
  });

  it('删除 Dialog 单次发送 CSRF、成功刷新并把焦点返回 overflow', async () => {
    let rows: GeoObservationListItem[] = [observation];
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => {
      const data = page(rows);
      return { data, response: Response.json(data) } as never;
    });
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(async () => {
      rows = [];
      return { response: new Response(null, { status: 204 }) } as never;
    });
    const { queryClient } = renderGeo();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const trigger = await screen.findByRole('button', { name: `更多操作：${observation.query_text}` });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    let dialog = await screen.findByRole('dialog', { name: '删除 GEO 观测' });
    expect(within(dialog).getByText(/完整更正链/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(trigger).toHaveFocus());

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    dialog = await screen.findByRole('dialog', { name: '删除 GEO 观测' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenCalledWith('/api/v1/geo-observations/{observation_id}', {
      params: {
        path: { observation_id: observation.id },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: geoKeys.lists() });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: geoKeys.details(),
      refetchType: 'none',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: geoKeys.correctionContexts(),
      refetchType: 'none',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: geoKeys.insights() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: geoKeys.topicLists() });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: productsKeys.detail(observation.product.id),
    });
  });

  it('排序与分页只更新 canonical URL 并由服务端重新请求', async () => {
    const data = page([observation], 21);
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    const { router } = renderGeo();

    await userEvent.click(await screen.findByRole('button', { name: '观测时间' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({
      sort: 'OBSERVED_ASC',
      page: 1,
      pageSize: 20,
    }));
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({
      sort: 'OBSERVED_ASC',
      page: 2,
      pageSize: 20,
    }));
    expect(get.mock.calls.at(-1)?.[1]).toEqual({
      params: {
        query: expect.objectContaining({ sort: 'OBSERVED_ASC', page: 2, page_size: 20 }),
      },
    });
  });
});
