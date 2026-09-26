/** 通过 V2 页面验证原子认证快照、真实 cookie、首次改密、权限边界与退出。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';
import {
  createAuthTrafficScope,
  createRealStackRuntimeAudit,
  trafficExpectationErrors,
} from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const initialPassword = process.env.PARTSIGNAL_SEED_ENGINEER_PASSWORD ?? 'partsignal-engineer-dev';
const adminPassword = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type AuthSession = components['schemas']['AuthSession'];

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.use({ trace: 'off' });
test.setTimeout(90_000);

function apiUrl(pathname: string) {
  return new URL(pathname, apiBaseUrl).toString();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function loginAs(page: Page, username: string, password: string): Promise<AuthSession> {
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel(/^密码/).fill(password);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).origin === apiBaseUrl
    && new URL(response.url()).pathname === '/api/v1/auth/login'
  ));
  await page.getByRole('button', { name: '登录' }).click();
  const response = await responsePromise;
  expect(response.status(), `${username} 登录应成功`).toBe(200);
  const session = await response.json() as AuthSession;
  await registerRealStackLoginSecrets(page.context(), apiBaseUrl, session.csrf_token);
  return session;
}

test('同一 BrowserContext 双页面以 session binding 封闭 A→B→A 的迟到 mutation', async ({
  context,
  page: pageA,
}) => {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const phase = { current: 'a-login' };
  const runtimeAudit = createRealStackRuntimeAudit({
    apiOrigin,
    getPhase: () => phase.current,
  });
  const productAccepted = deferred();
  const releaseProduct = deferred();
  const productFulfilled = deferred();
  const partNumber = `AUTH-ABA-${randomUUID()}`;
  let createdProductId: string | undefined;
  let pageB: Page | undefined;

  await registerArtifactSecrets([adminPassword, initialPassword]);
  runtimeAudit.watch(pageA);

  try {
    await pageA.goto('/login');
    const initialWorkbenchResponse = pageA.waitForResponse((response) => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/workbench'
    ));
    const initialAdmin = await loginAs(pageA, 'admin', adminPassword);
    expect(initialAdmin.session_binding).toMatch(/^[0-9a-f]{64}$/);
    await expect(pageA).toHaveURL('/');
    expect((await initialWorkbenchResponse).status(), '初次 admin Workbench 应完成读取').toBe(200);
    await expect(pageA.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    await pageA.goto('/products/new');
    await expect(pageA.getByRole('heading', { level: 1, name: '新建产品' })).toBeVisible();
    await pageA.route('**/api/v1/products', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const body = await response.body();
      const product = JSON.parse(body.toString()) as { id: string };
      expect(response.status(), 'A 主体产品命令应已由真实服务端接受').toBe(201);
      createdProductId = product.id;
      productAccepted.resolve();
      await releaseProduct.promise;
      await route.fulfill({
        body,
        headers: response.headers(),
        status: response.status(),
      });
      productFulfilled.resolve();
    });
    await pageA.getByLabel('产品型号').fill(partNumber);
    await pageA.getByLabel('品牌').fill('Auth ABA');
    await pageA.getByLabel('类别').fill('Deterministic interleaving');
    phase.current = 'a-pending-product';
    await pageA.getByRole('button', { name: '创建产品' }).click();
    await productAccepted.promise;

    pageB = await context.newPage();
    runtimeAudit.watch(pageB);
    let forceAnonymousBootstrap = true;
    await pageB.route('**/api/v1/auth/session', async (route) => {
      if (forceAnonymousBootstrap) {
        await route.fulfill({ body: '', status: 204 });
        return;
      }
      await route.fallback();
    });

    phase.current = 'a-to-b-bootstrap';
    await pageB.goto('/login');
    await expect(pageB.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
    forceAnonymousBootstrap = false;
    phase.current = 'a-to-b-login';
    const engineerSession = await loginAs(pageB, 'content_editor', initialPassword);
    expect(engineerSession.session_binding).not.toBe(initialAdmin.session_binding);
    await expect(pageA).toHaveURL('/account/security');
    await expect(pageA.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();

    forceAnonymousBootstrap = true;
    phase.current = 'b-to-a-bootstrap';
    await pageB.goto('/login');
    await expect(pageB.getByRole('heading', { level: 1, name: '登录' })).toBeVisible();
    forceAnonymousBootstrap = false;
    phase.current = 'b-to-a-login';
    const replacementAdmin = await loginAs(pageB, 'admin', adminPassword);
    expect(replacementAdmin.session_binding).not.toBe(engineerSession.session_binding);
    expect(replacementAdmin.session_binding).not.toBe(initialAdmin.session_binding);
    await expect(pageA).toHaveURL('/');
    await expect(pageA.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    const oldResponse = pageA.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/products'
    ));
    releaseProduct.resolve();
    await oldResponse;
    await productFulfilled.promise;
    await pageA.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(createdProductId, '测试必须记录真实服务端已创建的产品').toBeDefined();
    expect(pageA.url()).not.toContain(createdProductId!);
    await expect(pageA).toHaveURL('/');
    await expect(pageA.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

    expect(trafficExpectationErrors(runtimeAudit.attempts, runtimeAudit.responses, [
      {
        phase: 'a-login',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'a-pending-product',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/products',
        status: 201,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'a-to-b-login',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'b-to-a-login',
        origin: apiOrigin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
    ], createAuthTrafficScope(apiOrigin)),
    '跨标签页真实栈非幂等流量必须精确且无重复副作用').toEqual([]);
    expect(runtimeAudit.errors, '跨标签页真实栈不得出现未声明错误或失败资源').toEqual([]);
  } finally {
    releaseProduct.resolve();
    await registerCurrentRealStackCookies(context, apiBaseUrl);
    await pageB?.close();
  }
});

