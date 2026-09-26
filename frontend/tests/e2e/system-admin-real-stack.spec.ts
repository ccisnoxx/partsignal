/** 通过唯一真实栈验证系统管理员、用户生命周期、权限和审计闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';
import {
  createRealStackRuntimeAudit,
  createSystemTrafficScope,
  trafficExpectationErrors,
  type RuntimeCancellation,
} from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type AuditLogDetail = components['schemas']['AuditLogDetail'];
type AuditLogList = components['schemas']['AuditLogList'];
type AuthSession = components['schemas']['AuthSession'];
type CsrfToken = components['schemas']['CsrfToken'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type User = components['schemas']['User'];
type UserBulkStatusResult = components['schemas']['UserBulkStatusResult'];
type UserList = components['schemas']['UserList'];

type JsonResponse = {
  json(): Promise<unknown>;
  status(): number;
  url(): string;
};
type RuntimePhase = {
  current: string;
};

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const frontendBaseUrl = process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:4174';
const adminPassword = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.use({ trace: 'off' });
test.setTimeout(180_000);

function apiUrl(pathname: string) {
  return new URL(pathname, apiBaseUrl).toString();
}

function matchesResponse(response: Response, method: string, pathname: string) {
  return response.request().method() === method && new URL(response.url()).pathname === pathname;
}

async function readJson<T>(response: JsonResponse, status: number, label: string): Promise<T> {
  expect(response.status(), `${label} 应返回 HTTP ${status}`).toBe(status);
  return await response.json() as T;
}

async function requestId(response: Response, label: string) {
  const value = await response.headerValue('x-request-id');
  expect(Boolean(value), `${label} 应返回 X-Request-ID`).toBe(true);
  return value!;
}

async function login(
  page: Page,
  context: BrowserContext,
  username: string,
  password: string,
  { navigate = true }: { navigate?: boolean } = {},
) {
  if (navigate) await page.goto('/login');
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel(/^密码/).fill(password);
  const responsePromise = page.waitForResponse((response) => (
    matchesResponse(response, 'POST', '/api/v1/auth/login')
  ));
  await page.getByRole('button', { name: '登录' }).click();
  const response = await responsePromise;
  const session = await readJson<AuthSession>(response, 200, '登录');
  await registerRealStackLoginSecrets(context, apiBaseUrl, session.csrf_token);
}

function userRow(page: Page, username: string) {
  return page.getByRole('row').filter({ hasText: `@${username}` });
}

function containsSecret(value: string, secrets: ReadonlySet<string>) {
  return Array.from(secrets).some((secret) => secret.length > 0 && value.includes(secret));
}

function assertNoSecrets(values: readonly string[], secrets: ReadonlySet<string>, label: string) {
  expect(values.some((value) => containsSecret(value, secrets)), label).toBe(false);
}

function watchRuntime(
  page: Page,
  phase: RuntimePhase,
  allowedCancellations: readonly RuntimeCancellation[],
) {
  const audit = createRealStackRuntimeAudit({
    apiOrigin: new URL(apiBaseUrl).origin,
    getPhase: () => phase.current,
    allowedCancellations,
    allowedConsoleErrors: [{
      phase: 'reset-invalid-session',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
    }],
    allowedHttpErrors: [{
      phase: 'reset-invalid-session',
      origin: new URL(apiBaseUrl).origin,
      method: 'GET',
      pathname: '/api/v1/auth/session',
      status: 401,
    }],
  });
  audit.watch(page);
  return audit;
}

async function expectForbidden(
  response: JsonResponse,
  label: string,
  safePayloads: string[],
) {
  const body = await readJson<ErrorEnvelope>(response, 403, label);
  safePayloads.push(JSON.stringify(body));
  expect(body.error.code, `${label} 应由服务端拒绝`).toBe('PERMISSION_DENIED');
}

async function browserSurface(page: Page) {
  return `${await page.locator('body').innerText()}\n${page.url()}\n${await page.evaluate(() => JSON.stringify({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
  }))}`;
}

async function showAuditByRequestId(
  page: Page,
  value: string,
  expectedAction: string,
  expectedTargetId: string,
  safePayloads: string[],
) {
  const filterOptionsPromise = page.waitForResponse((response) => (
    matchesResponse(response, 'GET', '/api/v1/audit-logs/filter-options')
  ));
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/v1/audit-logs'
      && url.searchParams.get('request_id') === value;
  });
  await page.goto(`/system/audit?requestId=${encodeURIComponent(value)}`);
  const filterOptionsResponse = await filterOptionsPromise;
  expect(filterOptionsResponse.status(), 'Audit Filter Options 应返回 HTTP 200').toBe(200);
  expect(await filterOptionsResponse.finished(), 'Audit Filter Options 响应应完整结束').toBeNull();
  const body = await readJson<AuditLogList>(await responsePromise, 200, 'Audit List');
  safePayloads.push(JSON.stringify(body));
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({
    action: expectedAction,
    request_id: value,
    target_id: expectedTargetId,
  });
  const row = page.getByRole('row').filter({ hasText: value });
  await expect(row).toHaveCount(1);
  return { body, row };
}

async function showPasswordChangedAudits(
  page: Page,
  targetId: string,
  safePayloads: string[],
) {
  const filterOptionsPromise = page.waitForResponse((response) => (
    matchesResponse(response, 'GET', '/api/v1/audit-logs/filter-options')
  ));
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/v1/audit-logs'
      && url.searchParams.get('action') === 'user.password_changed'
      && url.searchParams.get('target_id') === targetId;
  });
  await page.goto(`/system/audit?action=user.password_changed&targetId=${encodeURIComponent(targetId)}`);
  const filterOptionsResponse = await filterOptionsPromise;
  expect(filterOptionsResponse.status(), 'Audit Filter Options 应返回 HTTP 200').toBe(200);
  expect(await filterOptionsResponse.finished(), 'Audit Filter Options 响应应完整结束').toBeNull();
  const body = await readJson<AuditLogList>(await responsePromise, 200, '改密审计列表');
  safePayloads.push(JSON.stringify(body));
  expect(body.items).toHaveLength(2);
  expect(body.items.every((item) => (
    item.action === 'user.password_changed' && item.target_id === targetId
  ))).toBe(true);
  return body.items;
}

test('当前管理员自降权与自停用通过同一 BrowserContext principal boundary 收敛双页面', async ({
  browser,
  context,
  page: owner,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const backupUsername = `e2e-boundary-admin-${suffix}`;
  const backupInitialPassword = `boundary-initial-${randomUUID()}`;
  const backupPassword = `boundary-active-${randomUUID()}`;
  const phase: RuntimePhase = { current: 'seed-login' };
  const apiOrigin = new URL(apiBaseUrl).origin;
  const runtimeAudit = createRealStackRuntimeAudit({
    apiOrigin,
    getPhase: () => phase.current,
    allowedCancellations: [{
      phase: 'seed-relogin',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/workbench',
      reason: 'net::ERR_ABORTED',
    }, {
      phase: 'bulk-self-disable-response-lost',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/users/bulk-status',
      reason: 'net::ERR_FAILED',
    }],
    allowedConsoleErrors: [{
      phase: 'self-disable',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
    }, {
      phase: 'bulk-self-disable-response-lost',
      text: 'Failed to load resource: net::ERR_FAILED',
    }, {
      phase: 'bulk-self-disable-response-lost',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
    }],
    allowedHttpErrors: [{
      phase: 'self-disable',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/auth/session',
      status: 401,
    }, {
      phase: 'bulk-self-disable-response-lost',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/auth/session',
      status: 401,
    }],
  });
  let observer: Page | undefined;
  let backupContext: BrowserContext | undefined;
  let backupPage: Page | undefined;
  let cleanupContext: BrowserContext | undefined;
  let backupUser: User | undefined;

  await registerArtifactSecrets([adminPassword, backupInitialPassword, backupPassword]);
  runtimeAudit.watch(owner);

  async function csrfToken(target: BrowserContext, label: string) {
    const token = await readJson<CsrfToken>(
      await target.request.get(apiUrl('/api/v1/auth/csrf')),
      200,
      label,
    );
    await registerArtifactSecrets([token.csrf_token]);
    return token.csrf_token;
  }

  async function updateSeedAdmin(target: BrowserContext, current: User, values: {
    account_type: 'ADMIN' | 'ENGINEER';
    is_active: boolean;
  }) {
    return readJson<User>(await target.request.patch(apiUrl(`/api/v1/users/${current.id}`), {
      data: {
        account_type: values.account_type,
        display_name: current.display_name,
        expected_revision: current.revision,
        is_active: values.is_active,
      },
      headers: { 'X-CSRF-Token': await csrfToken(target, '恢复用户 CSRF') },
    }), 200, '恢复 seed ADMIN');
  }

  try {
    await login(owner, context, 'admin', adminPassword);
    await expect(owner).toHaveURL('/');
    await expect(owner.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    const seedAdmin = await readJson<User>(
      await context.request.get(apiUrl('/api/v1/auth/me')),
      200,
      'seed ADMIN',
    );
    backupUser = await readJson<User>(await context.request.post(apiUrl('/api/v1/users'), {
      data: {
        account_type: 'ADMIN',
        display_name: `Boundary backup ${suffix}`,
        temporary_password: backupInitialPassword,
        username: backupUsername,
      },
      headers: { 'X-CSRF-Token': await csrfToken(context, '创建 backup ADMIN CSRF') },
    }), 201, '创建 backup ADMIN');

    backupContext = await browser.newContext({
      baseURL: frontendBaseUrl,
      viewport: { height: 900, width: 1440 },
    });
    backupPage = await backupContext.newPage();
    await login(backupPage, backupContext, backupUsername, backupInitialPassword);
    await expect(backupPage).toHaveURL('/account/security');
    await backupPage.getByLabel(/^当前密码/).fill(backupInitialPassword);
    await backupPage.getByLabel(/^新密码/).fill(backupPassword);
    await backupPage.getByRole('button', { name: '确认修改' }).click();
    await expect(backupPage).toHaveURL('/');

    observer = await context.newPage();
    runtimeAudit.watch(observer);
    await Promise.all([
      owner.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
      observer.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
    ]);
    await expect(userRow(owner, 'admin')).toHaveCount(1);
    await expect(userRow(observer, 'admin')).toHaveCount(1);

    phase.current = 'self-downgrade';
    const seedRow = userRow(owner, 'admin');
    await seedRow.getByRole('button', { name: '管理用户' }).click();
    const editDialog = owner.getByRole('dialog', { name: '编辑用户 admin' });
    await editDialog.getByRole('combobox', { name: '账号类型' }).click();
    await owner.getByRole('option', { name: 'ENGINEER' }).click();
    const downgradeResponsePromise = owner.waitForResponse((response) => (
      matchesResponse(response, 'PATCH', `/api/v1/users/${seedAdmin.id}`)
    ));
    await editDialog.getByRole('button', { name: '保存修改' }).click();
    const downgraded = await readJson<User>(await downgradeResponsePromise, 200, '当前管理员自降权');
    expect(downgraded.account_type).toBe('ENGINEER');

    for (const target of [owner, observer]) {
      await expect(target.getByRole('heading', { name: '无权访问系统管理' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(target.getByRole('heading', { level: 1, name: '用户管理' })).toHaveCount(0);
    }

    const downgradeReads = runtimeAudit.responses.filter((item) => (
      item.phase === 'self-downgrade'
      && item.origin === apiOrigin
      && item.method === 'GET'
      && item.pathname === '/api/v1/auth/session'
      && item.status === 200
    ));
    expect(downgradeReads, '自降权后发送页与观察页应各做一次 canonical recovery').toHaveLength(2);

    const restored = await updateSeedAdmin(backupContext, downgraded, {
      account_type: 'ADMIN',
      is_active: true,
    });

    await context.clearCookies();
    await Promise.all([owner.goto('/login'), observer.goto('/login')]);
    phase.current = 'seed-relogin';
    await login(owner, context, 'admin', adminPassword, { navigate: false });
    await expect(owner).toHaveURL('/');
    await expect(observer).toHaveURL('/');
    await Promise.all([
      owner.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
      observer.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
    ]);
    await expect(userRow(owner, 'admin')).toHaveCount(1);
    await expect(userRow(observer, 'admin')).toHaveCount(1);

    phase.current = 'bulk-self-disable-response-lost';
    let bulkCommittedUser: User | undefined;
    let resolveBulkCommitted!: () => void;
    const bulkCommitted = new Promise<void>((resolve) => {
      resolveBulkCommitted = resolve;
    });
    await owner.route('**/api/v1/users/bulk-status', async (route) => {
      const response = await route.fetch();
      const result = await readJson<UserBulkStatusResult>(response, 200, '当前管理员批量自停用');
      bulkCommittedUser = result.succeeded.find((user) => user.id === seedAdmin.id);
      expect(bulkCommittedUser, '真实服务端必须已提交当前管理员批量自停用').toBeDefined();
      resolveBulkCommitted();
      await route.abort('failed');
    });
    await owner.getByRole('checkbox', { name: '选择用户 admin' }).check();
    await owner.getByRole('button', { name: '批量停用' }).click();
    const bulkDisableDialog = owner.getByRole('dialog', { name: '批量停用 1 个用户？' });
    await bulkDisableDialog.getByRole('button', { name: '批量停用' }).click();
    await bulkCommitted;

    for (const target of [owner, observer]) {
      await expect(target).toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
      await expect(target.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
      await expect(target.getByRole('heading', { level: 1, name: '用户管理' })).toHaveCount(0);
    }
    const bulkAttempts = runtimeAudit.attempts.filter((item) => (
      item.phase === 'bulk-self-disable-response-lost'
      && item.origin === apiOrigin
      && item.method === 'POST'
      && item.pathname === '/api/v1/users/bulk-status'
    ));
    const bulkResponses = runtimeAudit.responses.filter((item) => (
      item.phase === 'bulk-self-disable-response-lost'
      && item.origin === apiOrigin
      && item.method === 'POST'
      && item.pathname === '/api/v1/users/bulk-status'
    ));
    const bulkRecoveryAttempts = runtimeAudit.attempts.filter((item) => (
      item.phase === 'bulk-self-disable-response-lost'
      && item.origin === apiOrigin
      && item.method === 'GET'
      && item.pathname === '/api/v1/auth/session'
    ));
    const bulkRecoveryResponses = runtimeAudit.responses.filter((item) => (
      item.phase === 'bulk-self-disable-response-lost'
      && item.origin === apiOrigin
      && item.method === 'GET'
      && item.pathname === '/api/v1/auth/session'
      && item.status === 401
    ));
    expect(bulkAttempts, 'bulk self-disable 只能提交一次').toHaveLength(1);
    expect(bulkResponses, '丢失的 bulk 响应不得被浏览器消费').toHaveLength(0);
    expect(bulkRecoveryAttempts, '发送页与观察页应各发出一次 canonical recovery').toHaveLength(2);
    expect(bulkRecoveryResponses, '两页 recovery 都应确认旧 session 已撤销').toHaveLength(2);
    expect(runtimeAudit.errors, 'bulk unknown outcome 不得产生请求风暴或未声明错误').toEqual([]);
    await owner.unroute('**/api/v1/users/bulk-status');

    const restoredAfterBulk = await updateSeedAdmin(backupContext, bulkCommittedUser!, {
      account_type: 'ADMIN',
      is_active: true,
    });
    await context.clearCookies();
    await Promise.all([owner.goto('/login'), observer.goto('/login')]);
    phase.current = 'seed-relogin';
    await login(owner, context, 'admin', adminPassword, { navigate: false });
    await expect(owner).toHaveURL('/');
    await expect(observer).toHaveURL('/');
    await Promise.all([
      owner.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
      observer.goto('/system/users?status=ENABLED&page=1&pageSize=20'),
    ]);
    await expect(userRow(owner, 'admin')).toHaveCount(1);
    await expect(userRow(observer, 'admin')).toHaveCount(1);
    expect(restoredAfterBulk.is_active).toBe(true);

    phase.current = 'self-disable';
    await userRow(owner, 'admin').getByRole('button', { name: '更多操作：admin' }).click();
    await owner.getByRole('menuitem', { name: '停用用户' }).click();
    const disableDialog = owner.getByRole('dialog', { name: '停用用户“admin”？' });
    const disableResponsePromise = owner.waitForResponse((response) => (
      matchesResponse(response, 'PATCH', `/api/v1/users/${seedAdmin.id}`)
    ));
    await disableDialog.getByRole('button', { name: '停用用户' }).click();
    const disabled = await readJson<User>(await disableResponsePromise, 200, '当前管理员自停用');
    expect(disabled.is_active).toBe(false);

    for (const target of [owner, observer]) {
      await expect(target).toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
      await expect(target.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
    }
    const disableReads = runtimeAudit.responses.filter((item) => (
      item.phase === 'self-disable'
      && item.origin === apiOrigin
      && item.method === 'GET'
      && item.pathname === '/api/v1/auth/session'
      && item.status === 401
    ));
    expect(disableReads, '自停用后发送页与观察页应各做一次 canonical recovery').toHaveLength(2);
    expect(runtimeAudit.attempts.filter((item) => (
      item.phase === 'self-disable'
      && item.origin === apiOrigin
      && item.method === 'PATCH'
      && item.pathname === `/api/v1/users/${seedAdmin.id}`
    ))).toHaveLength(1);
    expect(runtimeAudit.errors, '自权限边界不得出现未声明错误或请求风暴').toEqual([]);

    await updateSeedAdmin(backupContext, disabled, { account_type: 'ADMIN', is_active: true });
    cleanupContext = await browser.newContext({ baseURL: frontendBaseUrl });
    const cleanupPage = await cleanupContext.newPage();
    await login(cleanupPage, cleanupContext, 'admin', adminPassword);
    const cleanupCsrf = await csrfToken(cleanupContext, '删除 backup ADMIN CSRF');
    const cleanupUsers = await readJson<UserList>(await cleanupContext.request.get(
      apiUrl(`/api/v1/users?q=${encodeURIComponent(backupUsername)}&page=1&page_size=20`),
    ), 200, '删除 backup ADMIN 前读取最新 revision');
    const latestBackup = cleanupUsers.items.find((user) => user.id === backupUser!.id);
    expect(latestBackup, '删除前必须找到 backup ADMIN 最新 projection').toBeDefined();
    const disabledBackup = await readJson<User>(await cleanupContext.request.patch(
      apiUrl(`/api/v1/users/${backupUser.id}`),
      {
        data: {
          account_type: latestBackup!.account_type,
          display_name: latestBackup!.display_name,
          expected_revision: latestBackup!.revision,
          is_active: false,
        },
        headers: { 'X-CSRF-Token': cleanupCsrf },
      },
    ), 200, '停用 backup ADMIN');
    expect((await cleanupContext.request.delete(
      apiUrl(`/api/v1/users/${backupUser.id}?expected_revision=${disabledBackup.revision}`),
      { headers: { 'X-CSRF-Token': cleanupCsrf } },
    )).status(), 'backup ADMIN 应被精确删除').toBe(204);
    backupUser = undefined;
    expect(restored.account_type).toBe('ADMIN');
  } finally {
    if (backupUser && backupContext) {
      const users = await readJson<UserList>(await backupContext.request.get(
        apiUrl('/api/v1/users?page=1&page_size=20'),
      ), 200, '恢复检查用户列表');
      const seed = users.items.find((user) => user.username === 'admin');
      if (seed && (seed.account_type !== 'ADMIN' || !seed.is_active)) {
        await updateSeedAdmin(backupContext, seed, { account_type: 'ADMIN', is_active: true });
      }

      await cleanupContext?.close();
      cleanupContext = await browser.newContext({ baseURL: frontendBaseUrl });
      const cleanupPage = await cleanupContext.newPage();
      await login(cleanupPage, cleanupContext, 'admin', adminPassword);
      const latestUsers = await readJson<UserList>(await cleanupContext.request.get(
        apiUrl(`/api/v1/users?q=${encodeURIComponent(backupUsername)}&page=1&page_size=20`),
      ), 200, 'backup ADMIN 清理列表');
      const latestBackup = latestUsers.items.find((user) => user.id === backupUser!.id);
      if (latestBackup) {
        const cleanupCsrf = await csrfToken(cleanupContext, '回收 backup ADMIN CSRF');
        const disabledBackup = latestBackup.is_active
          ? await readJson<User>(await cleanupContext.request.patch(
            apiUrl(`/api/v1/users/${latestBackup.id}`),
            {
              data: {
                account_type: latestBackup.account_type,
                display_name: latestBackup.display_name,
                expected_revision: latestBackup.revision,
                is_active: false,
              },
              headers: { 'X-CSRF-Token': cleanupCsrf },
            },
          ), 200, '回收时停用 backup ADMIN')
          : latestBackup;
        expect((await cleanupContext.request.delete(
          apiUrl(`/api/v1/users/${disabledBackup.id}?expected_revision=${disabledBackup.revision}`),
          { headers: { 'X-CSRF-Token': cleanupCsrf } },
        )).status(), '失败路径也必须回收 backup ADMIN').toBe(204);
      }
      backupUser = undefined;
    }
    await registerCurrentRealStackCookies(context, apiBaseUrl);
    if (backupContext) await registerCurrentRealStackCookies(backupContext, apiBaseUrl);
    if (cleanupContext) await registerCurrentRealStackCookies(cleanupContext, apiBaseUrl);
    await observer?.close();
    await backupContext?.close();
    await cleanupContext?.close();
  }
});

