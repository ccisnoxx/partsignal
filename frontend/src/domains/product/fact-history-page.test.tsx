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

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type ProductFactHistoryList = components['schemas']['ProductFactHistoryList'];

const productId = '00000000-0000-4000-8000-000000000001';
const firstVersionId = '10000000-0000-4000-8000-000000000001';
const secondVersionId = '10000000-0000-4000-8000-000000000002';
const historyPath = `/products/${productId}/facts/versions?page=1&pageSize=20`;

const userAccount = {
  id: '00000000-0000-4000-8000-000000000099',
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-09T00:00:00Z',
} satisfies AuthUser;

const auth = {
  user: userAccount,
  csrfToken: 'fact-history-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
} satisfies AuthContextValue;

const history = {
  product: {
    id: productId,
    part_number: 'PS-HISTORY',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_APPROVED',
  },
  items: [
    {
      id: secondVersionId,
      product_id: productId,
      version: 2,
      status: 'APPROVED',
      classification: 'INTERNAL',
      change_summary: '补充参数来源',
      created_by: userAccount.id,
      created_at: '2026-08-09T02:00:00Z',
    },
    {
      id: firstVersionId,
      product_id: productId,
      version: 1,
      status: 'CHANGES_REQUESTED',
      classification: 'RESTRICTED',
      change_summary: '初次提交',
      created_by: userAccount.id,
      created_at: '2026-08-09T01:00:00Z',
    },
  ],
  page: 1,
  page_size: 20,
  total: 2,
} satisfies ProductFactHistoryList;

afterEach(() => vi.restoreAllMocks());

function renderHistory(entry = historyPath) {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider context={{ queryClient, auth }} router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, ...view };
}

function response<T>(value: T, status = 200) {
  return {
    data: status < 400 ? value : undefined,
    error: status >= 400 ? value : undefined,
    response: Response.json(value, { status }),
  } as never;
}

function errorResponse(status: number, code: string, requestId: string) {
  return response({
    error: {
      code,
      message: '事实历史请求失败',
      details: {},
      request_id: requestId,
    },
  } satisfies ErrorEnvelope, status);
}

describe('FactHistoryPage', () => {
  it('只请求 history endpoint，按服务端顺序展示严格六列且没有业务命令', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(history));
    renderHistory();

    expect(await screen.findByRole('heading', { name: 'PS-HISTORY 事实版本历史' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '版本', '状态', '数据级别', '变更摘要', '提交人', '提交时间',
    ]);
    const table = screen.getByRole('region', { name: '事实版本历史列表' });
    expect(within(table).getAllByRole('link').map((link) => link.textContent)).toEqual(['v2', 'v1']);
    expect(screen.getByRole('link', { name: '查看事实版本 v2（只读）' })).toHaveAttribute(
      'href',
      `/products/${productId}/facts/versions/${secondVersionId}`,
    );
    expect(screen.getByText('已批准')).toBeInTheDocument();
    expect(screen.getByText('待修订')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批准|退回|停用|删除|编辑|保存/ })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/products/{product_id}/fact-history', {
      params: {
        path: { product_id: productId },
        query: { page: 1, page_size: 20 },
      },
    });
  });

  it('展示 empty，并在 URL productId 或 item product_id 不匹配时拒绝历史数据', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValueOnce(response({
      ...history,
      items: [],
      total: 0,
    } satisfies ProductFactHistoryList));
    const first = renderHistory();
    expect(await screen.findByText('暂无事实版本历史')).toBeInTheDocument();
    first.unmount();

    get.mockResolvedValueOnce(response({
      ...history,
      items: [{
        ...history.items[0]!,
        product_id: '00000000-0000-4000-8000-000000000777',
      }],
      total: 1,
    } satisfies ProductFactHistoryList));
    renderHistory();
    expect(await screen.findByText('未找到该产品的事实历史')).toBeInTheDocument();
    expect(screen.queryByText('补充参数来源')).not.toBeInTheDocument();
  });

  it.each([
    [404, 'NOT_FOUND', '未找到产品事实历史'],
    [403, 'PASSWORD_CHANGE_REQUIRED', '无法访问产品事实历史'],
  ] as const)('处理 %s 且不提供无效 retry', async (status, code, title) => {
    vi.spyOn(api, 'GET').mockResolvedValue(errorResponse(status, code, `req-${status}`));
    renderHistory();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('规范化 direct URL，展示 loading、通用错误与 retry', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve(errorResponse(503, 'FACT_HISTORY_UNAVAILABLE', 'req-history'));
    }));
    const { router } = renderHistory(`/products/${productId}/facts/versions?page=0&pageSize=999&junk=x`);
    expect(await screen.findByLabelText('正在加载表格')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({ page: 1, pageSize: 20 }));

    release?.();
    expect(await screen.findByText('事实版本历史加载失败')).toBeInTheDocument();
    get.mockResolvedValueOnce(response(history));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: 'PS-HISTORY 事实版本历史' })).toBeInTheDocument();
  });
});