test('Auth 真实栈完成 login → forced change → admin 403 → logout', async ({
  browser,
  context,
  page,
}) => {
  const newPassword = `auth-real-${randomUUID()}`;
  const phase = { current: 'login' };
  let replayContext: BrowserContext | undefined;
  const runtimeAudit = createRealStackRuntimeAudit({
    apiOrigin: new URL(apiBaseUrl).origin,
    getPhase: () => phase.current,
    allowedCancellations: [
      {
        phase: 'forced-password-change',
        origin: new URL(apiBaseUrl).origin,
        method: 'POST',
        pathname: '/api/v1/auth/change-password',
        reason: 'net::ERR_ABORTED',
      },
      {
        phase: 'forced-password-change',
        origin: new URL(apiBaseUrl).origin,
        method: 'GET',
        pathname: '/api/v1/workbench',
        reason: 'net::ERR_ABORTED',
      },
      {
        phase: 'logout',
        origin: new URL(apiBaseUrl).origin,
        method: 'POST',
        pathname: '/api/v1/auth/logout',
        reason: 'net::ERR_ABORTED',
      },
    ],
  });

  await registerArtifactSecrets([initialPassword, newPassword]);
  runtimeAudit.watch(page);

  try {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '用户名' }).fill('content_editor');
    await page.getByLabel(/^密码/).fill(initialPassword);
    const loginResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).origin === apiBaseUrl
      && new URL(response.url()).pathname === '/api/v1/auth/login'
    ));
    await page.getByRole('button', { name: '登录' }).click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status(), '登录应成功').toBe(200);
    const loginSession = await loginResponse.json() as AuthSession;
    expect(loginSession.session_binding).toMatch(/^[0-9a-f]{64}$/);
    await registerRealStackLoginSecrets(context, apiBaseUrl, loginSession.csrf_token);

    await expect(page).toHaveURL('/account/security');
    phase.current = 'forced-password-change';
    await expect(page.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeVisible();
    await page.getByLabel(/^当前密码/).fill(initialPassword);
    await page.getByLabel(/^新密码/).fill(newPassword);
    await page.getByRole('button', { name: '确认修改' }).click();

    await expect(page).toHaveURL('/');
    phase.current = 'workbench';
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
    phase.current = 'navigate-to-system-users';
    await page.goto('/system/users');
    const forbidden = page.getByRole('heading', { name: '无权访问系统管理' });
    await expect(forbidden).toBeVisible();
    await expect(forbidden.locator('xpath=ancestor::section[1]')).toBeFocused();

    phase.current = 'system-forbidden';
    const workbenchResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/workbench'
    ));
    phase.current = 'workbench';
    await page.goto('/');
    const workbenchResponse = await workbenchResponsePromise;
    expect(workbenchResponse.status(), 'Workbench 聚合请求必须成功').toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: '需要处理' })).toBeVisible();

    const authCookies = await context.cookies(apiBaseUrl);
    const oldSessionCookie = authCookies.find((cookie) => cookie.name === 'partsignal_session');
    expect(Boolean(oldSessionCookie), '退出前应存在 session Cookie').toBe(true);
    await registerArtifactSecrets(authCookies.map((cookie) => cookie.value));

    const canonicalSnapshot = await context.request.get(apiUrl('/api/v1/auth/session'));
    expect(canonicalSnapshot.status(), '退出前原子认证快照应可读取').toBe(200);
    const canonicalSession = await canonicalSnapshot.json() as AuthSession;
    expect(canonicalSession.user.username).toBe('content_editor');
    expect(canonicalSession.user.must_change_password).toBe(false);
    expect(canonicalSession.csrf_token).toBe(loginSession.csrf_token);
    expect(canonicalSession.session_binding).toBe(loginSession.session_binding);
    expect(JSON.stringify(canonicalSession)).not.toContain(oldSessionCookie!.value);

    await page.getByRole('button', { name: /内容运营/ }).click();
    phase.current = 'logout';
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    phase.current = 'logged-out';

    const anonymousProbe = await context.request.get(apiUrl('/api/v1/auth/session'));
    expect(anonymousProbe.status(), '退出后无 Cookie 探测应为匿名').toBe(204);
    expect((await anonymousProbe.body()).byteLength, '匿名探测应为空响应').toBe(0);

    replayContext = await browser.newContext();
    await replayContext.addCookies([oldSessionCookie!]);
    const replayProbe = await replayContext.request.get(apiUrl('/api/v1/auth/session'));
    expect(replayProbe.status(), '退出后重放旧 Cookie 必须被服务端拒绝').toBe(401);
    const replayBody = await replayProbe.json() as ErrorEnvelope;
    expect(replayBody.error.code).toBe('AUTH_REQUIRED');

    expect(trafficExpectationErrors(runtimeAudit.attempts, runtimeAudit.responses, [
      {
        phase: 'login',
        origin: new URL(apiBaseUrl).origin,
        method: 'POST',
        pathname: '/api/v1/auth/login',
        status: 200,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'forced-password-change',
        origin: new URL(apiBaseUrl).origin,
        method: 'POST',
        pathname: '/api/v1/auth/change-password',
        status: 204,
        attempts: 1,
        responses: 1,
      },
      {
        phase: 'logout',
        origin: new URL(apiBaseUrl).origin,
        method: 'POST',
        pathname: '/api/v1/auth/logout',
        status: 204,
        attempts: 1,
        responses: 1,
      },
    ], createAuthTrafficScope(new URL(apiBaseUrl).origin)),
    'Auth 同源非幂等请求 phase/attempt/response multiset 必须精确').toEqual([]);
    expect(runtimeAudit.errors, 'Auth 真实栈不得出现未捕获异常或失败资源').toEqual([]);
  } finally {
    await registerCurrentRealStackCookies(context, apiBaseUrl);
    if (replayContext) await registerCurrentRealStackCookies(replayContext, apiBaseUrl);
    await replayContext?.close();
  }
});