test('System Admin 真实栈完成用户、权限、会话与审计闭环', async ({
  browser,
  context,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const username = `e2e-engineer-${suffix}`;
  const createPassword = `create-${randomUUID()}`;
  const changedPassword = `changed-${randomUUID()}`;
  const resetPassword = `reset-${randomUUID()}`;
  const recoveredPassword = `recovered-${randomUUID()}`;
  const secrets = new Set([
    adminPassword, createPassword, changedPassword, resetPassword, recoveredPassword,
  ]);
  const safePayloads: string[] = [];
  const browserValues: string[] = [];
  const adminRuntimePhase: RuntimePhase = {
    current: 'admin-login',
  };
  const engineerRuntimePhase: RuntimePhase = {
    current: 'engineer-login',
  };
  const apiOrigin = new URL(apiBaseUrl).origin;
  const adminAllowedCancellations: RuntimeCancellation[] = [
    {
      phase: 'admin-login',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/workbench',
      reason: 'net::ERR_ABORTED',
    },
    {
      phase: 'admin-users-initial',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/users',
      reason: 'net::ERR_ABORTED',
    },
  ];
  const engineerAllowedCancellations: RuntimeCancellation[] = [
    {
      phase: 'engineer-first-change',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/auth/change-password',
      reason: 'net::ERR_ABORTED',
    },
    {
      phase: 'engineer-system-users',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/workbench',
      reason: 'net::ERR_ABORTED',
    },
    {
      phase: 'reset-invalid-session',
      origin: apiOrigin,
      method: 'GET',
      pathname: '/api/v1/workbench',
      reason: 'net::ERR_ABORTED',
    },
    {
      phase: 'engineer-recovered-change',
      origin: apiOrigin,
      method: 'POST',
      pathname: '/api/v1/auth/change-password',
      reason: 'net::ERR_ABORTED',
    },
  ];
  let engineerContext: BrowserContext | undefined;
  let engineerPage: Page | undefined;

  await registerArtifactSecrets(Array.from(secrets));
  const adminRuntime = watchRuntime(page, adminRuntimePhase, adminAllowedCancellations);
  let engineerRuntime: ReturnType<typeof watchRuntime> | undefined;

  try {
    await login(page, context, 'admin', adminPassword);
    await expect(page).toHaveURL('/');

    adminRuntimePhase.current = 'admin-users-initial';
    const initialUsersPromise = page.waitForResponse((response) => (
      matchesResponse(response, 'GET', '/api/v1/users')
    ));
    await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
    const initialUsers = await readJson<UserList>(await initialUsersPromise, 200, '初始用户列表');
    safePayloads.push(JSON.stringify(initialUsers));
    const admin = initialUsers.items.find((user) => user.username === 'admin');
    expect(Boolean(admin), 'seed ADMIN 应存在').toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: '用户管理' })).toBeVisible();

    await page.getByRole('button', { name: '新增用户' }).click();
    const createDialog = page.getByRole('dialog', { name: '新增用户' });
    await createDialog.getByLabel('用户名').fill(username);
    await createDialog.getByLabel('显示名称').fill(`E2E 工程师 ${suffix}`);
    await createDialog.getByLabel('临时密码').fill(createPassword);
    const createResponsePromise = page.waitForResponse((response) => (
      matchesResponse(response, 'POST', '/api/v1/users')
    ));
    await createDialog.getByRole('button', { name: '创建用户' }).click();
    const createResponse = await createResponsePromise;
    const created = await readJson<User>(createResponse, 201, '创建用户');
    const createRequestId = await requestId(createResponse, '创建用户');
    safePayloads.push(JSON.stringify(created));
    expect(created).toMatchObject({
      username,
      account_type: 'ENGINEER',
      is_active: true,
      must_change_password: true,
    });
    await expect(userRow(page, username)).toHaveCount(1);

    const adminCsrf = await readJson<CsrfToken>(
      await context.request.get(apiUrl('/api/v1/auth/csrf')),
      200,
      'ADMIN CSRF',
    );
    secrets.add(adminCsrf.csrf_token);
    await registerArtifactSecrets([adminCsrf.csrf_token]);
    const createAuditQuery = new URLSearchParams({
      page: '1',
      page_size: '20',
      request_id: createRequestId,
    });
    const createAuditList = await readJson<AuditLogList>(
      await context.request.get(apiUrl(`/api/v1/audit-logs?${createAuditQuery}`)),
      200,
      '创建用户审计',
    );
    safePayloads.push(JSON.stringify(createAuditList));
    expect(createAuditList.items).toHaveLength(1);
    const createAuditId = createAuditList.items[0]!.id;

    engineerContext = await browser.newContext({
      baseURL: frontendBaseUrl,
      viewport: { width: 1440, height: 900 },
    });
    engineerPage = await engineerContext.newPage();
    engineerRuntime = watchRuntime(
      engineerPage,
      engineerRuntimePhase,
      engineerAllowedCancellations,
    );
    await login(engineerPage, engineerContext, username, createPassword);
    await expect(engineerPage).toHaveURL('/account/security');
    await expect(engineerPage.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();

    const engineerCsrf = await readJson<CsrfToken>(
      await engineerContext.request.get(apiUrl('/api/v1/auth/csrf')),
      200,
      'ENGINEER CSRF',
    );
    secrets.add(engineerCsrf.csrf_token);
    await registerArtifactSecrets([engineerCsrf.csrf_token]);
    await engineerPage.getByLabel(/^当前密码/).fill(createPassword);
    await engineerPage.getByLabel(/^新密码/).fill(changedPassword);
    engineerRuntimePhase.current = 'engineer-first-change';
    const changeResponsePromise = engineerPage.waitForResponse((response) => (
      matchesResponse(response, 'POST', '/api/v1/auth/change-password')
    ));
    await engineerPage.getByRole('button', { name: '确认修改' }).click();
    expect((await changeResponsePromise).status(), '首次改密应成功').toBe(204);
    await expect(engineerPage).toHaveURL('/');
    await expect(engineerPage.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    const engineerUser = await readJson<User>(
      await engineerContext.request.get(apiUrl('/api/v1/auth/me')),
      200,
      '改密后 canonical session',
    );
    safePayloads.push(JSON.stringify(engineerUser));
    expect(engineerUser.must_change_password).toBe(false);
    expect(engineerUser.revision).toBeGreaterThan(created.revision);
    await expect(engineerPage.getByText('系统管理', { exact: true })).toHaveCount(0);
    await expect(engineerPage.getByRole('link', { name: '用户管理' })).toHaveCount(0);
    await expect(engineerPage.getByRole('link', { name: '系统审计' })).toHaveCount(0);

    const forbiddenPaths = ['/system/users', '/system/audit'];
    for (const pathname of forbiddenPaths) {
      engineerRuntimePhase.current = pathname === '/system/users'
        ? 'engineer-system-users'
        : 'engineer-system-audit';
      await engineerPage.goto(pathname);
      expect(new URL(engineerPage.url()).pathname).toBe(pathname);
      const forbidden = engineerPage.getByRole('heading', { name: '无权访问系统管理' });
      await expect(forbidden).toBeVisible();
      await expect(forbidden.locator('xpath=ancestor::section[1]')).toBeFocused();
    }

    await expectForbidden(
      await engineerContext.request.get(apiUrl('/api/v1/users')),
      'ENGINEER Users List',
      safePayloads,
    );
    await expectForbidden(
      await engineerContext.request.post(apiUrl('/api/v1/users/bulk-status'), {
        data: {
          items: [{ user_id: created.id, expected_revision: engineerUser.revision }],
          status: 'DISABLED',
        },
        headers: { 'X-CSRF-Token': engineerCsrf.csrf_token },
      }),
      'ENGINEER Users Bulk Status',
      safePayloads,
    );
    await expectForbidden(
      await engineerContext.request.get(apiUrl('/api/v1/users/export')),
      'ENGINEER Users Export',
      safePayloads,
    );
    await expectForbidden(
      await engineerContext.request.get(apiUrl('/api/v1/audit-logs')),
      'ENGINEER Audit List',
      safePayloads,
    );
    await expectForbidden(
      await engineerContext.request.get(apiUrl('/api/v1/audit-logs/filter-options')),
      'ENGINEER Audit Filter Options',
      safePayloads,
    );
    await expectForbidden(
      await engineerContext.request.get(apiUrl(`/api/v1/audit-logs/${createAuditId}`)),
      'ENGINEER Audit Detail',
      safePayloads,
    );

    const engineerCookiesBeforeReset = await engineerContext.cookies(apiBaseUrl);
    const oldEngineerSession = engineerCookiesBeforeReset.find((cookie) => (
      cookie.name === 'partsignal_session'
    ));
    expect(Boolean(oldEngineerSession), '重置前应存在 ENGINEER session Cookie').toBe(true);
    for (const cookie of engineerCookiesBeforeReset) {
      if (cookie.value) secrets.add(cookie.value);
    }
    await registerArtifactSecrets(engineerCookiesBeforeReset.map((cookie) => cookie.value));

    await page.bringToFront();
    await page.reload();
    const currentRow = userRow(page, username);
    await expect(currentRow).toHaveCount(1);
    await currentRow.getByRole('button', { name: `更多操作：${username}` }).click();
    await page.getByRole('menuitem', { name: '重置临时密码' }).click();
    const resetDialog = page.getByRole('dialog', { name: `重置 ${username} 的临时密码` });
    await resetDialog.getByLabel('临时密码').fill(resetPassword);
    const resetResponsePromise = page.waitForResponse((response) => (
      matchesResponse(response, 'POST', `/api/v1/users/${created.id}/reset-password`)
    ));
    await resetDialog.getByRole('button', { name: '重置临时密码' }).click();
    const resetResponse = await resetResponsePromise;
    const resetUser = await readJson<User>(resetResponse, 200, '重置临时密码');
    const resetRequestId = await requestId(resetResponse, '重置临时密码');
    safePayloads.push(JSON.stringify(resetUser));
    expect(resetUser.must_change_password).toBe(true);
    expect(resetUser.revision).toBeGreaterThan(engineerUser.revision);
    await expect(resetDialog).toHaveCount(0);

    const invalidSession = await engineerContext.request.get(apiUrl('/api/v1/auth/me'));
    const invalidSessionBody = await readJson<ErrorEnvelope>(invalidSession, 401, '重置后的旧会话');
    safePayloads.push(JSON.stringify(invalidSessionBody));
    expect(invalidSessionBody.error.code).toBe('AUTH_REQUIRED');

    engineerRuntimePhase.current = 'reset-invalid-session';
    await engineerPage.reload();
    await expect(engineerPage).toHaveURL(/\/login(?:\?|$)/);
    await expect(engineerPage.getByRole('heading', { name: '登录' })).toBeVisible();
    await expect(engineerPage.getByRole('alert')).toHaveCount(0);

    await login(engineerPage, engineerContext, username, resetPassword, { navigate: false });
    engineerRuntimePhase.current = 'engineer-reset-login';
    await expect(engineerPage).toHaveURL('/account/security');
    await expect(engineerPage.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();
    await engineerPage.getByLabel(/^当前密码/).fill(resetPassword);
    await engineerPage.getByLabel(/^新密码/).fill(recoveredPassword);
    engineerRuntimePhase.current = 'engineer-recovered-change';
    const recoveredChangePromise = engineerPage.waitForResponse((response) => (
      matchesResponse(response, 'POST', '/api/v1/auth/change-password')
    ));
    await engineerPage.getByRole('button', { name: '确认修改' }).click();
    expect((await recoveredChangePromise).status(), '重置后强制改密应成功').toBe(204);
    await expect(engineerPage).toHaveURL('/');
    await expect(engineerPage.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    const recoveredEngineer = await readJson<User>(
      await engineerContext.request.get(apiUrl('/api/v1/auth/me')),
      200,
      '重置后 canonical session',
    );
    safePayloads.push(JSON.stringify(recoveredEngineer));
    expect(recoveredEngineer.must_change_password).toBe(false);
    expect(recoveredEngineer.revision).toBeGreaterThan(resetUser.revision);

    const usersAfterRecoveryPromise = page.waitForResponse((response) => (
      matchesResponse(response, 'GET', '/api/v1/users')
    ));
    await page.reload();
    const usersAfterRecovery = await readJson<UserList>(
      await usersAfterRecoveryPromise,
      200,
      '重置恢复后用户列表',
    );
    safePayloads.push(JSON.stringify(usersAfterRecovery));
    expect(usersAfterRecovery.items.find((user) => user.id === created.id)?.revision).toBe(
      recoveredEngineer.revision,
    );

    await expect(page.getByRole('checkbox', { name: `选择用户 ${username}` })).toBeVisible();
    await page.getByRole('checkbox', { name: `选择用户 ${username}` }).check();
    await page.getByRole('checkbox', { name: '选择用户 admin' }).check();
    await page.getByRole('button', { name: '批量停用' }).click();
    const bulkDialog = page.getByRole('dialog', { name: '批量停用 2 个用户？' });
    const bulkResponsePromise = page.waitForResponse((response) => (
      matchesResponse(response, 'POST', '/api/v1/users/bulk-status')
    ));
    await bulkDialog.getByRole('button', { name: '批量停用' }).click();
    const bulkResponse = await bulkResponsePromise;
    const bulkResult = await readJson<UserBulkStatusResult>(bulkResponse, 200, '批量停用');
    const bulkRequestId = await requestId(bulkResponse, '批量停用');
    safePayloads.push(JSON.stringify(bulkResult));
    expect(bulkResult.succeeded.map((user) => user.id)).toEqual([created.id]);
    expect(bulkResult.failures).toEqual([{
      user_id: admin!.id,
      code: 'LAST_ADMIN_REQUIRED',
      message: '系统必须保留至少一个有效管理员',
    }]);
    const bulkStatus = page.getByRole('status');
    await expect(bulkStatus).toContainText('批量操作完成：成功 1，失败 1');
    await expect(bulkStatus).toContainText('LAST_ADMIN_REQUIRED');

    const currentAdmin = await readJson<User>(
      await context.request.get(apiUrl('/api/v1/auth/me')),
      200,
      '批量操作后的 ADMIN session',
    );
    safePayloads.push(JSON.stringify(currentAdmin));
    expect(currentAdmin).toMatchObject({ account_type: 'ADMIN', is_active: true });

    const detailPaths: string[] = [];
    const recordDetailPath = (response: Response) => {
      const pathname = new URL(response.url()).pathname;
      if (response.request().method() === 'GET' && /^\/api\/v1\/audit-logs\/[0-9a-f-]{36}$/.test(pathname)) {
        detailPaths.push(pathname);
      }
    };
    page.on('response', recordDetailPath);
    const createdAudit = await showAuditByRequestId(
      page,
      createRequestId,
      'user.created',
      created.id,
      safePayloads,
    );
    expect(createdAudit.body.items[0]!.id).toBe(createAuditId);
    await expect(page.locator('thead th')).toHaveText([
      '时间', '操作者', '模块', '动作', '对象', '结果', 'Request ID',
    ]);
    await expect(page.getByRole('columnheader', { name: '操作', exact: true })).toHaveCount(0);
    expect(detailPaths).toEqual([]);
    const detailResponsePromise = page.waitForResponse((response) => (
      matchesResponse(response, 'GET', `/api/v1/audit-logs/${createAuditId}`)
    ));
    await createdAudit.row.click();
    const detailBody = await readJson<AuditLogDetail>(await detailResponsePromise, 200, '创建用户审计详情');
    safePayloads.push(JSON.stringify(detailBody));
    expect(detailBody).toMatchObject({
      id: createAuditId,
      request_id: createRequestId,
      target_id: created.id,
    });
    expect(detailPaths).toEqual([`/api/v1/audit-logs/${createAuditId}`]);
    const detail = page.getByRole('complementary', { name: '审计详情' });
    await expect(detail).toContainText(createRequestId);
    await expect(detail).toContainText(created.id);
    page.off('response', recordDetailPath);

    await showAuditByRequestId(
      page,
      resetRequestId,
      'user.password_reset',
      created.id,
      safePayloads,
    );
    const bulkAudit = await showAuditByRequestId(
      page,
      bulkRequestId,
      'user.updated',
      created.id,
      safePayloads,
    );
    expect(bulkAudit.body.items.some((log) => log.target_id === admin!.id)).toBe(false);

    const auditsBeforeDelete = await showPasswordChangedAudits(page, created.id, safePayloads);
    expect(auditsBeforeDelete.every((audit) => audit.actor?.id === created.id)).toBe(true);

    const disabledUsersPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === '/api/v1/users'
        && url.searchParams.get('status') === 'DISABLED';
    });
    await page.goto(`/system/users?status=DISABLED&q=${encodeURIComponent(username)}&page=1&pageSize=20`);
    safePayloads.push(JSON.stringify(
      await readJson<UserList>(await disabledUsersPromise, 200, '停用用户列表'),
    ));
    const disabledRow = userRow(page, username);
    await expect(disabledRow).toHaveCount(1);
    await disabledRow.getByRole('button', { name: `更多操作：${username}` }).click();
    await page.getByRole('menuitem', { name: '删除用户' }).click();
    const deleteDialog = page.getByRole('dialog', { name: `删除用户“${username}”？` });
    adminRuntimePhase.current = 'delete-user';
    adminAllowedCancellations.push({
      phase: 'delete-user',
      origin: apiOrigin,
      method: 'DELETE',
      pathname: `/api/v1/users/${created.id}`,
      reason: 'net::ERR_ABORTED',
    });
    const deleteResponsePromise = page.waitForResponse((response) => (
      matchesResponse(response, 'DELETE', `/api/v1/users/${created.id}`)
    ));
    await deleteDialog.getByRole('button', { name: '删除用户' }).click();
    expect((await deleteResponsePromise).status(), '删除临时用户应成功').toBe(204);
    await expect(userRow(page, username)).toHaveCount(0);

    const auditsAfterDelete = await showPasswordChangedAudits(page, created.id, safePayloads);
    expect(auditsAfterDelete.map((audit) => audit.id).sort()).toEqual(
      auditsBeforeDelete.map((audit) => audit.id).sort(),
    );
    expect(auditsAfterDelete.every((audit) => (
      audit.actor_id === null && audit.actor === null
    ))).toBe(true);
    for (const audit of auditsAfterDelete) {
      await expect(page.getByRole('row').filter({ hasText: audit.request_id })).toContainText('用户已删除/未记录');
    }

    const runtimeAudits = [adminRuntime, engineerRuntime!];
    const attempts = runtimeAudits.flatMap((audit) => audit.attempts);
    const responses = runtimeAudits.flatMap((audit) => audit.responses);
    expect(trafficExpectationErrors(attempts, responses, [
      {
        phase: 'admin-login',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'engineer-login',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'reset-invalid-session',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/auth/session',
        status: 401,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'reset-invalid-session',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'engineer-first-change',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/change-password',
        status: 204,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'engineer-recovered-change',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/change-password',
        status: 204,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/users',
        status: 201,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'POST',
        pathname: `/api/v1/users/${created.id}/reset-password`,
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/users/bulk-status',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'delete-user',
        origin: apiOrigin,
        method: 'DELETE',
        pathname: `/api/v1/users/${created.id}`,
        status: 204,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/audit-logs',
        status: 200,
        attempts: 4,
        responses: 4,
      },
      {
        phase: 'delete-user',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/audit-logs',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/audit-logs/filter-options',
        status: 200,
        attempts: 4,
        responses: 4,
      },
      {
        phase: 'delete-user',
        origin: apiOrigin,
        method: 'GET',
        pathname: '/api/v1/audit-logs/filter-options',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'admin-users-initial',
        origin: apiOrigin,
        method: 'GET',
        pathname: `/api/v1/audit-logs/${createAuditId}`,
        status: 200,
        attempts: 1,
        responses: 1,
      },
    ], createSystemTrafficScope(apiOrigin)),
    'System mutation 与全部 Audit path 的 phase/attempt/response multiset 必须精确').toEqual([]);

    browserValues.push(await browserSurface(page), await browserSurface(engineerPage));
    const runtimeValues = runtimeAudits.flatMap((audit) => audit.rawValues);
    const runtimeErrors = runtimeAudits.flatMap((audit) => audit.errors);
    assertNoSecrets(safePayloads, secrets, '安全响应不得包含密码或会话敏感值');
    assertNoSecrets(browserValues, secrets, 'DOM、URL 和 Web Storage 不得包含敏感值');
    assertNoSecrets(runtimeValues, secrets, '浏览器输出不得包含敏感值');
    expect([...safePayloads, ...browserValues].some((value) => value.includes('change_summary')), '安全投影不得包含 raw change_summary').toBe(false);
    expect(runtimeErrors, '真实栈不得出现未捕获异常或失败资源').toEqual([]);
  } finally {
    for (const owner of [context, engineerContext]) {
      if (!owner) continue;
      for (const value of await registerCurrentRealStackCookies(owner, apiBaseUrl)) {
        secrets.add(value);
      }
    }
    for (const ownerPage of [page, engineerPage]) {
      if (ownerPage && !ownerPage.isClosed()) browserValues.push(await browserSurface(ownerPage));
    }
    const finalRuntimeValues = [adminRuntime, ...(engineerRuntime ? [engineerRuntime] : [])]
      .flatMap((audit) => audit.rawValues);
    assertNoSecrets(safePayloads, secrets, '安全响应不得包含 Cookie 或 CSRF');
    assertNoSecrets(browserValues, secrets, 'DOM、URL 和 Web Storage 不得包含 Cookie 或 CSRF');
    assertNoSecrets(finalRuntimeValues, secrets, '浏览器输出不得包含 Cookie 或 CSRF');
    await engineerContext?.close();
  }
});
