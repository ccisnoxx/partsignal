/** 验证内容任务身份与三个次级查询各自拥有错误边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
