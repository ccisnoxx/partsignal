/** 发布管理测试覆盖真实聚合、URL 状态、按需抽屉和服务端动作契约。 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  matching_accounts: [{
    id: '52000000-0000-4000-8000-000000000001',
    platform_profile_id: '50000000-0000-4000-8000-000000000001',
    label: '匹配账号',
    account_identifier: 'matched',
    is_active: true,
    revision: 0,
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
  available_actions: ['mark-published', 'reject', 'delete'],
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
  available_actions: ['mark-published', 'reject', 'delete'],
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

function mockCandidateWorkspace() {
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { candidates: [candidate] });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith('/publication-package')) return { body: { content_version_id: content.id, fact_version_id: content.fact_version_id, title: content.title, body_markdown: content.body_markdown, body_html: '<p>正文</p>', body_text: '正文', tags: [], content_hash: content.content_hash } satisfies Schema<'PublicationPackage'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
}

async function openCandidateDrawer() {
  const page = within(await waitFor(() => {
    const root = document.querySelector<HTMLElement>('.app-content');
    expect(root).not.toBeNull();
    return root!;
  }));
  fireEvent.click(await page.findByRole('button', { name: '准备人工发布' }));
  return waitFor(() => {
    const drawer = document.querySelector<HTMLElement>('.publication-drawer-root [role="dialog"]');
    expect(drawer).not.toBeNull();
    return drawer!;
  });
}

async function findPublicationConfirm() {
  return waitFor(() => {
    const title = [...document.querySelectorAll<HTMLElement>('.ant-modal-confirm-title')]
      .find((item) => item.textContent === '放弃未提交内容？');
    const dialog = title?.closest<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    return dialog!;
  });
}

async function findDeleteConfirm() {
  return waitFor(() => {
    const title = [...document.querySelectorAll<HTMLElement>('.ant-modal-confirm-title')]
      .find((item) => item.textContent === '删除未公开发布记录？');
    const dialog = title?.closest<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    return dialog!;
  });
}

test('候选登记抽屉只展示匹配账号', async () => {
  mockCandidateWorkspace();
  render(<App />);
  expect(document.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  const drawer = await openCandidateDrawer();
  expect(within(drawer).getByText('本篇文章只能选择一个账号')).toBeInTheDocument();
  const accountSelect = within(drawer).getByRole('combobox', { name: '发布账号' });
  await waitFor(() => expect(accountSelect).toBeEnabled());
  fireEvent.mouseDown(accountSelect);
  const matchingAccount = await waitFor(() => {
    const option = [...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content',
    )].find((item) => item.textContent === '匹配账号 / matched');
    expect(option).toBeDefined();
    return option!;
  });
  expect(matchingAccount).toBeInTheDocument();
  expect(screen.queryByText(/跨平台账号/)).not.toBeInTheDocument();
  fireEvent.click(matchingAccount);
  await waitFor(() => expect(accountSelect.closest('.ant-select')).toHaveTextContent('匹配账号 / matched'));
});

test('候选登记有未提交内容时确认关闭', async () => {
  mockCandidateWorkspace();
  render(<App />);
  const drawer = await openCandidateDrawer();
  const sectionUrl = within(drawer).getByRole('textbox', { name: '目标栏目 URL' });
  await waitFor(() => expect(sectionUrl).toBeEnabled());
  fireEvent.change(sectionUrl, { target: { value: 'https://community.example.invalid/section' } });
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  const continueDialog = await findPublicationConfirm();
  fireEvent.click(within(continueDialog).getByRole('button', { name: '继续编辑' }));
  expect(within(drawer).getByText('此步骤只创建待人工发布记录')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  const discardDialog = await findPublicationConfirm();
  fireEvent.click(within(discardDialog).getByRole('button', { name: '放弃并关闭' }));
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
  const drawer = within(await openCandidateDrawer());
  expect(await drawer.findByText('发布包加载失败')).toBeInTheDocument();
  expect(drawer.queryByRole('button', { name: '复制标题' })).not.toBeInTheDocument();
  expect(drawer.getByRole('button', { name: '登记待人工发布' })).toBeDisabled();
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
  expect(screen.getByRole('link', { name: '前往业务设置' })).toHaveAttribute(
    'href',
    `/settings?tab=accounts&platform_profile_id=${candidate.platform_profile_id}`,
  );
  expect(screen.getByRole('button', { name: '准备人工发布' })).toBeDisabled();
});

test('待发布候选通过现有任务取消能力退出列表并保留批准历史', async () => {
  let cancelled = false;
  window.history.pushState({}, '', '/publications');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, {
      candidates: cancelled ? [] : [candidate],
    });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/content-tasks/${candidate.task_id}`) && request.method === 'GET') {
      return {
        body: {
          id: candidate.task_id,
          product_id: '51000000-0000-4000-8000-000000000001',
          fact_version_id: content.fact_version_id,
          platform_profile_id: candidate.platform_profile_id,
          query_topic_id: null,
          source_publication_attention_id: null,
          available_actions: ['CANCEL'],
          status: 'OPEN',
          revision: 2,
          created_by: user.id,
          created_at: user.created_at,
        },
      };
    }
    if (path.endsWith(`/content-tasks/${candidate.task_id}/cancel`) && request.method === 'POST') {
      cancelled = true;
      return { body: {} };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: `更多操作：${content.title}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '取消待发布' }));
  const confirm = within(await screen.findByRole('dialog'));
  expect(confirm.getByText(/已批准内容和审核历史仍会保留/)).toBeInTheDocument();
  fireEvent.click(confirm.getByRole('button', { name: '确认取消' }));

  await waitFor(() => expect(cancelled).toBe(true));
  await waitFor(() => expect(screen.queryByText(content.title)).not.toBeInTheDocument());
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
  fireEvent.click(await screen.findByRole('button', { name: '显式解决' }));
  fireEvent.click(screen.getByRole('button', { name: '确认解决' }));
  expect(await screen.findByText('必须填写处置说明')).toBeInTheDocument();
  expect(resolveCalls).toBe(0);
  fireEvent.change(screen.getByRole('textbox', { name: '处置说明' }), { target: { value: '已人工处置' } });
  fireEvent.click(screen.getByRole('button', { name: '确认解决' }));
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
  fireEvent.click(screen.getByRole('tab', { name: /待发布候选/ }));
  await waitFor(() => expect(window.location.search).toContain('tab=candidates'));
  expect(window.location.search).toContain('records_page=2');
});

test('发布记录保留单一主入口，并在更多菜单展示其余服务端动作', async () => {
  window.history.pushState({}, '', '/publications?tab=records');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { records: [recordItem], total: 1 });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/publication-records/${publicationId}`)) return { body: recordDetail };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: `更多操作：${content.title}` }));
  expect(await screen.findByRole('menuitem', { name: '平台拒绝' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: '删除记录' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: '登记已发布' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: '平台拒绝' }));

  const drawer = within(await screen.findByRole('dialog'));
  expect(await drawer.findByRole('button', { name: '确认提交' })).toBeInTheDocument();
  expect(drawer.getAllByText('平台拒绝')).toHaveLength(2);
  expect(window.location.search).toContain(`record=${publicationId}`);
});

test('已有公开历史且无其他动作时只保留查看记录', async () => {
  window.history.pushState({}, '', '/publications?tab=records');
  const protectedRecord = {
    ...recordItem,
    status: 'VERIFIED' as const,
    available_actions: [],
  };
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, { records: [protectedRecord], total: 1 });
    if (common) return common;
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);

  expect(await screen.findByRole('button', { name: '查看记录' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: `更多操作：${content.title}` })).not.toBeInTheDocument();
  expect(screen.queryByText('物理删除')).not.toBeInTheDocument();
});

test('删除使用专属确认和 DELETE，成功后清理记录 URL', async () => {
  let deleted = false;
  const requests: Request[] = [];
  window.history.pushState({}, '', `/publications?tab=records&record=${publicationId}`);
  mockFetch((request) => {
    requests.push(request);
    const common = commonWorkspaceResponse(request, {
      records: deleted ? [] : [{ ...recordItem, available_actions: ['delete'] }],
      total: deleted ? 0 : 1,
    });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/publication-records/${publicationId}`) && request.method === 'GET') {
      return { body: { ...recordDetail, available_actions: ['delete'] } };
    }
    if (path.endsWith(`/publication-records/${publicationId}`) && request.method === 'DELETE') {
      deleted = true;
      return { body: {} };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);

  const drawer = within(await screen.findByRole('dialog'));
  fireEvent.click(await drawer.findByRole('button', { name: '删除未公开记录' }));
  const confirm = within(await findDeleteConfirm());
  expect(confirm.getByText(/不会标记为已移除/)).toBeInTheDocument();
  fireEvent.click(confirm.getByRole('button', { name: '删除记录' }));

  await waitFor(() => expect(deleted).toBe(true));
  await waitFor(() => expect(window.location.search).not.toContain('record='));
  expect(requests.some((request) => request.method === 'DELETE' && new URL(request.url).pathname.endsWith(publicationId))).toBe(true);
  expect(requests.some((request) => request.method === 'POST' && new URL(request.url).pathname.includes(`/publication-records/${publicationId}/`))).toBe(false);
});

test('Drawer 分别说明标记已移除和验证失败的影响', async () => {
  window.history.pushState({}, '', `/publications?tab=records&record=${publicationId}`);
  const published = {
    ...recordDetail,
    status: 'PUBLISHED',
    available_actions: ['remove', 'mark-verification-failed'],
  } satisfies Schema<'PublicationRecord'>;
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request, {
      records: [{
        ...recordItem,
        status: 'PUBLISHED',
        available_actions: ['remove', 'mark-verification-failed'],
      }],
      total: 1,
    });
    if (common) return common;
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/publication-records/${publicationId}`)) return { body: published };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  render(<App />);

  const drawer = within(await screen.findByRole('dialog'));
  fireEvent.click(await drawer.findByRole('button', { name: '标记已移除' }));
  expect(drawer.getByText('标记已移除会保留发布历史')).toBeInTheDocument();
  expect(drawer.getByRole('button', { name: '确认标记已移除' })).toBeInTheDocument();
  fireEvent.click(drawer.getByRole('button', { name: /取\s*消/ }));
  fireEvent.click(drawer.getByRole('button', { name: '标记验证失败' }));
  expect(drawer.getByText('验证失败会进入发布需关注')).toBeInTheDocument();
  expect(drawer.getByRole('button', { name: '确认标记验证失败' })).toBeInTheDocument();
});

test('发布需关注 Tab 解释触发与处理路径', async () => {
  window.history.pushState({}, '', '/publications?tab=attentions');
  mockFetch((request) => {
    const common = commonWorkspaceResponse(request);
    if (common) return common;
    throw new Error(`未声明的测试请求：${request.method} ${request.url}`);
  });
  render(<App />);

  expect(await screen.findByRole('tab', { name: /发布需关注/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('已移除或验证失败的记录会进入此处')).toBeInTheDocument();
  expect(screen.getByText(/创建修复任务，并在写明处理结果后显式解决/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByText('近 30 天'));
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
  const drawer = within(dialog);
  fireEvent.click(await drawer.findByText('登记已发布'));
  fireEvent.click(drawer.getByText('选择测试证据'));
  expect(await drawer.findByText('published.png')).toBeInTheDocument();
  expect(drawer.getByText('已上传，尚未绑定')).toBeInTheDocument();
  fireEvent.change(drawer.getByLabelText('实际发布标题'), { target: { value: content.title } });
  fireEvent.change(drawer.getByLabelText('最终文章 URL'), { target: { value: 'https://community.example.invalid/post/1' } });
  fireEvent.change(drawer.getByLabelText('发布时间'), { target: { value: '2026-07-20T10:00:00+08:00' } });
  fireEvent.change(drawer.getByLabelText('操作说明'), { target: { value: '人工发布完成' } });
  const submit = drawer.getByText('确认提交').closest<HTMLButtonElement>('button');
  expect(submit).not.toBeNull();
  fireEvent.click(submit!);
  expect(await drawer.findByText('最终 URL 不属于平台允许域名')).toBeInTheDocument();
  expect(drawer.getByLabelText('实际发布标题')).toHaveValue(content.title);
  expect(drawer.getByText('published.png')).toBeInTheDocument();
  expect(drawer.queryByText('已关联证据')).not.toBeInTheDocument();
  fireEvent.click(drawer.getByText('确认提交').closest<HTMLButtonElement>('button')!);
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
