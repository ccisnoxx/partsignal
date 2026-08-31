/** Users production artifact fixture；请求日志只保留脱敏合同元数据。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type AccountType = components['schemas']['AccountType'];
type User = components['schemas']['User'];
type UserList = components['schemas']['UserList'];
type UserStatus = components['schemas']['UserStatus'];

type UserRequestRecord = {
  operation: 'create' | 'update' | 'reset' | 'delete' | 'bulk' | 'export';
  csrfToken: string | null;
  userId?: string;
  expectedRevision?: number;
  passwordLength?: number;
  status?: UserStatus;
  itemRevisions?: Array<{ userId: string; expectedRevision: number }>;
};

type UsersApiController = {
  allowHttpError: (status: number) => void;
  clearUsers: () => void;
  conflictNext: (operation: UserRequestRecord['operation']) => void;
  delayNextList: (milliseconds: number) => void;
  failNextList: (status: number) => void;
  listRequests: URL[];
  requestRecords: UserRequestRecord[];
  responsePayloads: string[];
  setAccountType: (accountType: AccountType) => void;
  setProjection: (userId: string, changes: Partial<User>) => void;
  removeUser: (userId: string) => void;
  conflictNextDelete: () => void;
};

type UserFixtures = { usersApi: UsersApiController };

const adminUser = createUser(99, {
  username: 'admin', display_name: '系统管理员', account_type: 'ADMIN', revision: 3,
});

function createUser(index: number, overrides: Partial<User> = {}): User {
  const disabled = index % 9 === 0;
  const mustChange = index === 2;
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    username: index === 1 ? 'operator-long-account-name' : `operator-${String(index).padStart(2, '0')}`,
    display_name: index === 1 ? '运营人员超长显示名称用于响应式验证' : `运营人员 ${index}`,
    account_type: index % 7 === 0 ? 'ADMIN' : 'ENGINEER',
    is_active: !disabled,
    must_change_password: mustChange,
    workflow_stage: disabled ? 'DISABLED' : mustChange ? 'FIRST_PASSWORD_CHANGE' : 'ACTIVE',
    primary_task: disabled ? 'ENABLE_USER' : mustChange ? 'MANAGE_LOGIN_SECURITY' : 'MANAGE_USER',
    available_actions: disabled
      ? ['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DELETE']
      : ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
    deletion: disabled
      ? { blockers: [] }
      : { blockers: [{ type: 'USER_BUSINESS_HISTORY', count: index + 1 }] },
    revision: index,
    created_at: new Date(Date.UTC(2026, 7, 1) + index * 60_000).toISOString(),
    ...overrides,
  };
}

function presentUser(user: User, changes: Partial<User>): User {
  const next = { ...user, ...changes, revision: user.revision + 1 };
  const disabled = !next.is_active;
  return {
    ...next,
    workflow_stage: disabled ? 'DISABLED' : next.must_change_password ? 'FIRST_PASSWORD_CHANGE' : 'ACTIVE',
    primary_task: disabled ? 'ENABLE_USER' : next.must_change_password ? 'MANAGE_LOGIN_SECURITY' : 'MANAGE_USER',
    available_actions: disabled
      ? ['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DELETE']
      : ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
    deletion: disabled ? { blockers: [] } : next.deletion,
  };
}

function listUsers(items: User[], url: URL): UserList {
  const query = url.searchParams.get('q')?.toLocaleLowerCase('zh-CN');
  const accountType = url.searchParams.get('account_type');
  const status = url.searchParams.get('status');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('page_size') ?? 20);
  const filtered = items.filter((item) => {
    const text = `${item.username} ${item.display_name}`.toLocaleLowerCase('zh-CN');
    return (!query || text.includes(query))
      && (!accountType || item.account_type === accountType)
      && (!status || (item.is_active ? 'ENABLED' : 'DISABLED') === status);
  });
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    page_size: pageSize,
    total: filtered.length,
    summary: {
      user_total: items.length,
      enabled_total: items.filter((item) => item.is_active).length,
      disabled_total: items.filter((item) => !item.is_active).length,
      must_change_password_total: items.filter((item) => item.must_change_password).length,
      admin_total: items.filter((item) => item.account_type === 'ADMIN').length,
    },
  };
}

function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, details: {}, request_id: requestId } };
}

const test = base.extend<UserFixtures>({
  usersApi: [async ({ page }, use) => {
    let items = Array.from({ length: 25 }, (_, index) => createUser(index + 1));
    let accountType: AccountType = 'ADMIN';
    let nextConflict: UserRequestRecord['operation'] | undefined;
    let nextListDelay = 0;
    let nextListFailure: number | undefined;
    const listRequests: URL[] = [];
    const requestRecords: UserRequestRecord[] = [];
    const responsePayloads: string[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];
    const allowedHttpErrors: number[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const expectedIndex = allowedHttpErrors.findIndex((status) => text.includes(`status of ${status}`));
      if (expectedIndex >= 0) {
        allowedHttpErrors.splice(expectedIndex, 1);
        return;
      }
      runtimeErrors.push(`console.error: ${text}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        const body = { ...adminUser, account_type: accountType } satisfies User;
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({ status: 200, json: { csrf_token: 'users-e2e-csrf' } satisfies components['schemas']['CsrfToken'] });
        return;
      }
      if (!url.pathname.startsWith('/api/v1/users')) {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 501, json: errorBody('USERS_FIXTURE_UNEXPECTED_API', 'Users 页面发起了未声明的 API 请求', 'req-users-unexpected') });
        return;
      }
      if (accountType !== 'ADMIN') {
        await route.fulfill({ status: 403, json: errorBody('FORBIDDEN', '仅管理员可访问', 'req-users-forbidden') });
        return;
      }

      if (request.method() === 'GET' && url.pathname === '/api/v1/users') {
        listRequests.push(url);
        if (nextListDelay > 0) {
          const delay = nextListDelay;
          nextListDelay = 0;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (nextListFailure) {
          const status = nextListFailure;
          nextListFailure = undefined;
          await route.fulfill({ status, json: errorBody('USERS_LIST_FAILED', '用户列表加载失败', 'req-users-list-failed') });
          return;
        }
        const body = listUsers(items, url);
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/users/export') {
        requestRecords.push({ operation: 'export', csrfToken: null });
        await route.fulfill({
          status: 200,
          contentType: 'text/csv;charset=utf-8',
          headers: { 'Content-Disposition': "attachment; filename*=UTF-8''users-e2e.csv" },
          body: '\uFEFFusername,display_name\noperator-01,运营人员 1\n',
        });
        return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/users') {
        const body = request.postDataJSON() as components['schemas']['UserCreate'];
        requestRecords.push({
          operation: 'create',
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          passwordLength: body.temporary_password.length,
        });
        const created = createUser(items.length + 1, {
          username: body.username,
          display_name: body.display_name,
          account_type: body.account_type,
          must_change_password: true,
          workflow_stage: 'FIRST_PASSWORD_CHANGE',
          primary_task: 'MANAGE_LOGIN_SECURITY',
          revision: 0,
        });
        items = [created, ...items];
        responsePayloads.push(JSON.stringify(created));
        await route.fulfill({ status: 201, json: created });
        return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/users/bulk-status') {
        const body = request.postDataJSON() as components['schemas']['UserBulkStatusRequest'];
        requestRecords.push({
          operation: 'bulk',
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          status: body.status,
          itemRevisions: body.items.map((item) => ({ userId: item.user_id, expectedRevision: item.expected_revision })),
        });
        const succeeded: User[] = [];
        const failures: components['schemas']['UserBulkStatusFailure'][] = [];
        body.items.forEach((entry, index) => {
          const itemIndex = items.findIndex((item) => item.id === entry.user_id);
          const current = items[itemIndex];
          if (!current) {
            failures.push({ user_id: entry.user_id, code: 'NOT_FOUND', message: '用户不存在' });
          } else if (index === 1 || entry.expected_revision !== current.revision) {
            failures.push({ user_id: entry.user_id, code: 'REVISION_CONFLICT', message: '用户修订冲突' });
          } else if (current.is_active === (body.status === 'ENABLED')) {
            failures.push({ user_id: entry.user_id, code: 'INVALID_STATE_TRANSITION', message: '用户已经处于目标状态' });
          } else {
            const saved = presentUser(current, { is_active: body.status === 'ENABLED' });
            items[itemIndex] = saved;
            succeeded.push(saved);
          }
        });
        const result = { succeeded, failures } satisfies components['schemas']['UserBulkStatusResult'];
        responsePayloads.push(JSON.stringify(result));
        await route.fulfill({ status: 200, json: result });
        return;
      }

      const resetMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/reset-password$/);
      if (request.method() === 'POST' && resetMatch) {
        const body = request.postDataJSON() as components['schemas']['ResetPasswordRequest'];
        requestRecords.push({
          operation: 'reset',
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          userId: resetMatch[1],
          expectedRevision: body.expected_revision,
          passwordLength: body.temporary_password.length,
        });
        if (nextConflict === 'reset') {
          nextConflict = undefined;
          await route.fulfill({ status: 409, json: errorBody('REVISION_CONFLICT', '用户已被其他请求修改', 'req-users-conflict') });
          return;
        }
        const index = items.findIndex((item) => item.id === resetMatch[1]);
        const current = items[index];
        if (!current || current.revision !== body.expected_revision) {
          await route.fulfill({ status: 409, json: errorBody('REVISION_CONFLICT', '用户修订冲突', 'req-users-stale') });
          return;
        }
        const saved = presentUser(current, { must_change_password: true });
        items[index] = saved;
        responsePayloads.push(JSON.stringify(saved));
        await route.fulfill({ status: 200, json: saved });
        return;
      }

      const userMatch = url.pathname.match(/^\/api\/v1\/users\/([^/]+)$/);
      if (userMatch && request.method() === 'PATCH') {
        const body = request.postDataJSON() as components['schemas']['UserUpdate'];
        requestRecords.push({
          operation: 'update',
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          userId: userMatch[1],
          expectedRevision: body.expected_revision,
          status: body.is_active ? 'ENABLED' : 'DISABLED',
        });
        const index = items.findIndex((item) => item.id === userMatch[1]);
        const current = items[index];
        if (!current || current.revision !== body.expected_revision) {
          await route.fulfill({ status: 409, json: errorBody('REVISION_CONFLICT', '用户修订冲突', 'req-users-stale') });
          return;
        }
        const saved = presentUser(current, body);
        items[index] = saved;
        responsePayloads.push(JSON.stringify(saved));
        await route.fulfill({ status: 200, json: saved });
        return;
      }
      if (userMatch && request.method() === 'DELETE') {
        const expectedRevision = Number(url.searchParams.get('expected_revision'));
        requestRecords.push({
          operation: 'delete',
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          userId: userMatch[1],
          expectedRevision,
        });
        const index = items.findIndex((item) => item.id === userMatch[1]);
        const current = items[index];
        if (!current || current.revision !== expectedRevision) {
          await route.fulfill({ status: 409, json: errorBody('REVISION_CONFLICT', '用户修订冲突', 'req-users-stale') });
          return;
        }
        if (nextConflict === 'delete') {
          nextConflict = undefined;
          await route.fulfill({ status: 409, json: errorBody('USER_IN_USE', '用户仍有业务历史引用', 'req-users-delete-conflict') });
          return;
        }
        items.splice(index, 1);
        await route.fulfill({ status: 204 });
        return;
      }

      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorBody('USERS_FIXTURE_UNEXPECTED_API', 'Users 页面发起了未声明的 API 请求', 'req-users-unexpected') });
    });

    await use({
      allowHttpError: (status) => allowedHttpErrors.push(status),
      clearUsers: () => { items = []; },
      conflictNext: (operation) => { nextConflict = operation; },
      delayNextList: (milliseconds) => { nextListDelay = milliseconds; },
      failNextList: (status) => { nextListFailure = status; },
      listRequests,
      requestRecords,
      responsePayloads,
      setAccountType: (next) => { accountType = next; },
      setProjection: (userId, changes) => {
        const index = items.findIndex((item) => item.id === userId);
        if (index < 0) throw new Error(`未知用户：${userId}`);
        items[index] = { ...items[index]!, ...changes };
      },
      removeUser: (userId) => { items = items.filter((item) => item.id !== userId); },
      conflictNextDelete: () => {
        nextConflict = 'delete';
        allowedHttpErrors.push(409);
      },
    });
    expect(unexpectedRequests, 'Users 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Users 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { expect, test };
export type { UsersApiController };
