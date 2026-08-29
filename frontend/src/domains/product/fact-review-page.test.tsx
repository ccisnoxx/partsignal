import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';

type FactReviewWorkspace = components['schemas']['ProductFactReviewWorkspace'];
type FactVersion = components['schemas']['FactVersion'];

const productId = '00000000-0000-4000-8000-000000000001';
const factVersionId = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000099';
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
  csrfToken: 'fact-review-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const pendingVersion = {
  id: factVersionId,
  product_id: productId,
  version: 2,
  status: 'PENDING_REVIEW',
  body_markdown: '# 不可变事实\n\n新参数',
  classification: 'INTERNAL',
  change_summary: '补充参数来源',
  primary_task: 'REVIEW_FACT',
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  deletion: null,
  revision: 0,
  created_by: actorId,
  approved_by: null,
  created_at: '2026-08-09T01:00:00Z',
  approved_at: null,
} satisfies FactVersion;

const initialWorkspace = {
  product: {
    id: productId,
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_REVIEW_PENDING',
  },
  review: {
    fact_version: pendingVersion,
    diff: {
      left_id: '00000000-0000-4000-8000-000000000010',
      right_id: factVersionId,
      lines: [
        { kind: 'EQUAL', old_line: 1, new_line: 1, text: '# 不可变事实' },
        { kind: 'DELETE', old_line: 3, new_line: null, text: '旧参数' },
        { kind: 'ADD', old_line: null, new_line: 3, text: '新参数' },
      ],
    },
    available_actions: ['APPROVE', 'REQUEST_CHANGES'],
    review_history: [{
      id: '00000000-0000-4000-8000-000000000020',
      target_id: factVersionId,
      target_version: 2,
      action: 'submit-review',
      comment: '补充参数来源',
      actor: { id: actorId, username: 'engineer', display_name: '内容工程师' },
      created_at: '2026-08-09T01:00:00Z',
    }],
  },
} satisfies FactReviewWorkspace;

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

