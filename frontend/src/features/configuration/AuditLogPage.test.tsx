/** 验证审计工作台只用 URL 驱动服务端组合查询，并消费安全详情投影。 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const admin = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  revision: 1,
  created_at: '2026-07-20T00:00:00Z',
} satisfies Schema<'User'>;

const auditLog = {
  id: '20000000-0000-4000-8000-000000000001',
  actor_id: admin.id,
  actor: { id: admin.id, display_name: '系统管理员', account_type: 'ADMIN' },
  business_module: 'CONFIGURATION',
  action: 'platform_profile.updated',
  target_type: 'PlatformProfile',
  target_id: '30000000-0000-4000-8000-000000000001',
  outcome: 'SUCCESS',
  change_summary: { revision: 3 },
  request_id: 'req-audit-1',
  created_at: '2026-07-23T00:00:00Z',
} satisfies Schema<'AuditLog'>;

const auditDetail = {
  ...auditLog,
  changes: [{ field: 'revision', after: 3 }],
  facts: { revision: 3 },
  result_message: '平台配置已更新。',
  error_code: null,
  related_entry: { status: 'AVAILABLE', kind: 'PlatformProfile', parent_id: null },
} satisfies Schema<'AuditLogDetail'>;

function userList(): Schema<'UserList'> {
  return {
    items: [admin],
    page: 1,
    page_size: 50,
    total: 1,
    summary: {
      user_total: 1,
      enabled_total: 1,
      disabled_total: 0,
      must_change_password_total: 0,
      admin_total: 1,
    },
  };
}

function installAuditApi(onList?: (url: URL) => void, onDetail?: () => void) {
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: admin };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/audit-logs/filter-options')) {
      return { body: { actions: [auditLog.action], target_types: [auditLog.target_type] } satisfies Schema<'AuditLogFilterOptions'> };
    }
    if (url.pathname.endsWith(`/audit-logs/${auditLog.id}`)) {
      onDetail?.();
      return { body: auditDetail };
    }
    if (url.pathname.endsWith('/audit-logs')) {
      onList?.(url);
      return {
        body: {
          items: [auditLog],
          page: Number(url.searchParams.get('page') ?? 1),
          page_size: Number(url.searchParams.get('page_size') ?? 20),
          total: 60,
        } satisfies Schema<'AuditLogList'>,
      };
    }
    if (url.pathname.endsWith('/users')) return { body: userList() };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

test('恢复并规范化组合筛选 URL，全部筛选直接进入服务端分页请求', async () => {
  const requests: URL[] = [];
  window.history.pushState({}, '', '/audit?created_from=2026-07-20T00%3A00%3A00Z&created_to=2026-07-23T00%3A00%3A00Z&actor_id=10000000-0000-4000-8000-000000000001&business_module=CONFIGURATION&action=platform_profile.updated&target_type=PlatformProfile&outcome=SUCCESS&request_id=req-audit-1&keyword=revision&page=2&page_size=50&unknown=x');
  installAuditApi((url) => requests.push(url));

  render(<App />);
  expect(await screen.findByRole('heading', { name: '审计日志' })).toBeInTheDocument();
  expect(await screen.findByText('系统管理员', { selector: 'td' })).toBeInTheDocument();
  await waitFor(() => expect(new URLSearchParams(window.location.search).has('unknown')).toBe(false));

  const query = requests[0]!.searchParams;
  expect(query.get('created_from')).toBe('2026-07-20T00:00:00.000Z');
  expect(query.get('created_to')).toBe('2026-07-23T00:00:00.000Z');
  expect(query.get('actor_id')).toBe(admin.id);
  expect(query.get('business_module')).toBe('CONFIGURATION');
  expect(query.get('action')).toBe('platform_profile.updated');
  expect(query.get('target_type')).toBe('PlatformProfile');
  expect(query.get('outcome')).toBe('SUCCESS');
  expect(query.get('request_id')).toBe('req-audit-1');
  expect(query.get('keyword')).toBe('revision');
  expect(query.get('page')).toBe('2');
  expect(query.get('page_size')).toBe('50');
  expect(screen.getByText(/08:00:00/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  await waitFor(() => {
    const reset = new URLSearchParams(window.location.search);
    expect(reset.has('business_module')).toBe(false);
    expect(reset.has('keyword')).toBe(false);
    expect(reset.has('created_from')).toBe(true);
    expect(reset.has('created_to')).toBe(true);
  });
});

test('查看详情展示历史缺失值和真实关联入口，手动刷新同时请求列表与详情', async () => {
  let listRequests = 0;
  let detailRequests = 0;
  window.history.pushState({}, '', '/audit?created_from=2026-07-20T00%3A00%3A00Z&created_to=2026-07-23T00%3A00%3A00Z');
  installAuditApi(() => { listRequests += 1; }, () => { detailRequests += 1; });

  render(<App />);
  await screen.findByText('系统管理员', { selector: 'td' });
  await userEvent.click(screen.getByRole('button', { name: `查看日志详情：${auditLog.id}` }));

  expect(await screen.findByRole('heading', { name: '日志详情' })).toBeInTheDocument();
  expect(screen.getByText('历史未记录')).toBeInTheDocument();
  expect(screen.getByText('平台配置已更新。')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /查看关联对象/ })).toHaveAttribute('href', `/configuration/platforms?platform=${auditLog.target_id}`);
  const listBefore = listRequests;
  const detailBefore = detailRequests;

  fireEvent.click(screen.getByRole('button', { name: '手动刷新' }));
  await waitFor(() => {
    expect(listRequests).toBeGreaterThan(listBefore);
    expect(detailRequests).toBeGreaterThan(detailBefore);
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭日志详情' }));
  expect(screen.queryByRole('heading', { name: '日志详情' })).not.toBeInTheDocument();
});

test('自动刷新默认关闭，开启后每 30 秒刷新且页面隐藏时暂停', async () => {
  let listRequests = 0;
  window.history.pushState({}, '', '/audit?created_from=2026-07-20T00%3A00%3A00Z&created_to=2026-07-23T00%3A00%3A00Z');
  installAuditApi(() => { listRequests += 1; });
  render(<App />);
  await screen.findByText('系统管理员', { selector: 'td' });
  const initial = listRequests;
  expect(screen.getByRole('switch', { name: '自动刷新' })).not.toBeChecked();

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('switch', { name: '自动刷新' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(listRequests).toBeGreaterThan(initial);

  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  const hiddenCount = listRequests;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(listRequests).toBe(hiddenCount);
});
