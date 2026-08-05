/** 验证内容任务身份与各次级查询拥有独立错误边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { CONTENT_TAG_ERROR, hasValidContentTags } from '../../shared/contentValidation';
import { ContentTasksPage } from './ContentTasksPage';

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  PATCH: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
  newIdempotencyKey: vi.fn(),
}));

vi.mock('../../shared/api/client', () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly code = 'HTTP_ERROR',
      readonly requestId?: string,
      readonly details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  }
  return {
    ApiError: MockApiError,
    api: apiMocks,
    csrfHeader: () => ({ 'X-CSRF-Token': 'test' }),
    ensureSuccess: (result: { error?: { error?: { message?: string } }; response: Response }) => {
      if (!result.response.ok) throw new Error(result.error?.error?.message ?? `请求失败（HTTP ${result.response.status}）`);
    },
    errorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败',
    newIdempotencyKey: apiMocks.newIdempotencyKey,
    unwrap: <T,>(result: {
      data?: T;
      error?: { error?: { message?: string; code?: string; request_id?: string; details?: Record<string, unknown> } };
      response: Response;
    }) => {
      if (result.data !== undefined) return result.data;
      const detail = result.error?.error;
      throw new MockApiError(
        detail?.message ?? `请求失败（HTTP ${result.response.status}）`,
        detail?.code,
        detail?.request_id,
        detail?.details,
      );
    },
  };
});

const taskId = 'task-1';
const task = {
  id: taskId,
  product_id: 'product-1',
  platform_profile_id: 'platform-1',
  status: 'OPEN',
  available_actions: ['CANCEL', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
  deletion: null,
  fact_version_id: 'fact-version-1',
  query_topic_id: null,
  source_published_content_issue_id: null,
  current_content_version_id: null,
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  revision: 1,
  created_by: 'user-1',
  created_at: '2026-07-01T08:30:00Z',
};
const factVersion = {
  id: task.fact_version_id,
  product_id: task.product_id,
  version: 1,
  status: 'APPROVED',
  body_markdown: '# 产品事实',
  classification: 'PUBLIC',
  change_summary: '批准事实',
  workflow_stage: 'APPROVED',
  primary_task: 'CREATE_CONTENT_TASK',
  deletion: null,
  revision: 1,
  created_by: 'user-1',
  approved_by: 'user-1',
  created_at: task.created_at,
  approved_at: task.created_at,
};

function result(data: unknown, status = 200) {
  return Promise.resolve({ data, response: new Response(null, { status }) });
}

function listTask(index: number, status: 'OPEN' | 'COMPLETED' | 'CANCELLED', overrides: Record<string, unknown> = {}) {
  return {
    ...task,
    id: `task-${index}`,
    status,
    created_at: `2026-07-${String(Math.min(index, 19)).padStart(2, '0')}T08:30:00Z`,
    product: { id: `product-${index}`, brand: 'PartSignal', part_number: `PS-${String(index).padStart(2, '0')}` },
    platform: { id: 'platform-1', name: '工程师社区', website_url: 'https://community.example.invalid', logo: null },
    latest_generation_status: index % 2 ? 'RUNNING' : 'SUCCEEDED',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <>
    <output data-testid="location-pathname">{location.pathname}</output>
    <output data-testid="location-search">{location.search}</output>
    <output data-testid="location-state">{JSON.stringify(location.state)}</output>
  </>;
}

function renderPage(ui: ReactNode, initialEntries: ComponentProps<typeof MemoryRouter>['initialEntries']) {
  return render(<ThemeProvider><AntApp><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider></AntApp></ThemeProvider>);
}

beforeEach(() => {
  queryClient.clear();
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.newIdempotencyKey.mockReturnValue('idempotency-test');
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN')] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result(undefined, 503);
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result(undefined, 503);
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
});

test('批准内容的开始发布动作直接进入对应发布流程', async () => {
  const user = userEvent.setup();
  const approvedVersion = {
    id: 'version-approved', task_id: taskId, fact_version_id: task.fact_version_id,
    source_job_id: null, based_on_id: null, version: 1, source_type: 'HUMAN',
    title: '已批准内容', summary: '摘要', body_markdown: '正文', tags: ['test'],
    content_hash: 'a'.repeat(64), status: 'APPROVED', workflow_stage: 'CURRENT_APPROVED',
    primary_task: 'START_PUBLICATION', available_actions: [], revision: 1, quality_issues: [],
    created_by: 'user-1', created_at: task.created_at,
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result({
      ...task,
      current_content_version_id: approvedVersion.id,
      workflow_stage: 'CURRENT_APPROVED',
      primary_task: 'START_PUBLICATION',
    });
    if (path === '/api/v1/content-tasks') return result({ items: [] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [approvedVersion] });
    if (path.includes('/generation-jobs') || path.includes('/generation-options')) return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(
    <><LocationProbe /><Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /><Route path="/publications" element={<h1>发布管理</h1>} /></Routes></>,
    [`/tasks/${taskId}`],
  );

  const versions = await screen.findByRole('region', { name: '内容版本列表' });
  await user.click(within(versions).getByRole('button', { name: '开始发布' }));

  expect(await screen.findByRole('heading', { name: '发布管理' })).toBeInTheDocument();
  expect(screen.getByTestId('location-pathname')).toHaveTextContent('/publications');
  expect(screen.getByTestId('location-search')).toHaveTextContent(`content_version_id=${approvedVersion.id}`);
  expect(screen.getByTestId('location-search')).toHaveTextContent(`platform_profile_id=${task.platform_profile_id}`);
});

test('次级查询失败不遮蔽任务身份和返回入口', async () => {
  const user = userEvent.setup();
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  expect(await screen.findByRole('heading', { name: 'PartSignal PS-01' })).toBeInTheDocument();
  expect(screen.getByText('fact-version-1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /返回任务列表/ })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('加载失败')).toHaveLength(2), { timeout: 3_000 });
  await user.click(screen.getByRole('button', { name: /生成 AI 草稿/ }));
  expect(await within(screen.getByRole('dialog')).findByText('加载失败')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '内容任务章节' })).toBeInTheDocument();
});

test('AI 生成弹窗确认当前 Prompt 与模型后创建作业', async () => {
  const user = userEvent.setup();
  const options = {
    platform_profile_id: task.platform_profile_id,
    platform_profile_name: '工程师社区',
    platform_prompt: {
      id: 'prompt-1',
      name: '工程师社区 Prompt',
      revision: 2,
      template_markdown: '只使用批准事实。',
    },
    humanization_prompt_configured: true,
    models: [{ id: 'model-1', channel_id: 'channel-1', channel_name: '受控渠道', display_name: '生成模型', model_id: 'model-a' }],
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN')] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(options);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation(() => result({
    id: 'job-generate', content_task_id: taskId, job_type: 'GENERATE',
    source_content_version_id: null, status: 'PENDING', available_actions: [], attempt_count: 0,
    content_version_id: null, created_at: task.created_at,
  }));
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: /生成 AI 草稿/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('textbox', { name: '当前平台 Prompt' })).toHaveValue('只使用批准事实。');
  await user.click(within(dialog).getByRole('combobox', { name: '生成模型' }));
  await user.click(await screen.findByText(/生成模型 \(model-a\)/));
  await user.click(within(dialog).getByRole('button', { name: '生成文稿' }));

  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/generation-jobs',
    expect.objectContaining({
      body: {
        ai_model_id: 'model-1',
        platform_prompt_id: 'prompt-1',
        platform_prompt_revision: 2,
      },
    }),
  ));
});

test('人工首稿标签在提交前校验并保留有效 payload', async () => {
  const user = userEvent.setup();
  const created = {
    id: 'version-manual', task_id: taskId, fact_version_id: task.fact_version_id,
    source_job_id: null, based_on_id: null, version: 1, source_type: 'HUMAN',
    title: '人工首稿', summary: '人工摘要', body_markdown: '# 人工正文', tags: ['人工'],
    content_hash: 'b'.repeat(64), status: 'DRAFT', available_actions: ['CREATE_REVISION', 'SUBMIT_REVIEW'], revision: 0, quality_issues: [],
    created_by: 'user-1', created_at: task.created_at,
  };
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}/manual-versions') return result(created, 201);
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: '录入首个人工草稿' }));
  const dialog = await screen.findByRole('dialog', { name: '录入首个人工草稿' });
  await user.type(within(dialog).getByRole('textbox', { name: '标题' }), '人工首稿');
  await user.type(within(dialog).getByRole('textbox', { name: '摘要' }), '人工摘要');
  await user.type(within(dialog).getByRole('textbox', { name: 'Markdown 正文' }), '# 人工正文');
  await user.type(within(dialog).getByRole('textbox', { name: '变更说明' }), '人工校对');
  const tags = within(dialog).getByRole('combobox', { name: '标签' });
  expect(tags).toHaveAttribute('aria-required', 'true');

  await user.click(within(dialog).getByRole('button', { name: '创建人工首稿' }));
  expect(await within(dialog).findByText(CONTENT_TAG_ERROR)).toBeInTheDocument();
  expect(tags).toHaveAttribute('aria-invalid', 'true');
  const describedBy = tags.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy!)).toHaveTextContent(CONTENT_TAG_ERROR);
  expect(apiMocks.POST).not.toHaveBeenCalled();
  expect(hasValidContentTags(['   '])).toBe(false);

  await user.click(tags);
  await user.type(tags, '临时标签,');
  await waitFor(() => expect(tags).not.toHaveAttribute('aria-invalid', 'true'));
  expect(tags).not.toHaveAttribute('aria-describedby');
  await user.click(tags);
  await user.keyboard('{Backspace}');
  await user.click(within(dialog).getByRole('button', { name: '创建人工首稿' }));
  expect(await within(dialog).findByText(CONTENT_TAG_ERROR)).toBeInTheDocument();
  expect(apiMocks.POST).not.toHaveBeenCalled();

  await user.type(tags, '最终标签,');
  await user.click(within(dialog).getByRole('button', { name: '创建人工首稿' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/manual-versions',
    expect.objectContaining({
      body: {
        title: '人工首稿',
        summary: '人工摘要',
        body_markdown: '# 人工正文',
        tags: ['最终标签'],
        change_summary: '人工校对',
      },
    }),
  ));
});

test('人工首稿把服务端结构化标签错误映射回字段', async () => {
  const user = userEvent.setup();
  apiMocks.POST.mockResolvedValue({
    error: {
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求数据不符合接口契约',
        request_id: 'tag-validation',
        details: { errors: [{ loc: ['body', 'tags'], type: 'too_short' }] },
      },
    },
    response: new Response(null, { status: 422 }),
  });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: '录入首个人工草稿' }));
  const dialog = await screen.findByRole('dialog', { name: '录入首个人工草稿' });
  await user.type(within(dialog).getByRole('textbox', { name: '标题' }), '人工首稿');
  await user.type(within(dialog).getByRole('textbox', { name: '摘要' }), '人工摘要');
  await user.type(within(dialog).getByRole('textbox', { name: 'Markdown 正文' }), '人工正文');
  await user.type(within(dialog).getByRole('textbox', { name: '变更说明' }), '人工校对');
  const tags = within(dialog).getByRole('combobox', { name: '标签' });
  await user.type(tags, '有效标签{Enter}');
  await user.click(within(dialog).getByRole('button', { name: '创建人工首稿' }));

  expect(await within(dialog).findByText(CONTENT_TAG_ERROR)).toBeInTheDocument();
  expect(tags).toHaveAttribute('aria-invalid', 'true');
  const requestError = (await within(dialog).findByText('创建人工首稿失败')).closest('[role="alert"]');
  expect(requestError).toHaveTextContent('请求数据不符合接口契约');
});

test('历史任务说明阻断原因，创建新任务后自动进入 AI 生成弹窗', async () => {
  const user = userEvent.setup();
  const completedTask = { ...task, status: 'COMPLETED', available_actions: [] };
  const newTask = { ...task, id: 'task-2' };
  const options = {
    platform_profile_id: task.platform_profile_id,
    platform_profile_name: '工程师社区',
    platform_prompt: {
      id: 'prompt-1',
      name: '工程师社区 Prompt',
      revision: 2,
      template_markdown: '只使用批准事实。',
    },
    humanization_prompt_configured: true,
    models: [{ id: 'model-1', channel_id: 'channel-1', channel_name: '受控渠道', display_name: '生成模型', model_id: 'model-a' }],
  };
  apiMocks.GET.mockImplementation((path: string, request?: { params?: { path?: Record<string, string> } }) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') {
      return result(request?.params?.path?.content_task_id === newTask.id ? newTask : completedTask);
    }
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'COMPLETED'), { ...listTask(2, 'OPEN'), id: newTask.id }] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(options);
    if (path === '/api/v1/products') {
      return result({ items: [{ id: task.product_id, brand: 'PartSignal', part_number: 'PS-01' }], page: 1, page_size: 100, total: 1 });
    }
    if (path === '/api/v1/platform-profiles') {
      return result({ items: [{ id: task.platform_profile_id, name: '工程师社区', is_active: true }] });
    }
    if (path === '/api/v1/products/{product_id}/fact-versions') return result({ items: [factVersion] });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result(newTask);
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<><LocationProbe /><Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes></>, [`/tasks/${taskId}`]);

  expect(await screen.findByText('当前任务已结束，历史任务保持只读，不能新增 AI 草稿。请创建新任务后继续。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /生成 AI 草稿/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /新建内容任务/ }));
  const createDialog = await screen.findByRole('dialog', { name: '创建内容任务' });
  await user.click(within(createDialog).getByRole('combobox', { name: '产品' }));
  await user.click(await screen.findByText('PartSignal PS-01', { selector: '.ant-select-item-option-content' }));
  await user.click(within(createDialog).getByRole('combobox', { name: '已批准事实版本' }));
  await user.click(await screen.findByText('V1 · PUBLIC · 批准事实'));
  await user.click(within(createDialog).getByRole('combobox', { name: '目标平台' }));
  await user.click(await screen.findByText('工程师社区', { selector: '.ant-select-item-option-content' }));
  await user.click(within(createDialog).getByRole('button', { name: '创建任务' }));

  expect(await screen.findByRole('dialog', { name: '生成 AI 草稿' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'));
  expect(apiMocks.GET).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/generation-options',
    expect.objectContaining({ params: { path: { content_task_id: newTask.id } } }),
  );
});

test('非 PUBLIC 新任务清除自动打开意图但不请求生成选项', async () => {
  const internalFact = { ...factVersion, classification: 'INTERNAL' };
  const internalTask = { ...task, available_actions: ['CANCEL', 'CREATE_MANUAL_VERSION'] };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(internalTask);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN', { available_actions: internalTask.available_actions })] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(internalFact);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [] });
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(
    <><LocationProbe /><Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes></>,
    [{ pathname: `/tasks/${taskId}`, state: { openAiGeneration: true } }],
  );

  expect(await screen.findByText('事实分级为 INTERNAL，不能发送给第三方模型。请创建新任务并选择 PUBLIC 事实版本。')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '生成 AI 草稿' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'));
  expect(apiMocks.GET).not.toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/generation-options',
    expect.anything(),
  );
});

test('创建内容任务只加载产品和平台，不再展示或请求目标问题', async () => {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [] });
    if (path === '/api/v1/products') return result({ items: [], page: 1, page_size: 100, total: 0 });
    if (path === '/api/v1/platform-profiles') return result({ items: [] });
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes>, ['/tasks']);

  expect(await screen.findByText('暂无内容任务')).toBeInTheDocument();
  const createButton = screen.getByRole('button', { name: '新建内容任务' });
  fireEvent.click(createButton);
  expect(createButton).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByText('创建内容任务')).toBeInTheDocument();
  expect(screen.queryByLabelText('目标问题')).not.toBeInTheDocument();
  expect(apiMocks.GET).not.toHaveBeenCalledWith('/api/v1/query-topics');
});

test('创建内容任务失败重试复用请求键，关闭后重新创建使用新键', async () => {
  const user = userEvent.setup();
  const newTask = { ...task, id: 'task-2' };
  apiMocks.newIdempotencyKey
    .mockReturnValueOnce('content-task-request-1')
    .mockReturnValueOnce('content-task-request-2');
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [] });
    if (path === '/api/v1/products') {
      return result({ items: [{ id: task.product_id, brand: 'PartSignal', part_number: 'PS-01' }], page: 1, page_size: 100, total: 1 });
    }
    if (path === '/api/v1/platform-profiles') {
      return result({ items: [{ id: task.platform_profile_id, name: '工程师社区', is_active: true }] });
    }
    if (path === '/api/v1/products/{product_id}/fact-versions') return result({ items: [factVersion] });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST
    .mockResolvedValueOnce({
      error: { error: { code: 'UPSTREAM_UNAVAILABLE', message: '服务暂不可用' } },
      response: new Response(null, { status: 503 }),
    })
    .mockImplementation(() => result(newTask, 201));
  renderPage(<Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes>, ['/tasks']);

  await screen.findByText('暂无内容任务');
  await user.click(screen.getByRole('button', { name: '新建内容任务' }));
  const createDialog = await screen.findByRole('dialog', { name: '创建内容任务' });
  await user.click(within(createDialog).getByRole('combobox', { name: '产品' }));
  await user.click(await screen.findByText('PartSignal PS-01', { selector: '.ant-select-item-option-content' }));
  await user.click(within(createDialog).getByRole('combobox', { name: '已批准事实版本' }));
  await user.click(await screen.findByText('V1 · PUBLIC · 批准事实'));
  await user.click(within(createDialog).getByRole('combobox', { name: '目标平台' }));
  await user.click(await screen.findByText('工程师社区', { selector: '.ant-select-item-option-content' }));
  await user.click(within(createDialog).getByRole('button', { name: '创建任务' }));
  expect(await within(createDialog).findByText('服务暂不可用')).toBeInTheDocument();

  await user.click(within(createDialog).getByRole('button', { name: '创建任务' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建内容任务' })).not.toBeInTheDocument());
  expect(apiMocks.POST).toHaveBeenNthCalledWith(
    1,
    '/api/v1/content-tasks',
    expect.objectContaining({ params: { header: { 'X-CSRF-Token': 'test', 'Idempotency-Key': 'content-task-request-1' } } }),
  );
  expect(apiMocks.POST).toHaveBeenNthCalledWith(
    2,
    '/api/v1/content-tasks',
    expect.objectContaining({ params: { header: { 'X-CSRF-Token': 'test', 'Idempotency-Key': 'content-task-request-1' } } }),
  );

  await user.click(screen.getByRole('button', { name: '新建内容任务' }));
  const reopenedDialog = await screen.findByRole('dialog', { name: '创建内容任务' });
  await user.click(within(reopenedDialog).getByRole('combobox', { name: '产品' }));
  await user.click(await screen.findByText('PartSignal PS-01', { selector: '.ant-select-item-option-content' }));
  await user.click(within(reopenedDialog).getByRole('combobox', { name: '已批准事实版本' }));
  await user.click(await screen.findByText('V1 · PUBLIC · 批准事实'));
  await user.click(within(reopenedDialog).getByRole('combobox', { name: '目标平台' }));
  await user.click(await screen.findByText('工程师社区', { selector: '.ant-select-item-option-content' }));
  await user.click(within(reopenedDialog).getByRole('button', { name: '创建任务' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledTimes(3));
  expect(apiMocks.POST).toHaveBeenNthCalledWith(
    3,
    '/api/v1/content-tasks',
    expect.objectContaining({ params: { header: { 'X-CSRF-Token': 'test', 'Idempotency-Key': 'content-task-request-2' } } }),
  );
});

test('列表用真实任务状态生成摘要，并将客户端筛选写入 URL', async () => {
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [
      listTask(1, 'OPEN'),
      listTask(2, 'COMPLETED'),
      listTask(3, 'CANCELLED', { latest_generation_status: 'FAILED' }),
    ] });
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<><LocationProbe /><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></>, ['/tasks?platform_profile_id=platform-1']);

  expect(await screen.findByLabelText('PartSignal PS-01')).toBeInTheDocument();
  expect(screen.getByText('当前平台：工程师社区')).toBeInTheDocument();
  expect(apiMocks.GET).toHaveBeenCalledWith('/api/v1/content-tasks', { params: { query: { platform_profile_id: 'platform-1' } } });
  expect(screen.getByRole('heading', { name: '内容任务台' })).toBeInTheDocument();
  expect(within(screen.getByText('全部任务').closest('.metric-tile') as HTMLElement).getByText('3')).toBeInTheDocument();
  expect(within(screen.getByText('进行中任务').closest('.metric-tile') as HTMLElement).getByText('1')).toBeInTheDocument();
  expect(screen.getByText('生成中').closest('.status-tag')).toHaveClass('status-tag-info');
  expect(screen.getByText('失败').closest('tr')).toHaveClass('task-row-generation-failed');

  await user.click(screen.getByRole('tab', { name: /已完成 1/ }));
  expect(await screen.findByLabelText('PartSignal PS-02')).toBeInTheDocument();
  expect(screen.queryByLabelText('PartSignal PS-01')).not.toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('status=COMPLETED');

  await user.click(screen.getByRole('button', { name: '重置筛选' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索内容任务' }), '不存在的产品');
  expect(await screen.findByText('没有符合当前筛选条件的任务')).toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('q=');
});

test('列表从 URL 恢复分页，筛选时回到第一页', async () => {
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: Array.from({ length: 11 }, (_, index) => listTask(index + 1, 'OPEN')) });
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<><LocationProbe /><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></>, ['/tasks?page=2']);

  expect(await screen.findByLabelText('PartSignal PS-11')).toBeInTheDocument();
  expect(screen.queryByLabelText('PartSignal PS-01')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: '搜索内容任务' }), 'PS-01');
  expect(await screen.findByLabelText('PartSignal PS-01')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location-search')).not.toHaveTextContent('page='));
});

test('列表加载和失败状态保持可感知且可重试', async () => {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes>, ['/tasks']);

  expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('加载失败');
  const callsBeforeRetry = apiMocks.GET.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(apiMocks.GET.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
});

test('任务列表直接呈现服务端允许的取消和删除操作', async () => {
  const user = userEvent.setup();
  const openTask = listTask(1, 'OPEN', { available_actions: ['CANCEL'] });
  const cancelledTask = listTask(2, 'CANCELLED', { available_actions: ['DELETE'] });
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [openTask, cancelledTask] });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockResolvedValue(result({ ...openTask, status: 'CANCELLED', available_actions: ['DELETE'] }));
  apiMocks.DELETE.mockResolvedValue({ response: new Response(null, { status: 204 }) });
  renderPage(<Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes>, ['/tasks']);

  const openTaskActions = await screen.findByRole('button', { name: '更多操作：PartSignal PS-01' });
  await user.click(openTaskActions);
  await user.click(await screen.findByRole('menuitem', { name: '取消任务' }));
  let cancelDialog = within(await screen.findByRole('dialog'));
  await user.click(cancelDialog.getByRole('button', { name: '暂不取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '取消任务' })).not.toBeInTheDocument());
  expect(apiMocks.POST).not.toHaveBeenCalled();
  await waitFor(() => expect(openTaskActions).toHaveFocus());

  await user.click(openTaskActions);
  await user.click(await screen.findByRole('menuitem', { name: '取消任务' }));
  cancelDialog = within(await screen.findByRole('dialog'));
  await user.type(cancelDialog.getByRole('textbox', { name: '说明' }), '不再继续生产');
  await user.click(cancelDialog.getByRole('button', { name: '确认取消' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/cancel',
    {
      params: { path: { content_task_id: openTask.id }, header: { 'X-CSRF-Token': 'test' } },
      body: { expected_revision: openTask.revision, comment: '不再继续生产' },
    },
  ));

  await user.click(screen.getByRole('button', { name: '更多操作：PartSignal PS-02' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除任务' }));
  const deleteDialog = within(await screen.findByRole('dialog'));
  expect(deleteDialog.getByText(/生成作业、审核记录、草稿和未批准内容/)).toBeInTheDocument();
  expect(deleteDialog.queryByText('物理删除')).not.toBeInTheDocument();
  await user.click(deleteDialog.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(apiMocks.DELETE).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}',
    { params: { path: { content_task_id: cancelledTask.id }, header: { 'X-CSRF-Token': 'test' } } },
  ));
});

test('已取消任务被不可变历史引用时提供精确查看入口', async () => {
  const user = userEvent.setup();
  const blocked = listTask(2, 'CANCELLED', {
    available_actions: [],
    deletion: { blockers: [
      { type: 'PROTECTED_CONTENT_VERSION', count: 1 },
      { type: 'PUBLICATION_WORK', count: 1 },
    ] },
  });
  apiMocks.GET.mockImplementation((path: string) => path === '/api/v1/content-tasks' ? result({ items: [blocked] }) : result(undefined, 404));
  renderPage(<Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes>, ['/tasks']);

  await user.click(await screen.findByRole('button', { name: /更多操作/ }));
  await user.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
  expect(screen.getByText('已批准内容历史：1')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '查看历史' }).map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
    '/tasks/task-2#task-versions',
    '/publications?content_task_id=task-2',
  ]));
});

test('详情取消弹窗的次按钮、关闭图标和 Escape 均不提交并恢复焦点', async () => {
  const user = userEvent.setup();
  const cancellableTask = { ...task, available_actions: ['CANCEL'] };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(cancellableTask);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN', { available_actions: ['CANCEL'] })] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path.includes('/content-versions') || path.includes('/generation-jobs') || path.includes('/generation-options')) return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  const trigger = await screen.findByRole('button', { name: '取消任务' });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '取消任务' })).not.toBeInTheDocument());
  expect(apiMocks.POST).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());

  await user.click(trigger);
  await user.click(within(await screen.findByRole('dialog', { name: '取消任务' })).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '取消任务' })).not.toBeInTheDocument());
  expect(apiMocks.POST).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());

  await user.click(trigger);
  await user.click(within(await screen.findByRole('dialog', { name: '取消任务' })).getByRole('button', { name: '暂不取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '取消任务' })).not.toBeInTheDocument());
  expect(apiMocks.POST).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('仅按服务端 DELETE 动作确认删除并返回任务列表', async () => {
  const user = userEvent.setup();
  const cancelledTask = { ...task, status: 'CANCELLED', available_actions: ['DELETE'] };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(cancelledTask);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'CANCELLED', { available_actions: ['DELETE'] })] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path.includes('/content-versions') || path.includes('/generation-jobs') || path.includes('/generation-options')) return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.DELETE.mockResolvedValue({ response: new Response(null, { status: 204 }) });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /><Route path="/tasks" element={<h1>任务列表</h1>} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: '删除任务' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/生成作业、审核记录、草稿和未批准内容/)).toBeInTheDocument();
  expect(within(dialog).queryByText('物理删除')).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: '确认删除' }));

  await waitFor(() => expect(apiMocks.DELETE).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}',
    { params: { path: { content_task_id: taskId }, header: { 'X-CSRF-Token': 'test' } } },
  ));
  expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
});

test('任务删除失败保留详情并展示服务端错误', async () => {
  const user = userEvent.setup();
  const cancelledTask = { ...task, status: 'CANCELLED', available_actions: ['DELETE'] };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(cancelledTask);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'CANCELLED', { available_actions: ['DELETE'] })] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path.includes('/content-versions') || path.includes('/generation-jobs') || path.includes('/generation-options')) return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.DELETE.mockResolvedValue({
    error: { error: { message: '内容任务仍被生成作业引用' } },
    response: new Response(null, { status: 409 }),
  });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /><Route path="/tasks" element={<h1>任务列表</h1>} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: '删除任务' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认删除' }));

  expect(await screen.findByText('内容任务仍被生成作业引用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '删除任务' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '任务列表' })).not.toBeInTheDocument();
});

test('最新作业追溯只展示身份和参数，不渲染完整系统或用户消息', async () => {
  const job = {
    id: 'job-1',
    content_task_id: taskId,
    job_type: 'GENERATE',
    source_content_version_id: null,
    status: 'SUCCEEDED',
    available_actions: [],
    attempt_count: 1,
    content_version_id: 'version-1',
    retry_of_id: null,
    error_code: null,
    error_summary: null,
    provider_request_id: 'provider-1',
    response_duration_ms: 100,
    prompt_tokens: 20,
    completion_tokens: 30,
    total_tokens: 50,
    created_at: task.created_at,
    started_at: task.created_at,
    finished_at: task.created_at,
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN')] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [job] });
    if (path === '/api/v1/generation-jobs/{generation_job_id}') return result({
      ...job,
      input_snapshot: {
        contract_version: 'content-markdown-v3',
        adapter_name: 'openai-compatible-chat-completions',
        channel: { name: '受控渠道' },
        model: { model_id: 'model-a', request_parameters: { temperature: 0.2 } },
        platform_profile: {},
        platform_prompt: { id: 'prompt-1', name: '工程师社区 Prompt', revision: 1 },
        fact_version: { id: task.fact_version_id, product_id: task.product_id, version: 1, classification: 'PUBLIC' },
        system_message: '不应展示的超长系统消息',
        user_message: '不应展示的超长用户消息',
      },
    });
    throw new Error(`未声明测试请求：${path}`);
  });
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  expect(await screen.findByText('content-markdown-v3')).toBeInTheDocument();
  expect(screen.getByText('受控渠道 / model-a')).toBeInTheDocument();
  expect(screen.queryByText('不应展示的超长系统消息')).not.toBeInTheDocument();
  expect(screen.queryByText('不应展示的超长用户消息')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('系统消息（System Message）')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('用户消息（User Message）')).not.toBeInTheDocument();
});

test('失败作业只按服务端 RETRY 动作显示重试入口', async () => {
  const user = userEvent.setup();
  const blockedJob = {
    id: 'job-blocked', content_task_id: taskId, job_type: 'GENERATE',
    source_content_version_id: null, status: 'FAILED', available_actions: [], attempt_count: 1,
    workflow_stage: 'HISTORICAL_FAILURE', primary_task: 'VIEW_FAILURE',
    content_version_id: null, created_at: task.created_at,
  };
  const retryableJob = {
    ...blockedJob,
    id: 'job-retryable',
    workflow_stage: 'RETRYABLE_FAILURE',
    primary_task: 'HANDLE_FAILURE',
    available_actions: ['RETRY'],
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks') return result({ items: [listTask(1, 'OPEN')] });
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [blockedJob, retryableJob] });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation(() => result({
    ...retryableJob,
    id: 'job-retried',
    status: 'PENDING',
    workflow_stage: 'RUNNING',
    primary_task: 'VIEW_EXECUTION_PROGRESS',
    available_actions: [],
  }));
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  const buttons = await screen.findAllByRole('button', { name: '处理失败' });
  expect(buttons).toHaveLength(1);
  await user.click(buttons[0]!);
  const dialog = await screen.findByRole('dialog', { name: '确认重试原生成快照' });
  await user.click(within(dialog).getByRole('button', { name: '确认重试' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/generation-jobs/{generation_job_id}/retry',
    expect.objectContaining({ params: expect.objectContaining({ path: { generation_job_id: retryableJob.id } }) }),
  ));
});

test('对合格 AI 版本选择模型并创建自然化作业', async () => {
  const user = userEvent.setup();
  const source = {
    id: 'version-1', task_id: taskId, fact_version_id: task.fact_version_id,
    source_job_id: 'job-1', based_on_id: null, version: 1, source_type: 'AI',
    title: '机械表达的文章', summary: '摘要', body_markdown: '正文', tags: ['test'],
    content_hash: 'a'.repeat(64), status: 'DRAFT', available_actions: ['CREATE_HUMANIZATION_JOB'], revision: 0, quality_issues: [],
    created_by: 'user-1', created_at: '2026-07-17T00:00:00Z',
  };
  const options = {
    platform_profile_id: task.platform_profile_id,
    platform_profile_name: '工程师社区',
    platform_prompt: {
      id: 'prompt-1',
      name: '工程师社区 Prompt',
      revision: 2,
      template_markdown: '只使用批准事实。',
    },
    humanization_prompt_configured: true,
    models: [{ id: 'model-1', channel_id: 'channel-1', channel_name: '受控渠道', display_name: '自然化模型', model_id: 'model-a' }],
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [source] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(options);
    if (path === '/api/v1/fact-versions/{fact_version_id}') return result(factVersion);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation(() => result({
    id: 'job-humanize', content_task_id: taskId, job_type: 'HUMANIZE',
    source_content_version_id: source.id, status: 'PENDING', available_actions: [], attempt_count: 0,
    content_version_id: null, retry_of_id: null, error_code: null, error_summary: null,
    provider_request_id: null, response_duration_ms: null, prompt_tokens: null,
    completion_tokens: null, total_tokens: null, created_at: source.created_at,
    started_at: null, finished_at: null,
  }));
  renderPage(<Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes>, [`/tasks/${taskId}`]);

  await user.click(await screen.findByRole('button', { name: '自然化' }));
  await user.click(screen.getByRole('combobox', { name: '自然化模型' }));
  await user.click(await screen.findByText(/自然化模型 \(model-a\)/));
  await user.click(screen.getByRole('button', { name: '创建自然化作业' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-versions/{content_version_id}/humanization-jobs',
    expect.objectContaining({
      params: expect.objectContaining({ path: { content_version_id: source.id } }),
      body: { ai_model_id: 'model-1' },
    }),
  ));
});
