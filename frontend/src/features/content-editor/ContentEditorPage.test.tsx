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
  version: 2,
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

const previousContent = {
  ...content,
  id: '30000000-0000-4000-8000-000000000002',
  version: 1,
  title: '替代方案初稿',
  status: 'SUPERSEDED',
  created_at: '2026-07-09T00:00:00Z',
} satisfies Schema<'ContentVersion'>;

const taskListItem = {
  ...context.task,
  product: { id: context.task.product_id, brand: 'PartSignal', part_number: 'PS-001' },
  platform: {
    id: '25000000-0000-4000-8000-000000000001',
    name: '工程内容平台',
    website_url: null,
    logo: null,
  },
  latest_generation_status: null,
} satisfies Schema<'ContentTaskListItem'>;

function commonPageResponse(path: string) {
  if (path.endsWith('/auth/me')) return { body: { id: content.created_by, username: 'editor', display_name: '编辑', account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: content.created_at } satisfies Schema<'User'> };
  if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
  if (path === '/api/v1/content-tasks') return { body: { items: [taskListItem] } satisfies Schema<'ContentTaskList'> };
  if (path === `/api/v1/content-tasks/${content.task_id}/content-versions`) return { body: { items: [content, previousContent] } satisfies Schema<'ContentVersionList'> };
  return undefined;
}

test('展示冻结审核证据并要求显式批准', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/approve')) return { body: { ...content, status: 'APPROVED', revision: 2 } };
    if (path.endsWith('/review-context')) return { body: context };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  const { container } = render(<App />);
  expect(await screen.findByRole('heading', { name: '替代方案', level: 1 })).toBeInTheDocument();
  const queue = await screen.findByRole('navigation', { name: '同任务内容版本' });
  expect(within(queue).getByRole('link', { current: 'page' })).toHaveAccessibleName(/替代方案.*工程内容平台/);
  expect(within(queue).getByRole('link', { name: /替代方案初稿.*工程内容平台/ })).toHaveAttribute('href', `/content/${previousContent.id}`);
  expect(within(queue).getAllByText('工程内容平台')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: '编辑' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('tab', { name: '预览' }));
  await waitFor(() => expect(container.querySelector('.markdown-preview img')).toBeInTheDocument());
  expect(container.querySelector('.markdown-preview img')).not.toHaveAttribute('onerror');
  expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Markdown 源文' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '版本差异' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '编辑' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '事实证据' }));
  expect(screen.getByText('工作电压')).toBeInTheDocument();
  expect(screen.getByText('公开数据手册')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '审核记录' }));
  expect(screen.getByText('请调整标题')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'AI 追溯' })).not.toBeInTheDocument();
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
    const common = commonPageResponse(path);
    if (common) return common;
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
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/review-context')) return { body: { ...context, content: { ...content, status: 'CHANGES_REQUESTED' } } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('tab', { name: '编辑' }));
  const editor = await screen.findByRole('textbox', { name: 'Markdown 正文' });
  await userEvent.clear(editor);
  await userEvent.type(editor, '## 修订预览\n\n<img src="x" onerror="alert(1)">');
  await userEvent.click(screen.getByRole('tab', { name: '预览修订' }));
  const preview = screen.getByLabelText('人工修订预览');
  await waitFor(() => expect(preview.querySelector('h2')).toHaveTextContent('修订预览'));
  expect(preview.querySelector('img')).not.toHaveAttribute('onerror');
});

