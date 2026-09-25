/** 通过 V2 页面验证真实 cookie、CSRF、首次改密、权限边界与退出。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type BrowserContext,
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
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type AuthSession = components['schemas']['AuthSession'];

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.use({ trace: 'off' });
test.setTimeout(60_000);

function apiUrl(pathname: string) {
  return new URL(pathname, apiBaseUrl).toString();
}

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

    await page.getByRole('button', { name: /内容运营/ }).click();
    phase.current = 'logout';
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    phase.current = 'logged-out';

    const anonymousProbe = await context.request.get(apiUrl('/api/v1/auth/me'));
    expect(anonymousProbe.status(), '退出后无 Cookie 探测应为匿名').toBe(204);
    expect((await anonymousProbe.body()).byteLength, '匿名探测应为空响应').toBe(0);

    replayContext = await browser.newContext();
    await replayContext.addCookies([oldSessionCookie!]);
    const replayProbe = await replayContext.request.get(apiUrl('/api/v1/auth/me'));
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
