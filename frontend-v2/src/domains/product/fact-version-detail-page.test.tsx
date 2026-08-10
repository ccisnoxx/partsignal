import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { factVersionQueryOptions } from './product.api';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type FactVersion = components['schemas']['FactVersion'];

const productId = '00000000-0000-4000-8000-000000000001';
const versionId = '10000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000099';
const detailPath = `/products/${productId}/facts/versions/${versionId}`;

const userAccount: AuthUser = {
  id: actorId,
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
};

const auth: AuthContextValue = {
  user: userAccount,
  csrfToken: 'fact-version-detail-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const approvedVersion = {
  id: versionId,
  product_id: productId,
  version: 2,
  status: 'APPROVED',
  body_markdown: '# 不可变事实\n\n<script>危险内容</script>\n\n- 工作电压：5V',
  classification: 'INTERNAL',
  change_summary: '补充参数来源',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: ['RETIRE'],
  deletion: null,
  revision: 1,
  created_by: actorId,
  approved_by: actorId,
  created_at: '2026-08-09T01:00:00Z',
  approved_at: '2026-08-09T02:00:00Z',
} satisfies FactVersion;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(min-width: 1280px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => vi.restoreAllMocks());

function renderDetail(entry = detailPath) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider context={{ queryClient, auth }} router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
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
      message: '事实版本请求失败',
      details: {},
      request_id: requestId,
    },
  } satisfies ErrorEnvelope, status);
}

describe('FactVersionDetailPage', () => {
  it('只请求 exact endpoint，展示 sanitized 不可变快照、metadata、生命周期和返回导航', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(approvedVersion));
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeInTheDocument();
    expect(screen.getAllByText('已批准')).toHaveLength(2);
    expect(screen.getByText('只读 · 不可变快照')).toBeInTheDocument();
    expect(screen.getByLabelText('事实版本 v2 Markdown 快照')).toHaveTextContent('工作电压：5V');
    expect(screen.getByLabelText('事实版本 v2 Markdown 快照')).not.toHaveTextContent('危险内容');
    expect(document.querySelector('.cm-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批准|退回|停用|删除|保存/ })).not.toBeInTheDocument();
    expect(screen.getByText('补充参数来源')).toBeInTheDocument();
    expect(screen.getByText('事实版本已创建')).toBeInTheDocument();
    expect(screen.getByText('事实版本已批准')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回产品详情' })).toHaveAttribute('href', `/products/${productId}`);
    expect(screen.getByRole('link', { name: '返回事实工作台' })).toHaveAttribute('href', `/products/${productId}/facts`);
    expect(screen.getByRole('link', { name: '返回事实历史' })).toHaveAttribute(
      'href',
      `/products/${productId}/facts/versions?page=1&pageSize=20`,
    );
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/fact-versions/{fact_version_id}', {
      params: { path: { fact_version_id: versionId } },
    });
  });

  it.each([
    ['PENDING_REVIEW', '待审核'],
    ['CHANGES_REQUESTED', '待修订'],
    ['APPROVED', '已批准'],
  ] as const)('展示服务端状态 %s，不生成业务动作', async (status, label) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...approvedVersion,
      status,
      approved_by: status === 'APPROVED' ? actorId : null,
      approved_at: status === 'APPROVED' ? approvedVersion.approved_at : null,
    } satisfies FactVersion));
    renderDetail();

    expect(await screen.findAllByText(label)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /批准|退回|停用|删除/ })).not.toBeInTheDocument();
    if (status === 'APPROVED') expect(screen.getByText('事实版本已批准')).toBeInTheDocument();
    else expect(screen.queryByText('事实版本已批准')).not.toBeInTheDocument();
  });

  it('接受 UUID 大小写差异，但拒绝真实 productId mismatch 且不泄漏快照', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(approvedVersion));
    const { queryClient } = renderDetail(detailPath.replace(productId, productId.toUpperCase()));
    expect(await screen.findByRole('heading', { name: 'FactVersion v2' })).toBeInTheDocument();

    queryClient.setQueryData(factVersionQueryOptions(versionId).queryKey, {
      ...approvedVersion,
      product_id: '00000000-0000-4000-8000-000000000777',
      body_markdown: '# 不得泄漏的快照',
    } satisfies FactVersion);
    await waitFor(() => expect(screen.getByRole('heading', { name: '未找到该产品的事实版本' })).toBeInTheDocument());
    expect(screen.queryByText('不得泄漏的快照')).not.toBeInTheDocument();
    expect(screen.queryByText('补充参数来源')).not.toBeInTheDocument();
    expect(screen.queryByText('已批准')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it.each([
    [404, 'NOT_FOUND', '未找到事实版本'],
    [403, 'PASSWORD_CHANGE_REQUIRED', '无法访问事实版本'],
  ] as const)('处理 %s 错误且不提供无效 retry', async (status, code, title) => {
    vi.spyOn(api, 'GET').mockResolvedValue(errorResponse(status, code, `req-${status}`));
    renderDetail();

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('展示 loading、通用错误与 retry，并在后台刷新失败时保留 canonical 快照', async () => {
    const user = userEvent.setup();
    let releaseLoading: (() => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementationOnce(() => new Promise((resolve) => {
      releaseLoading = () => resolve(errorResponse(503, 'FACT_VERSION_UNAVAILABLE', 'req-version-error'));
    }));
    const { queryClient } = renderDetail();

    expect(await screen.findByRole('heading', { name: '正在加载事实版本' })).toBeInTheDocument();
    releaseLoading?.();
    expect(await screen.findByRole('heading', { name: '事实版本加载失败' })).toBeInTheDocument();
    expect(screen.getByText('请求 ID：req-version-error')).toBeInTheDocument();

    get.mockResolvedValueOnce(response(approvedVersion));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: 'FactVersion v2' })).toBeInTheDocument();

    get.mockResolvedValueOnce(errorResponse(503, 'FACT_VERSION_UNAVAILABLE', 'req-refresh-error'));
    await queryClient.refetchQueries({ queryKey: factVersionQueryOptions(versionId).queryKey });
    expect(await screen.findByText('刷新事实版本失败，已保留当前不可变快照')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FactVersion v2' })).toBeInTheDocument();
  });
});
