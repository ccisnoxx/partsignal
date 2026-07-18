/** 验证内容任务身份与三个次级查询各自拥有错误边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/content-tasks') return result({ items: [] });
    if (path === '/api/v1/products') return result({ items: [], page: 1, page_size: 100, total: 0 });
    if (path === '/api/v1/platform-profiles') return result({ items: [] });
    throw new Error(`未声明测试请求：${path}`);
  });
  render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/tasks']}><Routes><Route path="/tasks" element={<ContentTasksPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);

  await user.click(screen.getByRole('button', { name: /创建任务$/ }));
  expect(await screen.findByRole('dialog', { name: '创建内容任务' })).toBeInTheDocument();
  expect(screen.queryByLabelText('目标问题')).not.toBeInTheDocument();
  expect(apiMocks.GET).not.toHaveBeenCalledWith('/api/v1/query-topics');
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
