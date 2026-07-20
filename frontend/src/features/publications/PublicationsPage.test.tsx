/** 发布管理测试覆盖真实聚合、URL 状态、按需抽屉和服务端动作契约。 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const testEvidenceId = '70000000-0000-4000-8000-000000000001';

vi.mock('../../shared/components/DirectUpload', () => ({
  DirectUpload: ({ onUploaded }: { onUploaded: (file: Schema<'FileRecord'>) => void }) => (
    <button
      type="button"
      onClick={() => onUploaded({
        id: '70000000-0000-4000-8000-000000000001',
        category: 'OPERATION_SCREENSHOT',
        original_filename: 'published.png',
        object_key: 'test/published.png',
        content_type: 'image/png',
        size: 3,
        sha256: 'b'.repeat(64),
        access_level: 'INTERNAL',
        status: 'VERIFIED',
        created_at: '2026-07-10T00:00:00Z',
        verified_at: '2026-07-10T00:00:00Z',
      })}
    >
      选择测试证据
    </button>
  ),
}));

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

const publicationId = '61000000-0000-4000-8000-000000000001';
const recordItem = {
  id: publicationId,
  task_id: content.task_id,
  content_version_id: content.id,
  content_title: content.title,
  content_version: content.version,
  platform_profile_id: candidate.platform_profile_id,
  platform_profile_name: candidate.platform_profile_name,
  platform_account_id: candidate.matching_accounts[0]!.id,
  platform_account_label: candidate.matching_accounts[0]!.label,
  account_identifier: candidate.matching_accounts[0]!.account_identifier,
  status: 'PLATFORM_REVIEW',
  actual_title: null,
  final_url: null,
  published_at: null,
  created_at: user.created_at,
  last_verification_at: null,
  available_actions: ['mark-published', 'reject'],
} satisfies Schema<'PublicationRecordListItem'>;

const recordDetail = {
  id: publicationId,
  content_version_id: content.id,
  task_id: content.task_id,
  content_title: content.title,
  content_version: content.version,
  platform_profile_id: candidate.platform_profile_id,
  platform_profile_name: candidate.platform_profile_name,
  platform_account_id: candidate.matching_accounts[0]!.id,
  platform_account_label: candidate.matching_accounts[0]!.label,
  account_identifier: candidate.matching_accounts[0]!.account_identifier,
  section_url: 'https://community.example.invalid/section',
  actual_title: null,
  final_url: null,
  published_at: null,
  status: 'PLATFORM_REVIEW',
  content_hash: content.content_hash,
  created_by: user.id,
  created_at: user.created_at,
  status_events: [{ status: 'PLATFORM_REVIEW', comment: '平台处理', actor_id: user.id, created_at: user.created_at }],
  attachments: [],
  available_actions: ['mark-published', 'reject'],
} satisfies Schema<'PublicationRecord'>;

const summary = {
  as_of: '2026-07-20T08:00:00Z',
  window_start: '2026-07-13T08:00:00Z',
  window_days: 7,
  current_status_counts: {
    PENDING_MANUAL_PUBLISH: 1,
    PLATFORM_REVIEW: 1,
    PUBLISHED: 2,
    VERIFIED: 3,
    REJECTED: 1,
    REMOVED: 1,
    VERIFICATION_FAILED: 1,
  },
  open_attention_count: 2,
  period: {
    registered_published_count: 4,
    verified_count: 3,
    verification_rate: 0.75,
    new_exception_count: 2,
    current_unresolved_attention_count: 2,
  },
  exception_counts: { rejected: 1, removed_open: 1, verification_failed_open: 1 },
  recent_activity: [],
} satisfies Schema<'PublicationWorkbenchSummary'>;

function commonWorkspaceResponse(request: Request, overrides: {
  candidates?: Schema<'PublicationCandidate'>[];
  records?: Schema<'PublicationRecordListItem'>[];
  total?: number;
} = {}) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/auth/me')) return { body: user };
  if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
  if (url.pathname.endsWith('/publication-candidates')) return { body: { items: overrides.candidates ?? [] } };
  if (url.pathname.endsWith('/publication-records')) return { body: { items: overrides.records ?? [], page: Number(url.searchParams.get('page') ?? 1), page_size: 10, total: overrides.total ?? 0 } };
  if (url.pathname.endsWith('/publication-attentions')) return { body: { items: [] } };
  if (url.pathname.endsWith('/publication-workbench-summary')) {
    const days = Number(url.searchParams.get('window_days') ?? 7) as 7 | 30;
    return { body: { ...summary, window_days: days } };
  }
  return undefined;
}

test('候选登记抽屉只展示匹配账号并在放弃未提交内容前确认', async () => {
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { candidates: [candidate] });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith('/publication-package')) return { body: { content_version_id: content.id, fact_version_id: content.fact_version_id, title: content.title, body_markdown: content.body_markdown, body_html: '<p>正文</p>', body_text: '正文', tags: [], canonical_url: 'https://product.example.invalid/demo', content_hash: content.content_hash } satisfies Schema<'PublicationPackage'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '准备人工发布' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: '发布账号' }));
  await userEvent.click(await screen.findByText('匹配账号 / matched'));
  expect(screen.queryByText(/跨平台账号/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect((await screen.findAllByText('放弃未提交内容？')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByText('此步骤只创建待人工发布记录')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  await userEvent.click(await screen.findByRole('button', { name: '放弃并关闭' }));
  await waitFor(() => expect(window.location.search).not.toContain('candidate='));
});

test('候选发布包加载失败时展示真实错误并阻止登记', async () => {
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { candidates: [candidate] });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith('/publication-package')) {
      return { status: 500, body: { error: { code: 'PUBLICATION_PACKAGE_FAILED', message: '发布包加载失败', request_id: 'package-failed' } } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '准备人工发布' }));
  expect(await screen.findByText('发布包加载失败')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '复制标题' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登记待人工发布' })).toBeDisabled();
});

test('候选没有匹配账号时提供业务设置恢复入口', async () => {
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, {
      candidates: [{ ...candidate, matching_accounts: [] }],
    });
    if (common) return common;
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);
  expect(await screen.findByText('无匹配账号')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往业务设置' })).toHaveAttribute('href', '/settings');
  expect(screen.getByRole('button', { name: '准备人工发布' })).toBeDisabled();
});

test('异常待办只能填写非空说明后显式解决', async () => {
  const attentionId = '60000000-0000-4000-8000-000000000001';
  let resolveCalls = 0;
  window.history.pushState({}, '', `/publication-attentions/${attentionId}`);
  const attention = {
    id: attentionId,
    publication_record_id: publicationId,
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

test('发布记录分页与状态筛选由 URL 和服务端列表共同恢复', async () => {
  let recordsQuery = '';
  window.history.pushState({}, '', '/publications?tab=records&records_page=2&record_status=PLATFORM_REVIEW');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { records: [{ ...recordItem, actual_title: '实际平台标题' }], total: 11 });
    if (new URL(request.url).pathname.endsWith('/publication-records')) recordsQuery = new URL(request.url).search;
    if (common) return common;
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);
  const recordsTab = await screen.findByRole('tab', { name: /发布记录/ });
  expect(recordsTab).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText(content.title)).toBeInTheDocument();
  expect(screen.getByText('实际平台标题')).toBeInTheDocument();
  expect(recordsQuery).toContain('page=2');
  expect(recordsQuery).toContain('status=PLATFORM_REVIEW');
  await userEvent.click(screen.getByRole('tab', { name: /待发布候选/ }));
  await waitFor(() => expect(window.location.search).toContain('tab=candidates'));
  expect(window.location.search).toContain('records_page=2');
});

test('发布数据概览默认近 7 天并只允许切换到近 30 天', async () => {
  const requestedWindows: string[] = [];
  window.history.pushState({}, '', '/publications?window_days=90');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/publication-workbench-summary')) requestedWindows.push(url.searchParams.get('window_days') ?? '');
    const common = commonWorkspaceResponse(request);
    if (common) return common;
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);
  expect(await screen.findByText('75%')).toBeInTheDocument();
  expect(requestedWindows).toContain('7');
  await waitFor(() => expect(window.location.search).not.toContain('window_days=90'));
  await userEvent.click(screen.getByText('近 30 天'));
  await waitFor(() => expect(requestedWindows).toContain('30'));
  expect(window.location.search).toContain('window_days=30');
  expect(screen.getAllByRole('radio')).toHaveLength(2);
});

test('登记失败保留输入与未绑定证据，重试成功仍携带结果证据 ID', async () => {
  const file = {
    id: testEvidenceId,
    category: 'OPERATION_SCREENSHOT',
    original_filename: 'published.png',
    object_key: 'test/published.png',
    content_type: 'image/png',
    size: 3,
    sha256: 'b'.repeat(64),
    access_level: 'INTERNAL',
    status: 'VERIFIED',
    created_at: user.created_at,
    verified_at: user.created_at,
  } satisfies Schema<'FileRecord'>;
  const detail = recordDetail;
  window.history.pushState({}, '', `/publications?tab=records&record=${publicationId}`);
  let commandAttempts = 0;
  const fetchSpy = mockFetch((request) => {
    const url = new URL(request.url);
    const common = commonWorkspaceResponse(request, { records: [recordItem], total: 1 });
    if (common) return common;
    if (url.pathname.endsWith(`/publication-records/${publicationId}`) && request.method === 'GET') {
      return { body: commandAttempts > 1 ? { ...detail, actual_title: content.title, final_url: 'https://community.example.invalid/post/1', published_at: '2026-07-20T10:00:00+08:00', status: 'PUBLISHED', attachments: [file], available_actions: ['verify', 'remove', 'mark-verification-failed'] } : detail };
    }
    if (url.pathname.endsWith(`/publication-records/${publicationId}/mark-published`)) {
      commandAttempts += 1;
      if (commandAttempts === 1) return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: '最终 URL 不属于平台允许域名', request_id: 'publication-url-failed' } } };
      return { body: { ...detail, actual_title: content.title, final_url: 'https://community.example.invalid/post/1', published_at: '2026-07-20T10:00:00+08:00', status: 'PUBLISHED', attachments: [file], available_actions: ['verify', 'remove', 'mark-verification-failed'] } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('button', { name: '登记已发布' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '选择测试证据' }));
  expect(await screen.findByText('published.png')).toBeInTheDocument();
  expect(screen.getByText('已上传，尚未绑定')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: '实际发布标题' }), content.title);
  await userEvent.type(screen.getByRole('textbox', { name: '最终文章 URL' }), 'https://community.example.invalid/post/1');
  await userEvent.type(screen.getByRole('textbox', { name: '发布时间' }), '2026-07-20T10:00:00+08:00');
  await userEvent.type(screen.getByRole('textbox', { name: '操作说明' }), '人工发布完成');
  await userEvent.click(screen.getByRole('button', { name: '确认提交' }));
  expect(await screen.findByText('最终 URL 不属于平台允许域名')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '实际发布标题' })).toHaveValue(content.title);
  expect(screen.getByText('published.png')).toBeInTheDocument();
  expect(screen.queryByText('已关联证据')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认提交' }));
  await waitFor(() => expect(commandAttempts).toBe(2));
  const commandCall = fetchSpy.mock.calls.find(([input]) => new URL(input instanceof Request ? input.url : String(input)).pathname.endsWith('/mark-published'));
  const commandRequest = commandCall?.[0];
  expect(commandRequest).toBeInstanceOf(Request);
  await expect((commandRequest as Request).clone().json()).resolves.toMatchObject({ attachment_file_ids: [testEvidenceId] });
});

test('旧发布详情页只读展示历史并把写操作收敛到工作台', async () => {
  window.history.pushState({}, '', `/publications/${publicationId}`);
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith(`/publication-records/${publicationId}`)) return { body: recordDetail };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);
  expect(await screen.findByText(`${content.title} · V${content.version}`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '在工作台处理' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '登记已发布' })).not.toBeInTheDocument();
});
