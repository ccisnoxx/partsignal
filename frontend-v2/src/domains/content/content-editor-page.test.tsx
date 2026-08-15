import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { EditorView } from '@codemirror/view';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type EditorContext = components['schemas']['ContentEditorContext'];
type ContentVersion = components['schemas']['ContentVersion'];

const ids = {
  task: '20000000-0000-4000-8000-000000000001',
  product: '20000000-0000-4000-8000-000000000002',
  fact: '20000000-0000-4000-8000-000000000003',
  content: '20000000-0000-4000-8000-000000000004',
  previous: '20000000-0000-4000-8000-000000000005',
  user: '20000000-0000-4000-8000-000000000006',
} as const;

const authUser: AuthUser = {
  id: ids.user,
  username: 'editor',
  display_name: '内容编辑',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 0,
  created_at: '2026-08-10T00:00:00Z',
};
const auth: AuthContextValue = {
  user: authUser,
  csrfToken: 'content-editor-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
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

function version(overrides: Partial<ContentVersion> = {}): ContentVersion {
  return {
    id: ids.content,
    task_id: ids.task,
    fact_version_id: ids.fact,
    source_job_id: null,
    based_on_id: ids.previous,
    version: 2,
    source_type: 'HUMAN',
    title: '当前人工草稿',
    summary: '当前摘要',
    body_markdown: '# 当前正文',
    tags: ['人工', '工业,控制'],
    content_hash: 'a'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['SUBMIT_REVIEW', 'SAVE', 'DELETE'],
    revision: 2,
    quality_issues: [{ code: 'MISSING_SOURCE', severity: 'WARNING', message: '建议补充来源说明' }],
    created_by: ids.user,
    created_at: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

function editorContext(
  current: ContentVersion | null,
  overrides: Partial<EditorContext> = {},
): EditorContext {
  return {
    task: {
      id: ids.task,
      identifier: 'CT-ABCD1234',
      status: 'OPEN',
      workflow_stage: current ? 'DRAFT' : 'NO_DRAFT',
      primary_task: current ? 'EDIT_AND_SUBMIT_REVIEW' : 'CREATE_FIRST_DRAFT',
      available_actions: current ? ['CANCEL'] : ['CREATE_MANUAL_VERSION', 'CANCEL'],
      deletion: null,
      revision: 4,
      created_by: ids.user,
      created_at: '2026-08-10T00:00:00Z',
      archived_at: null,
    },
    product: {
      id: ids.product,
      brand: 'PartSignal',
      part_number: 'PS-EDITOR',
      category: 'MCU',
      status: 'ACTIVE',
    },
    platform: { id: null, name: '工程师社区', website_url: null, logo: null },
    locked_fact_version: {
      id: ids.fact,
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
      body_markdown: '## 锁定事实\n\n工作电压 3.3 V。',
    },
    current_content: current,
    comparison_content: current ? {
      id: ids.previous,
      version: 1,
      source_type: 'AI',
      status: 'DRAFT',
      title: '比较版本',
    } : null,
    diff: current ? {
      left_id: ids.previous,
      right_id: current.id,
      lines: [
        { kind: 'DELETE', old_line: 1, new_line: null, text: '旧正文' },
        { kind: 'ADD', old_line: null, new_line: 1, text: '当前正文' },
      ],
    } : null,
    latest_generation: null,
    current_lineage: null,
    source: null,
    ...overrides,
  };
}

function renderEditor(entry = `/content/tasks/${ids.task}/editor`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  return { data: value, response: Response.json(value, { status }) } as never;
}

function apiError(code: string, message: string, requestId: string, status: number) {
  return {
    error: { error: { code, message, details: {}, request_id: requestId } },
    response: Response.json({}, { status }),
  } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('ContentEditorPage', () => {
  it('显示首屏 loading', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(new Promise(() => undefined));
    renderEditor();

    expect(await screen.findByRole('heading', { name: '正在加载 Content Editor' })).toBeInTheDocument();
  });

  it('generic error 显示 request ID 并允许原位重试', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(apiError('EDITOR_CONTEXT_UNAVAILABLE', '编辑器暂不可用', 'req-editor-load', 503))
      .mockResolvedValue(response(editorContext(null)));
    renderEditor();

    expect(await screen.findByRole('heading', { name: 'Content Editor 加载失败' })).toBeInTheDocument();
    expect(screen.getByText('请求 ID：req-editor-load')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: 'CT-ABCD1234' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('no-current 首屏只读取 Editor Context，并创建完整人工首稿 payload', async () => {
    const empty = editorContext(null);
    const created = version({ based_on_id: null, version: 1, revision: 0 });
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(empty));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(created, 201));
    const user = userEvent.setup();
    renderEditor();

    expect(await screen.findByRole('heading', { name: 'CT-ABCD1234' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '标题' }), '人工首稿');
    await user.type(screen.getByRole('textbox', { name: '摘要' }), '人工摘要');
    await user.type(screen.getByRole('textbox', { name: '标签' }), '工业,控制\n人工');
    await user.type(screen.getByRole('textbox', { name: '变更说明' }), '创建首稿');
    const editor = screen.getByRole('textbox', { name: '内容 Markdown' });
    const editorView = EditorView.findFromDOM(editor);
    act(() => editorView?.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: '# 人工正文' } }));
    await user.click(screen.getByRole('button', { name: '创建人工首稿' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith(
      '/api/v1/content-tasks/{content_task_id}/manual-versions',
      {
        body: {
          title: '人工首稿',
          summary: '人工摘要',
          body_markdown: '# 人工正文',
          tags: ['工业,控制', '人工'],
          change_summary: '创建首稿',
        },
        params: {
          path: { content_task_id: ids.task },
          header: { 'X-CSRF-Token': 'content-editor-component-csrf' },
        },
      },
    );
    expect(
      (get.mock.calls as unknown as Array<[string]>).every(
        ([path]) => path === '/api/v1/content-tasks/{content_task_id}/editor-context',
      ),
    ).toBe(true);
  });

  it('当前 HUMAN DRAFT 保存只发送 ContentDraftUpdate，并显示 server Diff/quality', async () => {
    const current = version();
    const context = editorContext(current);
    const canonical = version({ title: '已保存标题', revision: 3 });
    vi.spyOn(api, 'GET').mockResolvedValue(response(context));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(response(canonical));
    const user = userEvent.setup();
    renderEditor();

    const title = await screen.findByRole('textbox', { name: '标题' });
    await user.clear(title);
    await user.type(title, '已保存标题');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0]?.[1]).toMatchObject({
      body: {
        expected_revision: 2,
        title: '已保存标题',
        summary: '当前摘要',
        body_markdown: '# 当前正文',
        tags: ['人工', '工业,控制'],
      },
    });
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('body.change_summary');
    expect(await screen.findByText('已保存 · Revision 3')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '参考' }));
    expect(screen.getByText('建议补充来源说明')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '内容文档' }));
    await user.click(screen.getByRole('tab', { name: 'Diff' }));
    const documentPane = screen.getByRole('region', { name: '内容文档' });
    expect(within(documentPane).getByText(/v1 → v2/)).toBeInTheDocument();
    expect(within(documentPane).getByText(/\+当前正文/)).toBeInTheDocument();
  });

  it('AI DRAFT 保持只读，只能显式创建新 revision', async () => {
    const ai = version({
      source_type: 'AI',
      source_job_id: '20000000-0000-4000-8000-000000000099',
      available_actions: ['CREATE_REVISION', 'SUBMIT_REVIEW', 'ABANDON'],
    });
    vi.spyOn(api, 'GET').mockResolvedValue(response(editorContext(ai)));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(version({
      id: '20000000-0000-4000-8000-000000000088',
      source_type: 'HUMAN',
      source_job_id: null,
      based_on_id: ai.id,
      version: 3,
      revision: 0,
    }), 201));
    const user = userEvent.setup();
    renderEditor();

    expect(await screen.findByText('只读')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /批准|要求修改/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建人工修订' }));
    expect(screen.getByText('新人工修订')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '标题' })).not.toHaveAttribute('readonly');
    await user.type(screen.getByRole('textbox', { name: '变更说明' }), '修订 AI 草稿');
    await user.click(screen.getByRole('button', { name: '创建人工修订' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith(
      '/api/v1/content-versions/{content_version_id}/revisions',
      expect.objectContaining({
        body: expect.objectContaining({ change_summary: '修订 AI 草稿' }),
        params: expect.objectContaining({ path: { content_version_id: ai.id } }),
      }),
    );
  });

  it('409 保留本地输入和 request ID，只在显式 reload 后采用服务端值', async () => {
    const current = version();
    const staleContext = editorContext(current);
    const serverContext = editorContext(version({ title: '服务端新标题', revision: 3 }));
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(staleContext))
      .mockResolvedValue(response(serverContext));
    vi.spyOn(api, 'PUT').mockResolvedValue(
      apiError('REVISION_CONFLICT', '内容版本已被其他请求修改', 'req-editor-409', 409),
    );
    const user = userEvent.setup();
    renderEditor();

    const title = await screen.findByRole('textbox', { name: '标题' });
    await user.clear(title);
    await user.type(title, '本地未保存标题');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText('请求 ID：req-editor-409')).toBeInTheDocument();
    expect(title).toHaveValue('本地未保存标题');
    await user.click(screen.getByRole('button', { name: '重新加载最新版本' }));
    await waitFor(() => expect(title).toHaveValue('服务端新标题'));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('dirty 时禁止提交；clean 时按 canonical revision 提交可选备注', async () => {
    const current = version({ available_actions: ['SUBMIT_REVIEW', 'SAVE'] });
    const pending = version({
      status: 'PENDING_REVIEW',
      workflow_stage: 'CURRENT_REVIEW_PENDING',
      primary_task: 'REVIEW_CONTENT',
      available_actions: ['APPROVE', 'REQUEST_CHANGES'],
      revision: 3,
    });
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(editorContext(current)))
      .mockResolvedValue(response(editorContext(pending, {
        task: {
          ...editorContext(current).task,
          workflow_stage: 'REVIEW_PENDING',
          primary_task: 'REVIEW_CONTENT',
        },
      })));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(pending));
    const user = userEvent.setup();
    renderEditor();

    const title = await screen.findByRole('textbox', { name: '标题' });
    await user.type(title, ' 未保存');
    expect(screen.getByRole('button', { name: '提交审核' })).toHaveAttribute('aria-disabled', 'true');
    await user.clear(title);
    await user.type(title, '当前人工草稿');
    await waitFor(() => expect(screen.getByRole('button', { name: '提交审核' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '提交审核' }));
    const dialog = await screen.findByRole('dialog', { name: '提交内容审核' });
    await user.type(within(dialog).getByRole('textbox', { name: '备注（可选）' }), '请审核');
    await user.click(within(dialog).getByRole('button', { name: '确认提交审核' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: { expected_revision: 2, comment: '请审核' },
    });
    expect(await screen.findByText('只读')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批准|要求修改/ })).not.toBeInTheDocument();
  });
});