test('人工修订聚焦首个错误，并在离开版本前保护未保存 Markdown', async () => {
  const user = userEvent.setup();
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/review-context')) return { body: { ...context, content: { ...content, status: 'CHANGES_REQUESTED' } } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await user.click(await screen.findByRole('tab', { name: '编辑' }));
  const title = screen.getByRole('textbox', { name: '标题' });
  await user.clear(title);
  await user.click(screen.getByRole('button', { name: /创建新版本/ }));
  await waitFor(() => expect(title).toHaveFocus());
  await user.type(title, '保留中的人工修订');

  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);

  await user.click(screen.getByRole('link', { name: /替代方案初稿.*工程内容平台/ }));
  const confirm = (await screen.findByText('放弃未保存的内容修订？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  expect(confirm).not.toBeNull();
  await user.click(within(confirm!).getByRole('button', { name: '继续编辑' }));
  expect(window.location.pathname).toBe(`/content/${content.id}`);
  expect(title).toHaveValue('保留中的人工修订');

  await user.click(screen.getByRole('link', { name: /替代方案初稿.*工程内容平台/ }));
  const discard = (await screen.findByText('放弃未保存的内容修订？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  await user.click(within(discard!).getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(window.location.pathname).toBe(`/content/${previousContent.id}`));
});

test('真实空证据下退回必须填写意见且可以重新提交', async () => {
  let status: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' = 'PENDING_REVIEW';
  let revision = 1;
  let requestChangesCalls = 0;
  let resubmitCalls = 0;
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
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
  await userEvent.click(await screen.findByRole('tab', { name: '事实证据' }));
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

test('按服务端严重级别区分阻断问题和优化建议，并展示真实版本差异', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/review-context')) return {
      body: {
        ...context,
        content: {
          ...content,
          quality_issues: [
            { code: 'FACT_UNKNOWN', severity: 'BLOCKING', message: '存在无法追溯的产品事实' },
            { code: 'PLATFORM_LENGTH', severity: 'WARNING', message: '正文可以进一步精简' },
          ],
        },
        diff: { left_id: content.id, right_id: content.id, lines: [{ kind: 'ADD', old_line: null, new_line: 1, text: '新增正文' }] },
        available_actions: ['REQUEST_CHANGES'],
      } satisfies Schema<'ContentReviewContext'>,
    };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  const totals = await screen.findByLabelText('质量问题统计');
  expect(within(totals).getByText('1', { selector: '.review-count-danger' })).toBeInTheDocument();
  expect(within(totals).getByText('1', { selector: '.review-count-warning' })).toBeInTheDocument();
  expect(screen.getByText('存在无法追溯的产品事实')).toBeInTheDocument();
  expect(screen.getByText('正文可以进一步精简')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /批准内容/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /退回修改/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '版本差异' }));
  expect(screen.getByRole('region', { name: '版本差异' })).toHaveTextContent('+ 新增正文');
});

test('人工修订失败时保留未保存内容并给出就地反馈', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/revisions')) return { status: 500, body: { error: { code: 'REVISION_FAILED', message: '修订保存失败', request_id: 'revision-failure' } } };
    if (path.endsWith('/review-context')) return { body: { ...context, content: { ...content, status: 'CHANGES_REQUESTED' }, available_actions: ['SUBMIT_REVIEW'] } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('tab', { name: '编辑' }));
  const createButton = screen.getByRole('button', { name: /创建新版本/ });
  expect(createButton).toBeDisabled();
  const changeSummary = screen.getByRole('textbox', { name: '变更说明' });
  await userEvent.type(changeSummary, '补充证据边界');
  expect(screen.getByText('有未保存修改')).toBeInTheDocument();
  await userEvent.click(createButton);
  const alert = (await screen.findByText('创建修订失败')).closest<HTMLElement>('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert?.parentElement).toHaveFocus();
  expect(screen.getByText('修订保存失败')).toBeInTheDocument();
  expect(changeSummary).toHaveValue('补充证据边界');
});

test('已批准版本保持只读且不渲染人工修订与审核操作', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/review-context')) return { body: { ...context, content: { ...content, status: 'APPROVED' }, available_actions: [] } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(await screen.findByText('当前状态没有可执行审核操作')).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '编辑' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /批准内容|退回修改|提交审核/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Markdown 源文' }));
  expect(screen.getByRole('textbox', { name: '当前 Markdown 正文' })).toHaveAttribute('readonly');
});

test('所属任务进入终态后未批准版本也不提供人工修订入口', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/review-context')) {
      return {
        body: {
          ...context,
          content: { ...content, status: 'CHANGES_REQUESTED' },
          task: { ...context.task, status: 'COMPLETED', available_actions: [] },
          available_actions: [],
        } satisfies Schema<'ContentReviewContext'>,
      };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(await screen.findByRole('heading', { name: '替代方案', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '编辑' })).not.toBeInTheDocument();
  expect(screen.getByText('已完成', { exact: true })).toBeInTheDocument();
});

test('审核请求失败时保留服务端状态并展示明确错误', async () => {
  window.history.pushState({}, '', `/content/${content.id}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    const common = commonPageResponse(path);
    if (common) return common;
    if (path.endsWith('/request-changes')) return { status: 409, body: { error: { code: 'REVISION_CONFLICT', message: '内容版本已被其他请求修改', request_id: 'review-conflict' } } };
    if (path.endsWith('/review-context')) return { body: { ...context, available_actions: ['REQUEST_CHANGES'] } satisfies Schema<'ContentReviewContext'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: /退回修改/ }));
  await userEvent.type(screen.getByRole('textbox', { name: '审核意见' }), '需要补充事实依据');
  await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));
  expect(await screen.findByText('审核操作失败')).toBeInTheDocument();
  expect(screen.getByText('内容版本已被其他请求修改')).toBeInTheDocument();
  expect(screen.getByText('待审核', { exact: true })).toBeInTheDocument();
});
