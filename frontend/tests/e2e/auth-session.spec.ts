import { expect, test as base, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import type { components } from '../../src/shared/api/generated/schema';
import { expectSecretsAbsent } from './secret-artifact';
import { emptyAggregate } from './fixtures/workbench.fixture';

type AuthUser = components['schemas']['User'];
type AuthFixture = {
  authApi: undefined;
};

const initialPassword = 'auth-fixture-old-password';
const firstNewPassword = 'auth-fixture-new-password';
const secondNewPassword = 'auth-fixture-next-password';
const csrfToken = 'auth-fixture-csrf';
const securityHeaders = readFileSync(
  fileURLToPath(new URL('../../../deploy/nginx/partsignal-security-headers.conf', import.meta.url)),
  'utf8',
);
const productionCsp = securityHeaders.match(
  /^add_header Content-Security-Policy "([^"]+)" always;$/m,
)?.[1];
if (!productionCsp) throw new Error('无法从权威 Nginx snippet 读取生产 CSP');

const engineer: AuthUser = {
  id: '00000000-0000-4000-8000-000000000002',
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: true,
  workflow_stage: 'FIRST_PASSWORD_CHANGE',
  primary_task: 'MANAGE_LOGIN_SECURITY',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
};

const test = base.extend<AuthFixture>({
  authApi: [async ({ page }, use) => {
    const unexpectedRequests: string[] = [];
    let currentUser: AuthUser | null = null;
    let currentPassword = initialPassword;

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();

      if (method === 'GET' && pathname === '/api/v1/auth/me') {
        await route.fulfill(currentUser
          ? { status: 200, json: currentUser }
          : { status: 204, body: '' });
        return;
      }
      if (method === 'GET' && pathname === '/api/v1/auth/csrf' && currentUser) {
        await route.fulfill({ status: 200, json: { csrf_token: csrfToken } });
        return;
      }
      if (method === 'GET' && pathname === '/api/v1/workbench') {
        await route.fulfill({ status: 200, json: emptyAggregate });
        return;
      }
      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = request.postDataJSON() as { username?: string; password?: string };
        if (body.username !== engineer.username || body.password !== currentPassword) {
          await route.fulfill({
            status: 401,
            json: { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误', details: {}, request_id: 'req-auth-login' } },
          });
          return;
        }
        currentUser = { ...engineer, must_change_password: currentPassword === initialPassword };
        await route.fulfill({ status: 200, json: { user: currentUser, csrf_token: csrfToken } });
        return;
      }
      if (method === 'POST' && pathname === '/api/v1/auth/change-password' && currentUser) {
        const body = request.postDataJSON() as { old_password?: string; new_password?: string };
        if (request.headers()['x-csrf-token'] !== csrfToken || body.old_password !== currentPassword || !body.new_password) {
          await route.fulfill({
            status: 401,
            json: { error: { code: 'INVALID_CREDENTIALS', message: '当前密码错误', details: {}, request_id: 'req-auth-change' } },
          });
          return;
        }
        currentPassword = body.new_password;
        currentUser = {
          ...currentUser,
          must_change_password: false,
          workflow_stage: 'ACTIVE',
          revision: currentUser.revision + 1,
        };
        await route.fulfill({ status: 204 });
        return;
      }
      if (method === 'POST' && pathname === '/api/v1/auth/logout' && currentUser) {
        currentUser = null;
        await route.fulfill({ status: 204 });
        return;
      }

      unexpectedRequests.push(`${method} ${pathname}`);
      await route.fulfill({
        status: 501,
        json: { error: { code: 'AUTH_FIXTURE_UNEXPECTED_API', message: 'Auth fixture 收到未声明的 API 请求' } },
      });
    });

    await use(undefined);
    expect(unexpectedRequests, 'Auth 场景不得依赖未声明的业务 API').toEqual([]);
  }, { auto: true }],
});

test.use({ trace: 'off' });

test('匿名登录在权威生产 CSP 下无违规与运行时错误', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(globalThis, '__partsignalCspViolations', {
      configurable: true,
      value: violations,
    });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
    });
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': productionCsp,
      },
    });
  });

  await page.goto('/login');
  const username = page.getByRole('textbox', { name: '用户名' });
  const password = page.getByLabel(/^密码/);
  await expect(page.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
  await expect(username).toBeEditable();
  await expect(password).toBeEditable();
  await username.fill(engineer.username);
  await password.fill(initialPassword);
  await expect(page.getByRole('button', { name: '登录' })).toBeEnabled();

  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { __partsignalCspViolations: string[] }
  ).__partsignalCspViolations)).toEqual([]);
  expect(runtimeErrors, '匿名登录不得出现 CSP 或运行时错误').toEqual([]);
});

test('Auth production artifact 完成强制改密、自助改密、ENGINEER 403 与退出', async ({ page }, testInfo: TestInfo) => {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname;
    const interceptedNoContentPost = request.method() === 'POST'
      && ['/api/v1/auth/change-password', '/api/v1/auth/logout'].includes(pathname);
    // Chromium 会把已返回 204 的 Auth POST 记为 aborted；页面结果断言继续证明请求成功。
    if (!interceptedNoContentPost) runtimeErrors.push(`requestfailed: ${request.method()} ${pathname}`);
  });

  try {
    await page.goto('/system/users');
    await expect(page).toHaveURL('/login?redirect=%2Fsystem%2Fusers%3Fstatus%3DENABLED%26page%3D1%26pageSize%3D20');
    await expect(page.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);

    await page.getByRole('textbox', { name: '用户名' }).fill(engineer.username);
    await page.getByLabel(/^密码/).fill(initialPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL('/account/security');
    await expect(page.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();

    await page.getByLabel(/^当前密码/).fill(initialPassword);
    await page.getByLabel(/^新密码/).fill(firstNewPassword);
    await page.getByRole('button', { name: '确认修改' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    await page.getByRole('button', { name: /内容工程师/ }).click();
    await page.getByRole('menuitem', { name: '修改密码' }).click();
    await expect(page).toHaveURL('/account/security');
    await expect(page.getByText('修改成功后，当前会话继续有效，其他会话将由服务端撤销。')).toBeVisible();
    await page.getByLabel(/^当前密码/).fill(firstNewPassword);
    await page.getByLabel(/^新密码/).fill(secondNewPassword);
    await page.getByRole('button', { name: '确认修改' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/system/users');
    const forbidden = page.getByRole('heading', { name: '无权访问系统管理' });
    await expect(forbidden).toBeVisible();
    await expect(forbidden.locator('xpath=ancestor::section[1]')).toBeFocused();

    await page.getByRole('button', { name: /内容工程师/ }).click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await expect(page).toHaveURL('/login?redirect=%2Fsystem%2Fusers%3Fstatus%3DENABLED%26page%3D1%26pageSize%3D20');
    await expect(page.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();

    await page.goto('/change-password');
    await expect(page).toHaveURL('/login?redirect=%2Fchange-password');
    await page.getByRole('textbox', { name: '用户名' }).fill(engineer.username);
    await page.getByLabel(/^密码/).fill(secondNewPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL('/account/security');
    expect(runtimeErrors, 'Auth 页面不得出现未捕获异常或失败资源').toEqual([]);
  } finally {
    await expectSecretsAbsent(testInfo.outputDir, [initialPassword, firstNewPassword, secondNewPassword]);
  }
});

export { expect, test };
