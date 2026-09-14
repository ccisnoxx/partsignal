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

type FactWorkspace = components['schemas']['ProductFactsDraft'];
type FactWorkspaceUpdate = components['schemas']['ProductFactsDraftUpdate'];
type FactVersion = components['schemas']['FactVersion'];

const productId = '00000000-0000-4000-8000-000000000001';
const userAccount: AuthUser = {
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
};
const auth: AuthContextValue = {
  user: userAccount,
  csrfToken: 'fact-workspace-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const initialWorkspace = {
  product_id: productId,
  product: {
    id: productId,
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACTS_EDITING',
  },
  body_markdown: '## 初始事实',
  classification: 'INTERNAL',
  approved_fact: { version: 2, status: 'APPROVED' },
  pending_fact: null,
  available_actions: ['SAVE', 'SUBMIT_REVIEW'],
  revision: 3,
} satisfies FactWorkspace;

const submittedVersion = {
  id: '00000000-0000-4000-8000-000000000010',
  product_id: productId,
  version: 3,
  status: 'PENDING_REVIEW',
  body_markdown: initialWorkspace.body_markdown,
  classification: initialWorkspace.classification,
  change_summary: '提交审核',
  primary_task: 'REVIEW_FACT',
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  deletion: null,
  revision: 0,
  created_by: userAccount.id,
  approved_by: null,
  created_at: '2026-08-09T01:00:00Z',
  approved_at: null,
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
  Range.prototype.getClientRects = vi.fn(() => Object.assign([], { item: () => null }));
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
});

