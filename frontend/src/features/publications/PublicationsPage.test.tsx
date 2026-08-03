/** 发布工作台测试服务端动作投影、URL 恢复和危险关闭确认。 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const workId = '61000000-0000-4000-8000-000000000001';
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'editor',
  display_name: '编辑',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  available_actions: [],
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
  available_actions: ['VERIFY', 'REGISTER_RESULT', 'CLOSE'],
  primary_action: 'VERIFY',
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
    comment: '公开页面正文不一致',
    actor_id: user.id,
    created_at: '2026-08-03T02:00:00Z',
  }],
  verifications: [{
    id: '63000000-0000-4000-8000-000000000001',
    outcome: 'FAILED',
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
  ready_count: 0,
  active_count: 0,
  awaiting_verification_count: 0,
  action_required_count: 1,
  open_issue_count: 0,
} satisfies Schema<'PublicationWorkbenchSummary'>;

function installResponses({ onVerify, onClose }: {
  onVerify?: (request: Request) => void;
  onClose?: (request: Request) => void;
} = {}) {
  let closed = false;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/publication-workbench-summary')) return { body: summary };
    if (url.pathname.endsWith('/publication-ready-items')) return { body: { items: [] } };
    if (url.pathname.endsWith('/publication-works') && request.method === 'GET') {
      return { body: { items: closed ? [] : [workItem], page: 1, page_size: 20, total: closed ? 0 : 1 } };
    }
    if (url.pathname.endsWith(`/publication-works/${workId}`)) return { body: workDetail };
    if (url.pathname.endsWith(`/publication-works/${workId}/verifications`)) {
      onVerify?.(request);
      return { body: workDetail };
    }
    if (url.pathname.endsWith(`/publication-works/${workId}/close`)) {
      onClose?.(request);
      closed = true;
      return { body: { ...workDetail, status: 'CLOSED', revision: 4, available_actions: [], primary_action: null } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });
}

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
  window.history.pushState({}, '', `/publications?tab=works&status=ACTION_REQUIRED&page=1&selected=${workId}`);
  installResponses();
  render(<App />);

  const drawer = await findDialog('发布工作详情');
  await waitFor(() => expect(within(drawer).getAllByText('公开页面正文不一致')).not.toHaveLength(0));
  expect(await within(drawer).findByRole('button', { name: '核验发布结果' })).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: /更多操作/ }));
  expect(await screen.findByText('登记发布结果')).toBeInTheDocument();
  expect(screen.getByText('关闭发布工作')).toBeInTheDocument();
  expect(screen.queryByText(/删除发布/)).not.toBeInTheDocument();
});

test('首次核验失败提交明确结果并继续保留待处理动作', async () => {
  let submitted: Promise<Schema<'PublicationVerificationCreate'>> | undefined;
  window.history.pushState({}, '', '/publications?tab=works&status=ACTION_REQUIRED');
  installResponses({ onVerify: (request) => { submitted = request.clone().json() as Promise<Schema<'PublicationVerificationCreate'>>; } });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '核验发布结果' }));
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
  expect(await screen.findByRole('button', { name: '核验发布结果' })).toBeInTheDocument();
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
