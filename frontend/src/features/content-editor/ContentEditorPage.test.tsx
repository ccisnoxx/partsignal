/** 验证内容审核页清理 HTML、展示冻结证据和历史，并要求显式批准。 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const content = {
  id: '30000000-0000-4000-8000-000000000001',
  task_id: '20000000-0000-4000-8000-000000000001',
  fact_version_id: '40000000-0000-4000-8000-000000000001',
  source_job_id: null,
  based_on_id: null,
  version: 1,
  source_type: 'AI',
  title: '替代方案',
  summary: '摘要',
  body_markdown: '# 正文\n<img src="x" onerror="alert(1)">',
  tags: [],
  content_hash: 'abc1234567890',
  status: 'PENDING_REVIEW',
  revision: 1,
  quality_issues: [],
  created_by: '10000000-0000-4000-8000-000000000001',
  created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'ContentVersion'>;

const context = {
  content,
  task: {
    id: content.task_id,
    query_topic_id: '21000000-0000-4000-8000-000000000001',
    product_id: '22000000-0000-4000-8000-000000000001',
    fact_version_id: content.fact_version_id,
    platform_profile_version_id: '23000000-0000-4000-8000-000000000001',
    platform_type_id: '24000000-0000-4000-8000-000000000001',
    platform_type_snapshot: { name: '技术社区' },
    user_prompt_markdown: '仅使用批准事实',
    generation_data_classification: 'PUBLIC',
    generation_data_classified_by: content.created_by,
    generation_data_classified_at: content.created_at,
    source_publication_attention_id: null,
    available_actions: [],
    target_audience: '硬件工程师',
    content_angle: '替代说明',
    conversion_goal: '查看数据手册',
    desired_format: 'MARKDOWN',
    desired_length_min: 100,
    desired_length_max: 1000,
    canonical_url: 'https://product.example.invalid/demo',
    status: 'OPEN',
    revision: 0,
    created_by: content.created_by,
    created_at: content.created_at,
  },
  fact_version: {
    id: content.fact_version_id,
    product_id: '22000000-0000-4000-8000-000000000001',
    version: 1,
    status: 'APPROVED',
    snapshot: {
      reference_parts: [],
      parameters: [{ client_key: 'voltage', owner_key: 'product', key: 'voltage', name: '工作电压', value_type: 'NUMERIC', min_value: null, typical_value: 3.3, max_value: null, text_value: null, unit: 'V', test_conditions: '25 摄氏度', is_critical: true, evidence_keys: ['datasheet'] }],
      replacement_relations: [],
      evidences: [{ client_key: 'datasheet', type: 'DATASHEET', title: '公开数据手册', version: '1.0', source_url: 'https://docs.example.invalid/demo.pdf', file_id: null, confidentiality: 'PUBLIC' }],
      claims: [],
    },
    change_summary: '批准事实',
    revision: 2,
    created_by: content.created_by,
    approved_by: content.created_by,
    created_at: content.created_at,
    approved_at: content.created_at,
  },
  evidence_statuses: [{ client_key: 'datasheet', file_id: null, file_status: null }],
  diff: null,
  generation_trace: null,
  humanization_traces: [],
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  review_history: [{ id: '60000000-0000-4000-8000-000000000001', target_id: content.id, target_version: 1, action: 'request-changes', comment: '请调整标题', actor: { id: content.created_by, username: 'editor', display_name: '内容编辑' }, created_at: content.created_at }],
} satisfies Schema<'ContentReviewContext'>;

test('展示冻结审核证据并要求显式批准', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: content.created_at } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/approve')) return { body: { ...content, status: 'APPROVED', revision: 2 } };
    if (path.endsWith('/review-context')) return { body: context };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  const { container } = render(<App />);
  expect(await screen.findByRole('heading', { name: '替代方案' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.markdown-preview img')).toBeInTheDocument());
  expect(container.querySelector('.markdown-preview img')).not.toHaveAttribute('onerror');
  expect(screen.getByText('请调整标题')).toBeInTheDocument();
  expect(screen.getByText('工作电压')).toBeInTheDocument();
  expect(screen.getByText('公开数据手册')).toBeInTheDocument();
  const navigation = screen.getByRole('navigation', { name: '内容审核章节' });
  for (const [name, target] of [['正文与预览', 'review-content'], ['版本差异', 'review-diff'], ['锁定事实', 'review-facts'], ['审核历史', 'review-history'], ['人工修订', 'review-revision']] as const) {
    expect(within(navigation).getByRole('link', { name })).toHaveAttribute('href', `#${target}`);
    expect(document.getElementById(target)).toBeInTheDocument();
  }
  expect(within(navigation).queryByRole('link', { name: '生成追溯' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /批准内容/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /批准内容/ }));
  expect(await screen.findByText('请显式确认批准')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认批准' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('审核上下文失败时不渲染状态操作', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: content.created_at } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/review-context')) return { status: 500, body: { error: { code: 'REVIEW_CONTEXT_INCOMPLETE', message: '审核上下文不完整', request_id: 'review-failure' } } };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(await screen.findByText('加载失败', {}, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /批准内容/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /退回修改/ })).not.toBeInTheDocument();
});

test('人工修订输入后异步更新安全 Markdown 预览', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: content.created_at } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/review-context')) return { body: { ...context, content: { ...content, status: 'CHANGES_REQUESTED' } } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  const { container } = render(<App />);
  const editor = await screen.findByRole('textbox', { name: 'Markdown 正文' });
  await userEvent.clear(editor);
  await userEvent.type(editor, '## 修订预览\n\n<img src="x" onerror="alert(1)">');
  await waitFor(() => expect(container.querySelector('.markdown-preview.compact h2')).toHaveTextContent('修订预览'));
  expect(container.querySelector('.markdown-preview.compact img')).not.toHaveAttribute('onerror');
});

test('真实空证据下退回必须填写意见且可以重新提交', async () => {
  let status: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' = 'PENDING_REVIEW';
  let revision = 1;
  let requestChangesCalls = 0;
  let resubmitCalls = 0;
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: content.created_at } satisfies Schema<'User'> };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/request-changes')) {
      requestChangesCalls += 1;
      status = 'CHANGES_REQUESTED';
      revision += 1;
      return { body: { ...content, status, revision } };
    }
    if (path.endsWith('/submit-review')) {
      resubmitCalls += 1;
      status = 'PENDING_REVIEW';
      revision += 1;
      return { body: { ...content, status, revision } };
    }
    if (path.endsWith('/review-context')) {
      return {
        body: {
          ...context,
          content: { ...content, status, revision },
          fact_version: {
            ...context.fact_version,
            snapshot: { ...context.fact_version.snapshot, evidences: [] },
          },
          evidence_statuses: [],
          available_actions: status === 'PENDING_REVIEW' ? ['REQUEST_CHANGES'] : ['SUBMIT_REVIEW'],
        } satisfies Schema<'ContentReviewContext'>,
      };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(await screen.findByText('锁定事实没有证据')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /退回修改/ }));
  await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));
  expect(await screen.findByText('退回必须填写意见')).toBeInTheDocument();
  expect(requestChangesCalls).toBe(0);
  await userEvent.type(screen.getByRole('textbox', { name: '审核意见' }), '补充证据说明');
  await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));
  expect(await screen.findByRole('button', { name: /提交审核/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /提交审核/ }));
  await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));
  await waitFor(() => expect(resubmitCalls).toBe(1));
  expect(await screen.findByRole('button', { name: /退回修改/ })).toBeInTheDocument();
});
