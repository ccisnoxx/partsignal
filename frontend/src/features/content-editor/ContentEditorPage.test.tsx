/** 验证 Markdown 预览清理危险属性，并如实展示服务端自审拒绝。 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const content = {
  id: '30000000-0000-4000-8000-000000000001', task_id: '20000000-0000-4000-8000-000000000001', fact_version_id: '40000000-0000-4000-8000-000000000001', version: 1,
  source_type: 'AI', title: '替代方案', summary: '摘要', body_markdown: '# 正文\n<img src="x" onerror="alert(1)">', tags: [], used_fact_ids: [], used_evidence_ids: [], content_hash: 'abc1234567890', status: 'PENDING_REVIEW', revision: 1, quality_issues: [], created_by: '10000000-0000-4000-8000-000000000001', created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'ContentVersion'>;

test('清理危险 HTML 并显示禁止自审错误', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', roles: ['CONTENT_EDITOR', 'CONTENT_REVIEWER'], is_active: true, revision: 1, created_at: '2026-07-10T00:00:00Z' } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/approve')) return { status: 403, body: { error: { code: 'SELF_REVIEW_FORBIDDEN', message: '创建者不能审核自己的内容版本', request_id: 'req-review' } } };
    if (path.includes('/content-tasks/')) return { body: { items: [content] } };
    if (path.includes('/content-versions/')) return { body: content };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  const { container } = render(<App />);
  expect(await screen.findByRole('heading', { name: '替代方案' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.markdown-preview img')).toBeInTheDocument());
  expect(container.querySelector('.markdown-preview img')).not.toHaveAttribute('onerror');
  await userEvent.click(screen.getByRole('button', { name: /批准/ }));
  await userEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));
  expect(await screen.findByText('创建者不能审核自己的内容版本')).toBeInTheDocument();
});