function renderReview(entry = `/products/${productId}/facts/review`) {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
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

function reviewedWorkspace(canonical: FactVersion): FactReviewWorkspace {
  return {
    ...initialWorkspace,
    product: { ...initialWorkspace.product, workflow_stage: 'FACT_APPROVED' },
    review: {
      ...initialWorkspace.review,
      fact_version: canonical,
      available_actions: [],
      review_history: [
        ...initialWorkspace.review.review_history,
        {
          id: '00000000-0000-4000-8000-000000000021',
          target_id: factVersionId,
          target_version: 2,
          action: canonical.status === 'APPROVED' ? 'approve' : 'request-changes',
          comment: canonical.status === 'APPROVED' ? '' : '请补充参数条件',
          actor: { id: actorId, username: 'engineer', display_name: '内容工程师' },
          created_at: '2026-08-09T02:00:00Z',
        },
      ],
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('FactReviewPage', () => {
  it('一次 GET 展示不可变 Markdown、metadata、Diff、目标历史和服务端动作', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    renderReview();

    expect(await screen.findByRole('heading', { name: 'PS-001', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('事实版本 v2 Markdown 快照')).toHaveTextContent('不可变事实');
    expect(document.querySelector('.cm-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByText('补充参数来源')).toHaveLength(2);
    expect(screen.getByRole('region', { name: '事实版本 Markdown 差异' })).toHaveTextContent('旧参数');
    expect(screen.getByRole('heading', { name: '审核历史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准事实' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '退回修改' })).toBeEnabled();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/products/{product_id}/fact-review-context', {
      params: { path: { product_id: productId } },
    });
  });

  it('批准发送 CSRF 与 expected_revision，采用 canonical response 后刷新 context', async () => {
    const user = userEvent.setup();
    const canonical = {
      ...pendingVersion,
      status: 'APPROVED',
      primary_task: 'CREATE_CONTENT_TASK',
      available_actions: ['RETIRE'],
      revision: 1,
      approved_by: actorId,
      approved_at: '2026-08-09T02:00:00Z',
    } satisfies FactVersion;
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialWorkspace))
      .mockResolvedValue(response(reviewedWorkspace(canonical)));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(canonical));
    const { router } = renderReview();

    await user.click(await screen.findByRole('button', { name: '批准事实' }));
    const dialog = screen.getByRole('dialog', { name: '批准事实版本 v2？' });
    await user.click(within(dialog).getByRole('button', { name: '确认批准' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/fact-versions/{fact_version_id}/approve', {
      body: { expected_revision: 0, comment: '' },
      params: {
        path: { fact_version_id: factVersionId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText('事实版本 v2 已批准')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '批准事实' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/products/${productId}/facts/review`);
  });

  it('退回 Dialog 拒绝空白意见并在 Esc 后恢复焦点', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    const post = vi.spyOn(api, 'POST');
    renderReview();

    const trigger = await screen.findByRole('button', { name: '退回修改' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '退回事实版本 v2' });
    const comment = within(dialog).getByRole('textbox', { name: '退回意见' });
    expect(comment).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '确认退回' }));
    expect(await within(dialog).findAllByText('退回意见不能为空')).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('合法退回意见修剪后发送，并刷新为 canonical 历史', async () => {
    const user = userEvent.setup();
    const canonical = {
      ...pendingVersion,
      status: 'CHANGES_REQUESTED',
      primary_task: 'REVISE_FACT',
      available_actions: [],
      revision: 1,
    } satisfies FactVersion;
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialWorkspace))
      .mockResolvedValue(response(reviewedWorkspace(canonical)));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(canonical));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '退回修改' }));
    const dialog = screen.getByRole('dialog', { name: '退回事实版本 v2' });
    await user.type(within(dialog).getByRole('textbox', { name: '退回意见' }), '  请补充参数条件  ');
    await user.click(within(dialog).getByRole('button', { name: '确认退回' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/fact-versions/{fact_version_id}/request-changes', {
      body: { expected_revision: 0, comment: '请补充参数条件' },
      params: {
        path: { fact_version_id: factVersionId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    expect(await screen.findAllByText('事实版本 v2 已退回修改')).toHaveLength(2);
    expect(screen.getByText('请补充参数条件')).toBeInTheDocument();
  });

  it('409 不重放命令，显示 request ID 并刷新最新 revision', async () => {
    const user = userEvent.setup();
    const revised = {
      ...initialWorkspace,
      review: {
        ...initialWorkspace.review,
        fact_version: { ...pendingVersion, revision: 1 },
      },
    } satisfies FactReviewWorkspace;
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialWorkspace))
      .mockResolvedValue(response(revised));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'REVISION_CONFLICT',
        message: '事实版本已被其他请求修改',
        details: {},
        request_id: 'req-review-conflict',
      },
    }, 409));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '批准事实' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认批准' }));

    expect(await screen.findByText('请求 ID：req-review-conflict')).toBeInTheDocument();
    expect(screen.getByText('事实版本已被其他请求修改')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('region', { name: '审核上下文' })).getByText('1')).toBeInTheDocument();
  });

  it('命令后的 context 刷新失败时保持动作禁用，重试成功后恢复', async () => {
    const user = userEvent.setup();
    const revised = {
      ...initialWorkspace,
      review: {
        ...initialWorkspace.review,
        fact_version: { ...pendingVersion, revision: 1 },
      },
    } satisfies FactReviewWorkspace;
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialWorkspace))
      .mockResolvedValueOnce(response({
        error: {
          code: 'FACT_REVIEW_UNAVAILABLE',
          message: '事实审核服务暂不可用',
          details: {},
          request_id: 'req-refresh-failed',
        },
      }, 503))
      .mockResolvedValue(response(revised));
    vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'REVISION_CONFLICT',
        message: '事实版本已被其他请求修改',
        details: {},
        request_id: 'req-review-conflict',
      },
    }, 409));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '批准事实' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认批准' }));

    expect(await screen.findByText('刷新事实审核上下文失败，已保留当前 canonical 结果')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准事实' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('刷新事实审核上下文失败，已保留当前 canonical 结果')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准事实' })).not.toHaveAttribute('aria-disabled');
    expect(within(screen.getByRole('region', { name: '审核上下文' })).getByText('1')).toBeInTheDocument();
  });

  it('产品存在但没有事实版本时展示 empty context', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      product: { ...initialWorkspace.product, workflow_stage: 'FACTS_EMPTY' },
      review: null,
    } satisfies FactReviewWorkspace));
    renderReview();

    expect(await screen.findByRole('heading', { name: '暂无事实版本可审核' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回事实工作台' })).toHaveAttribute(
      'href',
      `/products/${productId}/facts`,
    );
  });

  it.each([
    [404, '未找到事实审核工作台'],
    [403, '无法访问事实审核工作台'],
  ])('区分 HTTP %s 预期错误', async (status, heading) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      error: {
        code: status === 404 ? 'PRODUCT_NOT_FOUND' : 'PERMISSION_DENIED',
        message: heading,
        details: {},
        request_id: `req-${status}`,
      },
    }, status));
    renderReview();

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });
});
