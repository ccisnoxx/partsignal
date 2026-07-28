/** 发布账号设置测试覆盖定向筛选、修订号写入、启停和冲突反馈。 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const profileId = '50000000-0000-4000-8000-000000000001';
const accountId = '52000000-0000-4000-8000-000000000001';
const engineer = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'editor',
  display_name: '编辑',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  revision: 1,
  created_at: '2026-07-26T00:00:00Z',
} satisfies Schema<'User'>;
const profile = {
  id: profileId,
  name: '工程师社区',
  slug: 'engineer-community',
  allowed_domains: ['community.example.invalid'],
  platform_type_id: null,
  platform_type: null,
  website_url: null,
  logo: null,
  revision: 0,
  is_active: true,
  platform_prompt: null,
  configuration_complete: false,
  platform_account_count: 1,
  updated_at: null,
} satisfies Schema<'PlatformProfile'>;

function platformList() {
  return {
    items: [profile],
    page: 1,
    page_size: 1,
    total: 1,
    summary: {
      platform_total: 1,
      enabled_total: 1,
      missing_prompt_total: 1,
      configuration_complete_total: 0,
    },
  } satisfies Schema<'PlatformProfileList'>;
}

function installAccountApi() {
  let account: Schema<'PlatformAccount'> = {
    id: accountId,
    platform_profile_id: profileId,
    label: '主运营账号',
    account_identifier: 'operator-a',
    is_active: true,
    revision: 0,
  };
  const writes: Request[] = [];
  window.history.pushState(
    {},
    '',
    `/settings?tab=accounts&platform_profile_id=${profileId}`,
  );
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: engineer };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/platform-profiles')) return { body: platformList() };
    if (path.endsWith('/platform-accounts') && request.method === 'GET') {
      return { body: { items: [account] } satisfies Schema<'PlatformAccountList'> };
    }
    writes.push(request);
    if (request.method === 'PATCH') {
      account = { ...account, label: '主账号（新版）', revision: account.revision + 1 };
      return { body: account };
    }
    if (path.endsWith('/disable')) {
      account = { ...account, is_active: false, revision: account.revision + 1 };
      return { body: account };
    }
    if (path.endsWith('/enable')) {
      account = { ...account, is_active: true, revision: account.revision + 1 };
      return { body: account };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  return writes;
}

async function accountPage() {
  const root = await waitFor(() => {
    const content = document.querySelector<HTMLElement>('.app-content');
    expect(content).not.toBeNull();
    return content!;
  });
  return within(root);
}

test('定向打开账号页并预填新增平台', async () => {
  installAccountApi();
  render(<App />);
  const page = await accountPage();
  expect(await page.findByRole('heading', { name: '发布账号' })).toBeInTheDocument();
  await waitFor(() =>
    expect(
      page.getByRole('combobox', { name: '按平台筛选账号' }).closest('.ant-select'),
    ).toHaveTextContent('工程师社区'),
  );
  fireEvent.click(page.getByRole('button', { name: /新增发布账号/ }));
  const createDialog = (await screen.findByText('新增发布账号', {
    selector: '.ant-modal-title',
  })).closest<HTMLElement>('[role="dialog"]');
  expect(createDialog).not.toBeNull();
  expect(
    within(createDialog!).getByRole('combobox', { name: '平台' }).closest('.ant-select'),
  ).toHaveTextContent('工程师社区');
  fireEvent.click(within(createDialog!).getByRole('button', { name: /Close|关闭/ }));
});

test('发布账号按 revision 编辑', async () => {
  const writes = installAccountApi();
  render(<App />);
  const page = await accountPage();
  fireEvent.click(await page.findByRole('button', { name: '更多操作：主运营账号' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑' }));
  const editDialog = (await screen.findByText('编辑发布账号')).closest<HTMLElement>(
    '[role="dialog"]',
  );
  expect(editDialog).not.toBeNull();
  const label = within(editDialog!).getByRole('textbox', { name: '业务标签' });
  fireEvent.change(label, { target: { value: '主账号（新版）' } });
  fireEvent.click(within(editDialog!).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(writes.some((request) => request.method === 'PATCH')).toBe(true));
  const updateRequest = writes.find((request) => request.method === 'PATCH');
  expect(await updateRequest!.clone().json()).toMatchObject({
    label: '主账号（新版）',
    expected_revision: 0,
  });
});

test('发布账号按 revision 停用并重新启用', async () => {
  const writes = installAccountApi();
  render(<App />);
  const page = await accountPage();
  fireEvent.click(await page.findByRole('button', { name: '更多操作：主运营账号' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }));
  fireEvent.click(screen.getByRole('button', { name: /停\s*用/ }));
  await waitFor(() => expect(writes.some((request) => new URL(request.url).pathname.endsWith('/disable'))).toBe(true));
  const disableRequest = writes.find((request) => new URL(request.url).pathname.endsWith('/disable'));
  expect(await disableRequest!.clone().json()).toEqual({ expected_revision: 0 });

  fireEvent.click(await page.findByRole('button', { name: '更多操作：主运营账号' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '启用' }));
  await waitFor(() => expect(writes.some((request) => new URL(request.url).pathname.endsWith('/enable'))).toBe(true));
  const enableRequest = writes.find((request) => new URL(request.url).pathname.endsWith('/enable'));
  expect(await enableRequest!.clone().json()).toEqual({ expected_revision: 1 });
});

test('编辑为同平台规范化重复标识时在弹窗显示服务端冲突', async () => {
  const account = {
    id: accountId,
    platform_profile_id: profileId,
    label: '主运营账号',
    account_identifier: 'operator-a',
    is_active: true,
    revision: 0,
  } satisfies Schema<'PlatformAccount'>;
  window.history.pushState({}, '', '/settings?tab=accounts');
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: engineer };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/platform-profiles')) return { body: platformList() };
    if (path.endsWith('/platform-accounts') && request.method === 'GET') {
      return { body: { items: [account] } satisfies Schema<'PlatformAccountList'> };
    }
    if (request.method === 'PATCH') {
      return {
        status: 409,
        body: {
          error: {
            code: 'PLATFORM_ACCOUNT_IDENTIFIER_EXISTS',
            message: '该平台已存在相同的运营账号标识',
            request_id: 'account-conflict',
          },
        },
      };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '更多操作：主运营账号' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑' }));
  const dialog = (await screen.findByText('编辑发布账号')).closest<HTMLElement>(
    '[role="dialog"]',
  );
  expect(dialog).not.toBeNull();
  const identifier = within(dialog!).getByRole('textbox', { name: '运营账号标识（内部）' });
  fireEvent.change(identifier, { target: { value: '  OPERATOR-A  ' } });
  fireEvent.click(within(dialog!).getByRole('button', { name: /保\s*存/ }));
  expect(await within(dialog!).findByRole('alert')).toHaveTextContent(
    '该平台已存在相同的运营账号标识',
  );
});