function renderWorkspace(entry = `/products/${productId}/facts`) {
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
  return { data: status < 400 ? value : undefined, error: status >= 400 ? value : undefined, response: Response.json(value, { status }) } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('FactWorkspacePage', () => {
  it('一次 GET 绘制完整上下文，并以 canonical response 完成保存', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    const put = vi.spyOn(api, 'PUT').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: FactWorkspaceUpdate }).body;
      return response({
        ...initialWorkspace,
        body_markdown: body.body_markdown,
        classification: body.classification,
        revision: 4,
      });
    });
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'PS-001', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('已批准')).toHaveLength(2);
    expect(screen.getAllByText('事实编辑中')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '提交事实审核' })).toBeEnabled();
    expect(get).toHaveBeenCalledOnce();

    const editor = screen.getByRole('textbox', { name: '事实 Markdown' });
    await user.click(editor);
    await user.keyboard('{Control>}{End}{/Control}');
    await user.type(editor, '\nupdate');
    expect(screen.getByText(/有未保存修改/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存事实' }));

    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put).toHaveBeenCalledWith('/api/v1/products/{product_id}/facts', {
      body: {
        expected_revision: 3,
        body_markdown: expect.any(String),
        classification: 'INTERNAL',
      },
      params: {
        path: { product_id: productId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    const savedBody = (put.mock.calls[0]?.[1] as unknown as { body: FactWorkspaceUpdate }).body.body_markdown;
    expect(savedBody).not.toBe(initialWorkspace.body_markdown);
    expect(await screen.findByText('已保存 · Revision 4')).toBeInTheDocument();
  });

  it('revision conflict 保留本地正文，显式 reload 后才采用 canonical 值', async () => {
    const user = userEvent.setup();
    let canonical: FactWorkspace = initialWorkspace;
    vi.spyOn(api, 'GET').mockImplementation(async () => response(canonical));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(response({
      error: {
        code: 'REVISION_CONFLICT',
        message: '事实工作区已被其他请求修改',
        details: {},
        request_id: 'req-conflict',
      },
    }, 409));
    renderWorkspace();
    const editor = await screen.findByRole('textbox', { name: '事实 Markdown' });
    await user.click(editor);
    await user.paste('LOCAL\n');
    expect(screen.getByText('13 字符 · 2 行')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存事实' }));

    expect(await screen.findByRole('alert', { name: '' })).toHaveTextContent('revision 冲突');
    expect(screen.getByText('请求 ID：req-conflict')).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/api/v1/products/{product_id}/facts', expect.objectContaining({
      body: expect.objectContaining({ body_markdown: 'LOCAL\n## 初始事实' }),
    }));
    await user.click(screen.getByRole('tab', { name: '预览' }));
    const localPreview = screen.getByRole('article', { name: 'Markdown 预览' });
    expect(within(localPreview).getByRole('heading', { name: '初始事实' })).toBeInTheDocument();
    expect(within(localPreview).getByText('LOCAL')).toBeInTheDocument();

    canonical = { ...initialWorkspace, body_markdown: '## 服务端最新事实', revision: 4 };
    await user.click(screen.getByRole('button', { name: '重新加载最新版本' }));
    expect(await within(screen.getByRole('article', { name: 'Markdown 预览' })).findByRole('heading', { name: '服务端最新事实' })).toBeInTheDocument();
    expect(screen.queryByText('LOCAL')).not.toBeInTheDocument();
    expect(screen.queryByText(/有未保存修改/)).not.toBeInTheDocument();
  });

  it('后台 refetch 失败时保留 dirty 表单和离开保护', async () => {
    const user = userEvent.setup();
    let failRefresh = false;
    vi.spyOn(api, 'GET').mockImplementation(async () => failRefresh
      ? response({
        error: {
          code: 'PRODUCT_FACTS_UNAVAILABLE',
          message: '事实服务暂不可用',
          details: {},
          request_id: 'req-refresh',
        },
      }, 503)
      : response(initialWorkspace));
    const { queryClient } = renderWorkspace();
    const editor = await screen.findByRole('textbox', { name: '事实 Markdown' });
    await user.click(editor);
    await user.paste('LOCAL\n');
    expect(screen.getByText('13 字符 · 2 行')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '预览' }));

    failRefresh = true;
    await queryClient.refetchQueries({ queryKey: ['products', 'facts', productId] });

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新事实工作台失败，已保留当前编辑内容');
    expect(screen.getByText(/req-refresh/)).toBeInTheDocument();
    const localPreview = screen.getByRole('article', { name: 'Markdown 预览' });
    expect(within(localPreview).getByRole('heading', { name: '初始事实' })).toBeInTheDocument();
    expect(within(localPreview).getByText('LOCAL')).toBeInTheDocument();
    expect(screen.getByText(/有未保存修改/)).toBeInTheDocument();
  });

  it('切换到已缓存的同 revision 产品时重建表单状态', async () => {
    const secondId = '00000000-0000-4000-8000-000000000002';
    const secondWorkspace: FactWorkspace = {
      ...initialWorkspace,
      product_id: secondId,
      product: {
        ...initialWorkspace.product,
        id: secondId,
        part_number: 'PS-002',
      },
      body_markdown: '## 第二个产品事实',
    };
    vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    const { queryClient, router } = renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'PS-001' })).toBeInTheDocument();
    queryClient.setQueryData(['products', 'facts', secondId], secondWorkspace);

    await router.navigate({ to: '/products/$productId/facts', params: { productId: secondId } });

    expect(await screen.findByRole('heading', { name: 'PS-002' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '事实 Markdown' })).toHaveTextContent('第二个产品事实');
  });

  it('提交 clean 草稿后停留当前页，并以 refetch 后的服务端动作隐藏提交', async () => {
    const user = userEvent.setup();
    let canonical: FactWorkspace = initialWorkspace;
    vi.spyOn(api, 'GET').mockImplementation(async () => response(canonical));
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => {
      canonical = {
        ...initialWorkspace,
        product: { ...initialWorkspace.product, workflow_stage: 'FACT_REVIEW_PENDING' },
        pending_fact: { version: 3, status: 'PENDING_REVIEW' },
        available_actions: ['SAVE'],
      };
      return response(submittedVersion, 201);
    });
    const { router } = renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));
    expect(await within(dialog).findByRole('alert', { name: '' })).toHaveTextContent('变更摘要不能为空');
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), '补充参数来源');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/products/{product_id}/fact-review-submissions', {
      body: { expected_revision: 3, change_summary: '补充参数来源' },
      params: {
        path: { product_id: productId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: '提交事实审核' })).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/products/${productId}/facts`);
    expect(screen.getAllByText('待审核')).toHaveLength(2);
    expect(screen.getAllByText('事实版本 v3 已提交审核')).toHaveLength(2);
  });

  it('FACT_REVIEW_PENDING 显示准确错误并只提交一次，canonical 动作收敛后保留摘要', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const canonical: FactWorkspace = {
      ...initialWorkspace,
      product: { ...initialWorkspace.product, workflow_stage: 'FACT_REVIEW_PENDING' },
      pending_fact: { version: 3, status: 'PENDING_REVIEW' },
      available_actions: ['SAVE'],
    };
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => {
      getCount += 1;
      return response(getCount === 1 ? initialWorkspace : canonical);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'FACT_REVIEW_PENDING',
        message: '该产品已有待审核事实版本',
        details: {},
        request_id: 'req-pending',
      },
    }, 409));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), '保留本地摘要');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('该产品已有待审核事实版本');
    expect(within(dialog).getByText('请求 ID：req-pending')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: '变更摘要' })).toHaveValue('保留本地摘要');
    expect(post).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '提交事实审核' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认提交审核' })).toBeDisabled();
  });

  it('pending canonical refetch 失败时保留 blocker，关闭后页面入口仍不能再次 POST', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => {
      getCount += 1;
      return getCount === 1
        ? response(initialWorkspace)
        : response({
          error: {
            code: 'FACT_WORKSPACE_UNAVAILABLE',
            message: '事实工作台暂不可用',
            details: {},
            request_id: 'req-refresh-failed',
          },
        }, 503);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'FACT_REVIEW_PENDING',
        message: '该产品已有待审核事实版本',
        details: {},
        request_id: 'req-pending-failed-refresh',
      },
    }, 409));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), '刷新失败时保留');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));

    expect(await screen.findByText('刷新事实工作台失败，已保留当前编辑内容')).toBeInTheDocument();
    expect(within(dialog).getByText('请求 ID：req-pending-failed-refresh')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认提交审核' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    const submitAction = await screen.findByRole('button', { name: '提交事实审核' });
    expect(submitAction).toHaveAttribute('aria-disabled', 'true');
    expect(post).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('切换到另一个 productId 后不会继承前一产品的 pending blocker', async () => {
    const user = userEvent.setup();
    const secondId = '00000000-0000-4000-8000-000000000002';
    const secondWorkspace: FactWorkspace = {
      ...initialWorkspace,
      product_id: secondId,
      product: { ...initialWorkspace.product, id: secondId, part_number: 'PS-002' },
    };
    let getCount = 0;
    const get = vi.spyOn(api, 'GET').mockImplementation(async (_path, options) => {
      const requestedId = (options as { params?: { path?: { product_id?: string } } }).params?.path?.product_id;
      if (requestedId === secondId) return response(secondWorkspace);
      getCount += 1;
      return getCount === 1
        ? response(initialWorkspace)
        : response({
          error: {
            code: 'FACT_WORKSPACE_UNAVAILABLE',
            message: '事实工作台暂不可用',
            details: {},
            request_id: 'req-switch-refresh',
          },
        }, 503);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'FACT_REVIEW_PENDING',
        message: '该产品已有待审核事实版本',
        details: {},
        request_id: 'req-switch-pending',
      },
    }, 409));
    const { queryClient, router } = renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), 'A 产品摘要');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));
    expect(await within(dialog).findByText('请求 ID：req-switch-pending')).toBeInTheDocument();

    queryClient.setQueryData(['products', 'facts', secondId], secondWorkspace);
    await router.navigate({ to: '/products/$productId/facts', params: { productId: secondId } });

    expect(await screen.findByRole('heading', { name: 'PS-002' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '提交事实审核' })).toBeEnabled());
    expect(screen.queryByText('请求 ID：req-switch-pending')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('pending refetch 延迟期间产生的 dirty 输入不被 canonical reset 覆盖', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    let releaseReload: ((value: ReturnType<typeof response<FactWorkspace>>) => void) | undefined;
    let notifyReloadStarted: (() => void) | undefined;
    const reloadStarted = new Promise<void>((resolve) => { notifyReloadStarted = resolve; });
    const canonical: FactWorkspace = {
      ...initialWorkspace,
      body_markdown: '## 服务端 canonical 事实',
      available_actions: ['SAVE'],
      pending_fact: { version: 3, status: 'PENDING_REVIEW' },
      revision: 4,
    };
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => {
      getCount += 1;
      if (getCount === 1) return response(initialWorkspace);
      notifyReloadStarted?.();
      return new Promise((resolve) => { releaseReload = resolve; });
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'FACT_REVIEW_PENDING',
        message: '该产品已有待审核事实版本',
        details: {},
        request_id: 'req-deferred-pending',
      },
    }, 409));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), '延迟刷新摘要');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));
    await reloadStarted;
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    const editor = screen.getByRole('textbox', { name: '事实 Markdown' });
    await user.click(editor);
    await user.paste('LOCAL-DEFERRED\n');

    releaseReload?.(response(canonical));
    await waitFor(() => expect(screen.queryByRole('button', { name: '提交事实审核' })).not.toBeInTheDocument());
    expect(editor).toHaveTextContent('LOCAL-DEFERRED');
    expect(editor).not.toHaveTextContent('服务端 canonical 事实');
    expect(screen.getByText('有未保存修改 · 基于 Revision 3')).toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('unknown 500 与错误文案相同也不进入 pending recovery 或自动 reload', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'FACT_REVIEW_PENDING',
        message: '该产品已有待审核事实版本',
        details: {},
        request_id: 'req-server-failure',
      },
    }, 500));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '提交事实审核' }));
    const dialog = screen.getByRole('dialog', { name: '提交事实审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '变更摘要' }), '服务端失败');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('提交事实审核失败，请稍后重试。');
    expect(within(dialog).getByText('请求 ID：req-server-failure')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole('button', { name: '确认提交审核' })).toBeEnabled();
  });

  it('dirty 表单拦截导航', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response(initialWorkspace));
    const { router } = renderWorkspace();
    const editor = await screen.findByRole('textbox', { name: '事实 Markdown' });
    await user.click(editor);
    await user.keyboard('{Control>}{End}{/Control}');
    await user.type(editor, '\n未保存');
    void router.navigate({ to: '/products', search: { page: 1 } });
    expect(await screen.findByRole('dialog', { name: '要离开当前页面吗？' })).toBeInTheDocument();
  });

  it('RETIRED read model 只读且不提供写动作', async () => {
    const retired = {
      ...initialWorkspace,
      product: { ...initialWorkspace.product, status: 'RETIRED', workflow_stage: 'RETIRED' },
      available_actions: [],
    } satisfies FactWorkspace;
    vi.spyOn(api, 'GET').mockResolvedValue(response(retired));
    renderWorkspace();
    expect((await screen.findAllByText('已停用')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '保存事实' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交事实审核' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '事实 Markdown' })).toHaveAttribute('contenteditable', 'false');
  });

  it.each([
    [404, '未找到产品事实工作台'],
    [403, '无法访问事实工作台'],
  ])('区分 HTTP %s 预期错误', async (status, heading) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      error: {
        code: status === 404 ? 'PRODUCT_NOT_FOUND' : 'PERMISSION_DENIED',
        message: heading,
        details: {},
        request_id: `req-${status}`,
      },
    }, status));
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });
});
