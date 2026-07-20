/** 验证内容任务身份与三个次级查询各自拥有错误边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { ContentTasksPage } from './ContentTasksPage';

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), PATCH: vi.fn(), POST: vi.fn() }));

vi.mock('../../shared/api/client', () => ({
  ApiError: class ApiError extends Error {},
  api: apiMocks,
  csrfHeader: () => ({ 'X-CSRF-Token': 'test' }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  newIdempotencyKey: () => 'idempotency-test',
  unwrap: <T,>(result: { data?: T; response: Response }) => {
    if (result.data !== undefined) return result.data;
    throw new Error(`请求失败（HTTP ${result.response.status}）`);
  },
}));

const taskId = 'task-1';
const task = {
  id: taskId,
  content_angle: '高可靠替代选型',
  target_audience: '硬件工程师',
  desired_format: '参数对比',
  status: 'OPEN',
  available_actions: [],
  fact_version_id: 'fact-version-1',
  platform_profile_version_id: 'platform-version-1',
  platform_type_snapshot: { name: '技术社区' },
  conversion_goal: '阅读数据手册',
  canonical_url: 'https://example.invalid/product',
  user_prompt_markdown: '只使用已批准事实。',
  generation_data_classification: 'PUBLIC',
  revision: 1,
};

function result(data: unknown, status = 200) {
  return Promise.resolve({ data, response: new Response(null, { status }) });
}

function listTask(index: number, status: 'OPEN' | 'COMPLETED' | 'CANCELLED', overrides: Record<string, unknown> = {}) {
  return {
    ...task,
    id: `task-${index}`,
    content_angle: `内容主题 ${String(index).padStart(2, '0')}`,
    target_audience: index % 2 ? '硬件工程师' : '采购团队',
    desired_format: index % 2 ? '参数对比' : '选型指南',
    desired_length_min: 800,
    desired_length_max: 1200,
    status,
    conversion_goal: '查看产品资料',
    created_at: `2026-07-${String(Math.min(index, 19)).padStart(2, '0')}T08:30:00Z`,
    product: { id: `product-${index}`, brand: 'PartSignal', part_number: `PS-${String(index).padStart(2, '0')}` },
    platform: { id: 'platform-1', name: '工程师社区', website_url: 'https://community.example.invalid', logo: null },
    latest_generation_status: index % 2 ? 'RUNNING' : 'SUCCEEDED',
    ...overrides,
  };
}

function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

beforeEach(() => {
  queryClient.clear();
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result(undefined, 503);
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result(undefined, 503);
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
});

test('次级查询失败不遮蔽任务身份、约束和返回入口', async () => {
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/tasks/${taskId}`]}><Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  expect(await screen.findByRole('heading', { name: '高可靠替代选型' })).toBeInTheDocument();
  expect(screen.getByText('fact-version-1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /返回任务列表/ })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3), { timeout: 3_000 });
  expect(screen.getByRole('navigation', { name: '内容任务章节' })).toBeInTheDocument();
});

test('创建内容任务只加载产品和平台，不再展示或请求目标问题', async () => {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [] });
    if (path === '/api/v1/products') return result({ items: [], page: 1, page_size: 100, total: 0 });
    if (path === '/api/v1/platform-profiles') return result({ items: [] });
    throw new Error(`未声明测试请求：${path}`);
  });
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/tasks']}><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  expect(await screen.findByText('暂无内容任务')).toBeInTheDocument();
  const createButton = screen.getByRole('button', { name: '新建内容任务' });
  fireEvent.click(createButton);
  expect(createButton).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByText('创建内容任务')).toBeInTheDocument();
  expect(screen.queryByLabelText('目标问题')).not.toBeInTheDocument();
  expect(apiMocks.GET).not.toHaveBeenCalledWith('/api/v1/query-topics');
});

test('列表用真实任务状态生成摘要，并将客户端筛选写入 URL', async () => {
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [
      listTask(1, 'OPEN'),
      listTask(2, 'COMPLETED'),
      listTask(3, 'CANCELLED', { content_angle: '停用产品迁移说明', latest_generation_status: 'FAILED' }),
    ] });
    throw new Error(`未声明测试请求：${path}`);
  });
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/tasks']}><LocationProbe /><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  expect(await screen.findByTitle('PartSignal PS-01')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '内容任务台' })).toBeInTheDocument();
  expect(within(screen.getByText('全部任务').closest('.metric-tile') as HTMLElement).getByText('3')).toBeInTheDocument();
  expect(within(screen.getByText('进行中任务').closest('.metric-tile') as HTMLElement).getByText('1')).toBeInTheDocument();
  expect(screen.getByText('生成中').closest('.status-tag')).toHaveClass('status-tag-info');
  expect(screen.getByText('失败').closest('tr')).toHaveClass('task-row-generation-failed');

  await user.click(screen.getByRole('tab', { name: /已完成 1/ }));
  expect(await screen.findByTitle('PartSignal PS-02')).toBeInTheDocument();
  expect(screen.queryByTitle('PartSignal PS-01')).not.toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('status=COMPLETED');

  await user.click(screen.getByRole('button', { name: '重置筛选' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索内容任务' }), '不存在的主题');
  expect(await screen.findByText('没有符合当前筛选条件的任务')).toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('q=');
});

test('列表从 URL 恢复分页，筛选时回到第一页', async () => {
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: Array.from({ length: 11 }, (_, index) => listTask(index + 1, 'OPEN')) });
    throw new Error(`未声明测试请求：${path}`);
  });
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/tasks?page=2']}><LocationProbe /><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  expect(await screen.findByTitle('PartSignal PS-11')).toBeInTheDocument();
  expect(screen.queryByTitle('PartSignal PS-01')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: '搜索内容任务' }), '内容主题 01');
  expect(await screen.findByTitle('PartSignal PS-01')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location-search')).not.toHaveTextContent('page='));
});

test('列表加载和失败状态保持可感知且可重试', async () => {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result(undefined, 503);
    throw new Error(`未声明测试请求：${path}`);
  });
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/tasks']}><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('加载失败');
  const callsBeforeRetry = apiMocks.GET.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(apiMocks.GET.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
});

test('对合格 AI 版本选择模型并创建自然化作业', async () => {
  const user = userEvent.setup();
  const source = {
    id: 'version-1', task_id: taskId, fact_version_id: task.fact_version_id,
    source_job_id: 'job-1', based_on_id: null, version: 1, source_type: 'AI',
    title: '机械表达的文章', summary: '摘要', body_markdown: '正文', tags: ['test'],
    content_hash: 'a'.repeat(64), status: 'DRAFT', revision: 0, quality_issues: [],
    created_by: 'user-1', created_at: '2026-07-17T00:00:00Z',
  };
  const options = {
    platform_profile_version_id: task.platform_profile_version_id,
    platform_profile_name: '工程师社区', platform_type_id: 'type-1',
    platform_type_name: '技术社区', platform_type_slug: 'technical-community',
    system_prompt_markdown: '只使用批准事实。', humanization_prompt_configured: true,
    models: [{ id: 'model-1', channel_id: 'channel-1', channel_name: '受控渠道', display_name: '自然化模型', model_id: 'model-a' }],
  };
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks/{content_task_id}') return result(task);
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [source] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: [] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result(options);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation(() => result({
    id: 'job-humanize', content_task_id: taskId, job_type: 'HUMANIZE',
    source_content_version_id: source.id, status: 'PENDING', attempt_count: 0,
    content_version_id: null, retry_of_id: null, error_code: null, error_summary: null,
    provider_request_id: null, response_duration_ms: null, prompt_tokens: null,
    completion_tokens: null, total_tokens: null, created_at: source.created_at,
    started_at: null, finished_at: null,
  }));
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/tasks/${taskId}`]}><Routes><Route path="/tasks/:taskId" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

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
