/** 验证发布页只消费匹配账号、服务端动作和显式异常解决命令。 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'editor',
  display_name: '编辑',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  revision: 1,
  created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'User'>;

const content = {
  id: '30000000-0000-4000-8000-000000000001',
  task_id: '20000000-0000-4000-8000-000000000001',
  fact_version_id: '40000000-0000-4000-8000-000000000001',
  source_job_id: null,
  based_on_id: null,
  version: 1,
  source_type: 'HUMAN',
  title: '发布候选',
  summary: '摘要',
  body_markdown: '正文',
  tags: [],
  content_hash: 'a'.repeat(64),
  status: 'APPROVED',
  revision: 1,
  quality_issues: [],
  created_by: user.id,
  created_at: user.created_at,
} satisfies Schema<'ContentVersion'>;

const candidate = {
  content_version: content,
  task_id: content.task_id,
  platform_profile_id: '50000000-0000-4000-8000-000000000001',
  platform_profile_name: '工程师社区',
  platform_profile_version_id: '51000000-0000-4000-8000-000000000001',
  platform_profile_version: 2,
  matching_accounts: [{
    id: '52000000-0000-4000-8000-000000000001',
    platform_profile_id: '50000000-0000-4000-8000-000000000001',
    label: '匹配账号',
    account_identifier: 'matched',
    is_active: true,
  }],
} satisfies Schema<'PublicationCandidate'>;

test('发布候选只展示服务端匹配账号', async () => {
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/publication-candidates')) return { body: { items: [candidate] } };
    if (path.endsWith('/publication-records')) return { body: { items: [], page: 1, page_size: 100, total: 0 } };
    if (path.endsWith('/publication-attentions')) return { body: { items: [] } };
    if (path.endsWith('/publication-package')) return { body: { content_version_id: content.id, fact_version_id: content.fact_version_id, title: content.title, body_markdown: content.body_markdown, body_html: '<p>正文</p>', body_text: '正文', tags: [], canonical_url: 'https://product.example.invalid/demo', content_hash: content.content_hash } satisfies Schema<'PublicationPackage'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '准备人工发布' }));
  await userEvent.click(screen.getByRole('combobox', { name: '匹配平台账号' }));
  expect(await screen.findByText('匹配账号 / matched')).toBeInTheDocument();
  expect(screen.queryByText(/跨平台账号/)).not.toBeInTheDocument();
});

test('异常待办只能填写非空说明后显式解决', async () => {
  const attentionId = '60000000-0000-4000-8000-000000000001';
  let resolveCalls = 0;
  window.history.pushState({}, '', `/publication-attentions/${attentionId}`);
  const attention = {
    id: attentionId,
    publication_record_id: '61000000-0000-4000-8000-000000000001',
    original_task_id: content.task_id,
    trigger_status: 'REMOVED',
    status: 'OPEN',
    revision: 0,
    opened_at: user.created_at,
    resolved_at: null,
    resolved_by: null,
    resolution_comment: null,
    repair_task_id: null,
    available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'],
  } satisfies Schema<'PublicationAttention'>;
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/resolve')) {
      resolveCalls += 1;
      return { body: { ...attention, status: 'RESOLVED', revision: 1, resolved_at: user.created_at, resolved_by: user.id, resolution_comment: '已人工处置', available_actions: [] } };
    }
    if (path.endsWith(attentionId)) return { body: attention };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '显式解决' }));
  await userEvent.click(screen.getByRole('button', { name: '确认解决' }));
  expect(await screen.findByText('必须填写处置说明')).toBeInTheDocument();
  expect(resolveCalls).toBe(0);
  await userEvent.type(screen.getByRole('textbox', { name: '处置说明' }), '已人工处置');
  await userEvent.click(screen.getByRole('button', { name: '确认解决' }));
  await waitFor(() => expect(resolveCalls).toBe(1));
});

test('发布工作台从 URL 恢复页签和独立分页', async () => {
  const records = Array.from({ length: 11 }, (_, index) => ({
    id: `record-${index + 1}`,
    content_version_id: `content-${index + 1}`,
    status: 'PENDING_MANUAL',
    final_url: null,
    created_at: user.created_at,
  }));
  window.history.pushState({}, '', '/publications?tab=records&records_page=2');
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/publication-candidates')) return { body: { items: [] } };
    if (path.endsWith('/publication-records')) return { body: { items: records, page: 1, page_size: 100, total: records.length } };
    if (path.endsWith('/publication-attentions')) return { body: { items: [] } };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });

  render(<App />);
  const recordsTab = await screen.findByRole('tab', { name: '发布记录' });
  expect(recordsTab).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('content-11')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '待发布候选' }));
  await waitFor(() => expect(window.location.search).toContain('tab=candidates'));
  expect(window.location.search).toContain('records_page=2');
});
