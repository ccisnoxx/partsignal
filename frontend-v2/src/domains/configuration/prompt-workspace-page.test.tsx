import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type PlatformPromptDetail = components['schemas']['PlatformPromptDetail'];
type PlatformPromptList = components['schemas']['PlatformPromptList'];

const promptId = '10000000-0000-4000-8000-000000000001';
const secondPromptId = '10000000-0000-4000-8000-000000000002';
const platformId = '20000000-0000-4000-8000-000000000001';
const adminUser: AuthUser = {
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
  user: adminUser,
  csrfToken: 'prompt-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function prompt(overrides: Partial<PlatformPromptDetail> = {}): PlatformPromptDetail {
  return {
    id: promptId,
    name: '技术文章 Prompt',
    template_markdown: '# 写作约束',
    revision: 4,
    updated_at: '2026-08-12T00:00:00Z',
    updated_by: adminUser.id,
    created_at: '2026-08-01T00:00:00Z',
    bound_platform_count: 1,
    bound_platforms: [{ id: platformId, name: '工程师社区', slug: 'engineer-community' }],
    available_actions: ['UPDATE', 'DELETE'],
    ...overrides,
  };
}

function list(): PlatformPromptList {
  const first = prompt();
  return {
    items: [
      {
        id: first.id,
        name: first.name,
        revision: first.revision,
        updated_at: first.updated_at,
        updated_by: first.updated_by,
        bound_platform_count: first.bound_platform_count,
        available_actions: first.available_actions,
      },
      {
        id: secondPromptId,
        name: '产品简报 Prompt',
        revision: 2,
        updated_at: '2026-08-11T00:00:00Z',
        updated_by: adminUser.id,
        bound_platform_count: 0,
        available_actions: ['UPDATE', 'DELETE'],
      },
    ],
  };
}

function response<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function renderWorkspace(entry = '/settings/prompts') {
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

function mockReads(current: () => PlatformPromptDetail = () => prompt()) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    if (path === '/api/v1/platform-prompts') return response(list());
    if (path === '/api/v1/platform-prompts/{platform_prompt_id}') {
      const id = (options as unknown as { params: { path: { platform_prompt_id: string } } })
        .params.path.platform_prompt_id;
      if (id === promptId) return response(current());
      if (id === secondPromptId) return response(prompt({
        id: secondPromptId,
        name: '产品简报 Prompt',
        revision: 2,
        bound_platform_count: 0,
        bound_platforms: [],
      }));
    }
    throw new Error(`测试收到未声明 GET：${path}`);
  });
}

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

afterEach(() => vi.restoreAllMocks());

