/** 发布工作台测试服务端动作投影、URL 恢复和危险关闭确认。 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const workId = '61000000-0000-4000-8000-000000000001';
const articleId = '64000000-0000-4000-8000-000000000001';
const issueId = '65000000-0000-4000-8000-000000000001';
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'editor',
  display_name: '编辑',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-03T00:00:00Z',
} satisfies Schema<'User'>;

const workItem = {
  id: workId,
  task_id: '20000000-0000-4000-8000-000000000001',
  content_version_id: '30000000-0000-4000-8000-000000000001',
  content_title: 'PS-001 选型文章',
  content_version: 1,
  platform_profile_id: '40000000-0000-4000-8000-000000000001',
  platform_profile_name: '工程师社区',
  platform_account_id: '50000000-0000-4000-8000-000000000001',
  platform_account_label: '内容运营账号',
  account_identifier: 'operator',
  section_url: 'https://community.example.invalid/articles',
  actual_title: 'PS-001 选型文章',
  final_url: 'https://community.example.invalid/articles/ps-001',
  published_at: '2026-08-03T01:00:00Z',
  status: 'ACTION_REQUIRED',
  revision: 3,
  close_reason: null,
  close_comment: null,
  created_at: '2026-08-03T00:00:00Z',
  updated_at: '2026-08-03T02:00:00Z',
  latest_verification_outcome: 'FAILED',
  latest_verification_at: '2026-08-03T02:00:00Z',
  workflow_stage: 'ACTION_REQUIRED',
  primary_task: 'FIX_AND_REVERIFY',
  available_actions: ['VERIFY', 'REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
} satisfies Schema<'PublicationWorkListItem'>;

const workDetail = {
  ...workItem,
  content_hash: 'a'.repeat(64),
  closed_by: null,
  closed_at: null,
  created_by: user.id,
  events: [{
    id: '62000000-0000-4000-8000-000000000001',
    action: 'VERIFICATION_FAILED',
    from_status: 'AWAITING_VERIFICATION',
    to_status: 'ACTION_REQUIRED',
    from_content_version_id: workItem.content_version_id,
    to_content_version_id: workItem.content_version_id,
    comment: '公开页面正文不一致',
    actor_id: user.id,
    created_at: '2026-08-03T02:00:00Z',
  }],
  verifications: [{
    id: '63000000-0000-4000-8000-000000000001',
    outcome: 'FAILED',
    content_version_id: workItem.content_version_id,
    actual_title_snapshot: workItem.actual_title,
    final_url_snapshot: workItem.final_url,
    published_at_snapshot: workItem.published_at,
    comment: '公开页面正文不一致',
    actor_id: user.id,
    created_at: '2026-08-03T02:00:00Z',
  }],
  attachments: [],
} satisfies Schema<'PublicationWork'>;

const summary = {
  ready_count: 1,
  active_count: 0,
  awaiting_verification_count: 0,
  action_required_count: 1,
  open_issue_count: 1,
} satisfies Schema<'PublicationWorkbenchSummary'>;

const readyItem = {
  content_version: {
    id: '30000000-0000-4000-8000-000000000002',
    task_id: '20000000-0000-4000-8000-000000000002',
    fact_version_id: '21000000-0000-4000-8000-000000000002',
    source_job_id: null,
    based_on_id: null,
    version: 2,
    source_type: 'HUMAN',
    title: 'PS-002 已批准内容',
    summary: '发布候选摘要',
    body_markdown: '# 发布候选',
    tags: ['PS-002'],
    content_hash: 'b'.repeat(64),
    status: 'APPROVED',
    workflow_stage: 'CURRENT_APPROVED',
    primary_task: 'START_PUBLICATION',
    available_actions: [],
    revision: 1,
    quality_issues: [],
    created_by: user.id,
    created_at: '2026-08-03T00:00:00Z',
  },
  task_id: '20000000-0000-4000-8000-000000000002',
  platform_profile_id: '40000000-0000-4000-8000-000000000001',
  platform_profile_name: '工程师社区',
  matching_accounts: [],
  available_actions: ['START'],
  primary_task: 'START_PUBLICATION',
} satisfies Schema<'PublicationReadyItem'>;

const switchCandidate = {
  ...readyItem.content_version,
  id: '30000000-0000-4000-8000-000000000003',
  task_id: workItem.task_id,
  version: 2,
  title: 'PS-001 核验修订版',
} satisfies Schema<'ContentVersion'>;

const articleItem = {
  id: articleId,
  task_id: workItem.task_id,
  product_id: '22000000-0000-4000-8000-000000000001',
  content_version_id: workItem.content_version_id,
  content_title: workItem.content_title,
  content_version: workItem.content_version,
  platform_profile_id: workItem.platform_profile_id,
  platform_profile_name: workItem.platform_profile_name,
  platform_account_id: workItem.platform_account_id,
  platform_account_label: workItem.platform_account_label,
  account_identifier: workItem.account_identifier,
  actual_title: 'PS-001 已发布成果',
  final_url: workItem.final_url!,
  published_at: workItem.published_at!,
  verified_at: '2026-08-03T03:00:00Z',
  has_open_issue: true,
  open_issue_id: issueId,
  retired: false,
  workflow_stage: 'OPEN_ISSUE',
  primary_task: 'HANDLE_CONTENT_ISSUE',
  available_actions: ['OPEN_ISSUE'],
} satisfies Schema<'PublishedArticleListItem'>;

const issueItem = {
  id: issueId,
  kind: 'PAGE_UNAVAILABLE',
  description: '公开页面已下线',
  status: 'OPEN',
  opened_at: '2026-08-03T04:00:00Z',
  resolved_at: null,
  resolution_outcome: null,
  resolution_comment: null,
  published_article_id: articleId,
  content_title: workItem.content_title,
  platform_profile_name: workItem.platform_profile_name,
  actual_title: articleItem.actual_title,
  final_url: articleItem.final_url,
  revision: 1,
  repair_task_id: null,
  workflow_stage: 'OPEN',
  primary_task: 'HANDLE_CONTENT_ISSUE',
  available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'],
} satisfies Schema<'PublishedContentIssueListItem'>;

const issueDetail = {
  ...issueItem,
  opened_by: user.id,
  resolved_by: null,
  article: articleItem,
} satisfies Schema<'PublishedContentIssue'>;

function installResponses({ onVerify, onClose, onSwitch, onWorks, workTotal = 1 }: {
  onVerify?: (request: Request) => void;
  onClose?: (request: Request) => void;
  onSwitch?: (request: Request) => void;
  onWorks?: (url: URL) => void;
  workTotal?: number;
} = {}) {
  let closed = false;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/publication-workbench-summary')) return { body: summary };
    if (url.pathname.endsWith('/publication-ready-items')) return { body: { items: [readyItem] } };
    if (url.pathname.endsWith('/publication-works') && request.method === 'GET') {
      onWorks?.(url);
      const historical = url.searchParams.get('status') === 'CLOSED';
      return { body: { items: closed || historical ? [] : [workItem], page: Number(url.searchParams.get('page') ?? 1), page_size: 20, total: closed || historical ? 0 : workTotal } };
    }
    if (url.pathname.endsWith('/published-articles')) return { body: { items: [articleItem], page: 1, page_size: 20, total: 1 } };
    if (url.pathname.endsWith('/published-content-issues')) {
      const resolved = url.searchParams.get('status') === 'RESOLVED';
      return { body: { items: resolved ? [] : [issueItem], page: 1, page_size: 20, total: resolved ? 0 : 1 } };
    }
    if (url.pathname.endsWith(`/content-tasks/${workItem.task_id}/content-versions`)) return { body: { items: [switchCandidate] } };
    if (url.pathname.endsWith(`/published-content-issues/${issueId}`)) return { body: issueDetail };
    if (url.pathname.endsWith(`/publication-works/${workId}`)) return { body: workDetail };
    if (url.pathname.endsWith(`/publication-works/${workId}/content-version`)) {
      onSwitch?.(request);
      return { body: { ...workDetail, content_version_id: switchCandidate.id, content_title: switchCandidate.title, content_version: switchCandidate.version, revision: 4 } };
    }
    if (url.pathname.endsWith(`/publication-works/${workId}/verifications`)) {
      onVerify?.(request);
      return { body: workDetail };
    }
    if (url.pathname.endsWith(`/publication-works/${workId}/close`)) {
      onClose?.(request);
      closed = true;
      return { body: { ...workDetail, status: 'CLOSED', workflow_stage: 'CLOSED', primary_task: 'VIEW_CLOSURE', revision: 4, available_actions: [] } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });
}

test('删除引用模式按账号精确筛选并包含终态发布历史', async () => {
  const workRequests: URL[] = [];
  installResponses({ onWorks: (url) => workRequests.push(url) });
  window.history.pushState({}, '', `/publications?platform_account_id=${workItem.platform_account_id}`);

  render(<App />);
  expect(await screen.findByText('正在查看删除阻断引用')).toBeInTheDocument();
  expect(screen.getByText(/包括已完成和已关闭历史/)).toBeInTheDocument();
  await waitFor(() => expect(workRequests.length).toBeGreaterThan(0));
  expect(workRequests[0]!.searchParams.get('platform_account_id')).toBe(workItem.platform_account_id);
  expect(workRequests[0]!.searchParams.has('status')).toBe(false);
});

test('删除引用模式翻页使用通用 page 参数', async () => {
  const operator = userEvent.setup();
  const workRequests: URL[] = [];
  installResponses({ workTotal: 21, onWorks: (url) => workRequests.push(url) });
  window.history.pushState({}, '', `/publications?platform_account_id=${workItem.platform_account_id}`);

  render(<App />);
  await operator.click(await screen.findByTitle('2'));

  await waitFor(() => expect(workRequests.some((url) => url.searchParams.get('page') === '2')).toBe(true));
  expect(new URLSearchParams(window.location.search).get('page')).toBe('2');
  expect(new URLSearchParams(window.location.search).has('work_page')).toBe(false);
});

async function findDialog(title: string) {
  return waitFor(() => {
    const heading = [...document.querySelectorAll<HTMLElement>('.ant-drawer-title, .ant-modal-title')]
      .find((item) => item.textContent === title);
    const dialog = heading?.closest<HTMLElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();
    return dialog!;
  });
}

test('URL 恢复需处理工作详情，动作完全来自服务端投影', async () => {
  window.history.pushState({}, '', `/publications?tab=works&status=ACTION_REQUIRED&work_page=1&kind=work&selected=${workId}`);
  installResponses();
  render(<App />);

  const drawer = await findDialog('发布工作详情');
  await waitFor(() => expect(within(drawer).getAllByText('公开页面正文不一致')).not.toHaveLength(0));
  expect(await within(drawer).findByRole('button', { name: '修复并重新核验' })).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: /更多操作/ }));
  expect(await screen.findByText('登记发布结果')).toBeInTheDocument();
  expect(screen.getByText('关闭发布工作')).toBeInTheDocument();
  expect(screen.queryByText(/删除发布/)).not.toBeInTheDocument();
});

test('默认待处理视图按问题、当前工作和待开始内容组织', async () => {
  window.history.pushState({}, '', '/publications');
  installResponses();
  render(<App />);

  expect(await screen.findByRole('tab', { name: '待处理' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: '发布成果' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '历史记录' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '开放内容问题' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '当前发布工作' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '待开始内容' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '内容问题' })).not.toBeInTheDocument();
});

test('内容任务深链直接恢复对应内容的开始发布弹窗', async () => {
  window.history.pushState({}, '', `/publications?content_version_id=${readyItem.content_version.id}`);
  installResponses();
  render(<App />);

  expect(await findDialog('开始发布')).toBeInTheDocument();
});

test('混合待处理视图只按显式 kind 恢复问题详情', async () => {
  window.history.pushState({}, '', `/publications?tab=works&kind=issue&selected=${issueId}`);
  installResponses();
  render(<App />);

  const drawer = await findDialog('内容问题详情');
  expect(await within(drawer).findByText('公开页面已下线')).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: '处理内容问题' })).toBeInTheDocument();
});

test('历史记录只查询已关闭工作或已解决问题，不重复发布成果', async () => {
  const requests: string[] = [];
  window.history.pushState({}, '', '/publications?tab=history&status=CLOSED&page=1');
  installResponses();
  const originalFetch = window.fetch;
  window.fetch = ((input, init) => {
    requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return originalFetch(input, init);
  }) as typeof window.fetch;
  try {
    render(<App />);
    expect(await screen.findByRole('tab', { name: '历史记录' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(requests.some((url) => new URL(url).searchParams.get('status') === 'CLOSED')).toBe(true));
    expect(requests.some((url) => new URL(url).pathname.endsWith('/published-articles'))).toBe(false);
  } finally {
    window.fetch = originalFetch;
  }
});

test('首次核验失败提交明确结果并继续保留待处理动作', async () => {
  let submitted: Promise<Schema<'PublicationVerificationCreate'>> | undefined;
  window.history.pushState({}, '', '/publications?tab=works&status=ACTION_REQUIRED');
  installResponses({ onVerify: (request) => { submitted = request.clone().json() as Promise<Schema<'PublicationVerificationCreate'>>; } });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '修复并重新核验' }));
  const dialog = await findDialog('核验发布结果');
  await userEvent.click(within(dialog).getByRole('combobox'));
  await userEvent.click(await screen.findByText('核验失败，继续待处理'));
  await userEvent.type(within(dialog).getByLabelText('核验说明'), '页面正文仍不一致');
  await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

  await waitFor(() => expect(submitted).toBeDefined());
  await expect(submitted).resolves.toEqual({
    outcome: 'FAILED',
    content_matches: false,
    expected_revision: 3,
    comment: '页面正文仍不一致',
  });
  expect(await screen.findByRole('button', { name: '修复并重新核验' })).toBeInTheDocument();
});

test('核验成功前可在原发布工作中切换同任务批准版本', async () => {
  let submitted: Promise<Schema<'PublicationContentVersionSwitchRequest'>> | undefined;
  window.history.pushState({}, '', '/publications?tab=works&status=ACTION_REQUIRED');
  installResponses({ onSwitch: (request) => { submitted = request.clone().json() as Promise<Schema<'PublicationContentVersionSwitchRequest'>>; } });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: /更多操作：PS-001 选型文章/ }));
  await userEvent.click(await screen.findByText('切换待发布版本'));
  const dialog = await findDialog('切换待发布版本');
  await userEvent.click(within(dialog).getByRole('combobox', { name: '新的批准版本' }));
  await userEvent.click(await screen.findByText('PS-001 核验修订版 · V2'));
  await userEvent.type(within(dialog).getByRole('textbox', { name: '操作说明' }), '使用核验修订版继续发布');
  await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

  await waitFor(() => expect(submitted).toBeDefined());
  await expect(submitted).resolves.toEqual({
    content_version_id: switchCandidate.id,
    expected_revision: workItem.revision,
    comment: '使用核验修订版继续发布',
  });
});

test('更多操作中的关闭命令展示不可恢复影响并取消来源任务', async () => {
  let submitted: Promise<Schema<'PublicationWorkCloseRequest'>> | undefined;
  window.history.pushState({}, '', '/publications?tab=works');
  installResponses({ onClose: (request) => { submitted = request.clone().json() as Promise<Schema<'PublicationWorkCloseRequest'>>; } });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: /更多操作：PS-001 选型文章/ }));
  await userEvent.click(await screen.findByText('关闭发布工作'));
  const dialog = await findDialog('关闭发布工作');
  expect(within(dialog).getByText('关闭后发布工作不可恢复，来源内容任务将同时取消。')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('combobox'));
  await userEvent.click(await screen.findByText('平台拒绝'));
  await userEvent.type(within(dialog).getByLabelText('操作说明'), '平台审核未通过');
  await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

  await waitFor(() => expect(submitted).toBeDefined());
  await expect(submitted).resolves.toEqual({ reason: 'PLATFORM_REJECTED', comment: '平台审核未通过', expected_revision: 3 });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'PS-001 选型文章 · V1' })).not.toBeInTheDocument());
});
