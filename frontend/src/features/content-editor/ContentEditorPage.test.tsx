/** 验证 Markdown 预览清理危险属性，并允许创建者显式批准。 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const content = {
  id: '30000000-0000-4000-8000-000000000001', task_id: '20000000-0000-4000-8000-000000000001', fact_version_id: '40000000-0000-4000-8000-000000000001', source_job_id: '50000000-0000-4000-8000-000000000001', based_on_id: null, version: 1,
  source_type: 'AI', title: '替代方案', summary: '摘要', body_markdown: '# 正文\n<img src="x" onerror="alert(1)">', tags: [], content_hash: 'abc1234567890', status: 'PENDING_REVIEW', revision: 1, quality_issues: [], created_by: '10000000-0000-4000-8000-000000000001', created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'ContentVersion'>;

test('清理危险 HTML 并允许创建者批准', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: '2026-07-10T00:00:00Z' } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/approve')) return { body: { ...content, status: 'APPROVED', revision: 2 } };
    if (path.includes('/generation-jobs/')) return { body: { id: content.source_job_id, content_task_id: content.task_id, status: 'SUCCEEDED', attempt_count: 1, content_version_id: content.id, retry_of_id: null, error_code: null, error_summary: null, provider_request_id: 'req-test', response_duration_ms: 10, prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, created_at: content.created_at, started_at: content.created_at, finished_at: content.created_at, input_snapshot: { adapter_name: 'openai-compatible-chat-completions', contract_version: 'chat-json-v1', channel: { name: '测试渠道' }, model: { model_id: 'test-model', request_parameters: { temperature: 0 } }, platform_type: { name: '论坛' }, system_message: '严格 system message', user_prompt_markdown: '工程师输入', approved_facts: { fact_version_id: content.fact_version_id }, task_requirements: {}, user_message: '完整 user message' } } };
    if (path.includes('/content-tasks/')) return { body: { items: [content] } };
    if (path.includes('/content-versions/')) return { body: content };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  const { container } = render(<App />);
  expect(await screen.findByRole('heading', { name: '替代方案' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.markdown-preview img')).toBeInTheDocument());
  expect(container.querySelector('.markdown-preview img')).not.toHaveAttribute('onerror');
  await userEvent.click(screen.getByRole('tab', { name: '事实追溯' }));
  expect(await screen.findByDisplayValue('严格 system message')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /批准/ }));
  await userEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