describe('PromptWorkspacePage', () => {
  it('空 URL 不自动选中；q-only 导航保留草稿，切换 Prompt 仍由 DirtyGuard 阻断', async () => {
    const get = mockReads();
    const { router } = renderWorkspace();

    expect(await screen.findByRole('heading', { level: 1, name: 'Prompt 管理' })).toBeInTheDocument();
    expect(screen.getByText(/从 Prompt Library 选择/)).toBeInTheDocument();
    expect(get.mock.calls.map((call) => call[0])).toEqual(['/api/v1/platform-prompts']);

    await userEvent.click(screen.getByRole('button', { name: /技术文章 Prompt/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ promptId }));
    const name = await screen.findByRole('textbox', { name: 'Prompt 名称' });
    await userEvent.clear(name);
    await userEvent.type(name, '未保存 Prompt');

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索 Prompt 名称' }), '技术');
    expect(screen.queryByRole('dialog', { name: '要离开当前页面吗？' })).not.toBeInTheDocument();
    expect(name).toHaveValue('未保存 Prompt');
    await waitFor(() => expect(router.state.location.search).toEqual({ q: '技术', promptId }));

    await userEvent.clear(screen.getByRole('searchbox', { name: '搜索 Prompt 名称' }));
    await userEvent.click(screen.getByRole('button', { name: /产品简报 Prompt/ }));
    const guard = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    await userEvent.click(within(guard).getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.search).toEqual({ promptId });
    expect(name).toHaveValue('未保存 Prompt');
  });

  it('创建只提交合同字段与 CSRF，并采用响应 ID/revision 进入 canonical URL', async () => {
    mockReads();
    const created = prompt({
      id: '10000000-0000-4000-8000-000000000003',
      name: '新 Prompt',
      template_markdown: '# 新正文',
      revision: 0,
      bound_platform_count: 0,
      bound_platforms: [],
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(created));
    const { router } = renderWorkspace('/settings/prompts?new=1');

    const name = await screen.findByRole('textbox', { name: 'Prompt 名称' });
    await userEvent.type(name, '  新 Prompt  ');
    const markdown = screen.getByRole('textbox', { name: 'Prompt Markdown' });
    const editorView = EditorView.findFromDOM(markdown);
    act(() => editorView?.dispatch({ changes: { from: 0, insert: '  # 新正文  ' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建 Prompt' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '创建 Prompt' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/platform-prompts', {
      body: { name: '新 Prompt', template_markdown: '# 新正文' },
      params: { header: { 'X-CSRF-Token': auth.csrfToken } },
    }));
    await waitFor(() => expect(router.state.location.search).toEqual({ promptId: created.id }));
    expect(await screen.findByText('未修改 · Revision 0')).toBeInTheDocument();
  });

  it('名称冲突映射回字段并保留创建草稿与 request ID', async () => {
    mockReads();
    vi.spyOn(api, 'POST').mockResolvedValue({
      error: { error: {
        code: 'PLATFORM_PROMPT_NAME_EXISTS',
        message: 'Prompt 名称已存在',
        details: {},
        request_id: 'req-name-conflict',
      } },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderWorkspace('/settings/prompts?new=1');

    const name = await screen.findByRole('textbox', { name: 'Prompt 名称' });
    await userEvent.type(name, '重复 Prompt');
    const markdown = screen.getByRole('textbox', { name: 'Prompt Markdown' });
    act(() => EditorView.findFromDOM(markdown)?.dispatch({ changes: { from: 0, insert: '# 草稿' } }));
    const create = await screen.findByRole('button', { name: '创建 Prompt' });
    await waitFor(() => expect(create).toBeEnabled());
    const createForm = name.closest('form');
    if (!createForm) throw new Error('测试未找到 Prompt 创建表单');
    fireEvent.submit(createForm);

    expect((await screen.findAllByText('Prompt 名称已存在')).length).toBeGreaterThan(0);
    expect(screen.getByText('请求 ID：req-name-conflict')).toBeInTheDocument();
    expect(name).toHaveValue('重复 Prompt');
    expect(EditorView.findFromDOM(markdown)?.state.doc.toString()).toBe('# 草稿');
  });

  it('保存前读取最新影响范围，确认后单次 PUT，并精确失效跨域消费者', async () => {
    let current = prompt();
    const get = mockReads(() => current);
    const put = vi.spyOn(api, 'PUT').mockImplementation(async (_path, options) => {
      const body = (options as unknown as { body: components['schemas']['PlatformPromptUpdate'] }).body;
      current = prompt({
        name: body.name,
        template_markdown: body.template_markdown,
        revision: 5,
      });
      return response(current);
    });
    const { queryClient } = renderWorkspace(`/settings/prompts?promptId=${promptId}`);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const markdown = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
    const editorView = EditorView.findFromDOM(markdown);
    act(() => {
      editorView?.focus();
      editorView?.dispatch({ changes: { from: editorView.state.doc.length, insert: '\n新增约束' } });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存 Prompt' })).toBeEnabled());
    const form = screen.getByRole('textbox', { name: 'Prompt 名称' }).closest('form');
    if (!form) throw new Error('测试未找到 Prompt 表单');
    fireEvent.submit(form);
    await waitFor(() => expect(
      get.mock.calls.filter((call) => call[0] === '/api/v1/platform-prompts/{platform_prompt_id}').length,
    ).toBeGreaterThanOrEqual(2));

    const dialog = await screen.findByRole('dialog', { name: '保存将影响绑定平台' });
    expect(within(dialog).getByRole('link', { name: '工程师社区' })).toHaveAttribute(
      'href',
      `/settings/platforms/${platformId}?tab=generation`,
    );
    expect(put).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: '确认保存' }));

    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put).toHaveBeenCalledWith('/api/v1/platform-prompts/{platform_prompt_id}', {
      body: {
        name: '技术文章 Prompt',
        template_markdown: '# 写作约束\n新增约束',
        expected_revision: 4,
      },
      params: {
        path: { platform_prompt_id: promptId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    expect(get.mock.calls.filter((call) => call[0] === '/api/v1/platform-prompts/{platform_prompt_id}').length)
      .toBeGreaterThanOrEqual(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['configuration', 'platforms', 'detail'] });
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    expect(await screen.findByText('未修改 · Revision 5')).toBeInTheDocument();
  });

  it('revision 冲突保留本地 Markdown，只有显式 reload 才采用服务端版本', async () => {
    let current = prompt();
    mockReads(() => current);
    vi.spyOn(api, 'PUT').mockImplementation(async () => {
      current = prompt({ revision: 5, template_markdown: '# 服务端版本' });
      return {
        error: { error: {
          code: 'REVISION_CONFLICT',
          message: 'Prompt 已变化',
          details: {},
          request_id: 'req-revision-conflict',
        } },
        response: Response.json({}, { status: 409 }),
      } as never;
    });
    renderWorkspace(`/settings/prompts?promptId=${promptId}`);

    const markdown = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
    const editorView = EditorView.findFromDOM(markdown);
    act(() => editorView?.dispatch({
      changes: { from: editorView.state.doc.length, insert: '\n本地草稿' },
    }));
    const save = await screen.findByRole('button', { name: '保存 Prompt' });
    await waitFor(() => expect(save).toBeEnabled());
    const updateForm = save.closest('form');
    if (!updateForm) throw new Error('测试未找到 Prompt 更新表单');
    fireEvent.submit(updateForm);
    const impact = await screen.findByRole('dialog', { name: '保存将影响绑定平台' });
    await userEvent.click(within(impact).getByRole('button', { name: '确认保存' }));

    expect(await screen.findByText('Revision 冲突 · 本地草稿已保留')).toBeInTheDocument();
    expect(screen.getByText('请求 ID：req-revision-conflict')).toBeInTheDocument();
    expect(EditorView.findFromDOM(markdown)?.state.doc.toString()).toBe('# 写作约束\n本地草稿');
    await userEvent.click(screen.getByRole('button', { name: '重新加载最新版本' }));

    expect(await screen.findByText('未修改 · Revision 5')).toBeInTheDocument();
    expect(EditorView.findFromDOM(markdown)?.state.doc.toString()).toBe('# 服务端版本');
  });

  it('删除前重读 Detail，提交最新 revision，成功清除选择并保留 q', async () => {
    const get = mockReads();
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient, router } = renderWorkspace(`/settings/prompts?q=技术&promptId=${promptId}`);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const name = await screen.findByRole('textbox', { name: 'Prompt 名称' });
    await userEvent.type(name, '（未保存）');
    await userEvent.click(await screen.findByRole('button', { name: '删除 Prompt' }));
    const dialog = await screen.findByRole('dialog', { name: '删除 Prompt“技术文章 Prompt”？' });
    expect(within(dialog).getByText(/工程师社区/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(
      '/api/v1/platform-prompts/{platform_prompt_id}',
      {
        params: {
          path: { platform_prompt_id: promptId },
          query: { expected_revision: 4 },
          header: { 'X-CSRF-Token': auth.csrfToken },
        },
      },
    ));
    await waitFor(() => expect(router.state.location.search).toEqual({ q: '技术' }));
    expect(screen.queryByRole('dialog', { name: '要离开当前页面吗？' })).not.toBeInTheDocument();
    expect(screen.getByText(/从 Prompt Library 选择/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['configuration', 'prompts', 'detail', promptId],
      refetchType: 'none',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['content', 'tasks', 'list'] });
    expect(get.mock.calls.filter((call) => call[0] === '/api/v1/platform-prompts/{platform_prompt_id}').length)
      .toBeGreaterThanOrEqual(2);
  });

  it.each([
    [404, '未找到 Prompt'],
    [403, '无法访问 Prompt'],
  ])('Detail HTTP %s 显示专用状态且不清理合法 URL', async (status, heading) => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-prompts') return response(list());
      return {
        error: { error: {
          code: status === 404 ? 'PLATFORM_PROMPT_NOT_FOUND' : 'PERMISSION_DENIED',
          message: heading,
          details: {},
          request_id: `req-${status}`,
        } },
        response: Response.json({}, { status }),
      } as never;
    });
    const { router } = renderWorkspace(`/settings/prompts?promptId=${promptId}`);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ promptId });
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });
});
