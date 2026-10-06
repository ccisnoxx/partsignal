/** GEO-802：只使用虚构 storage state，管理员会话操作落入隔离真实 PostgreSQL/受保护卷。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { createAuthTrafficScope, createRealStackRuntimeAudit, trafficExpectationErrors, type TrafficExpectation } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type Context = components['schemas']['GeoBrowserSessionContext'];
type Profile = components['schemas']['GeoCollectionProfileRead'];
const apiBase = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(apiBase).origin;
const profilesPath = '/api/v1/geo/collection-profiles';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '仅运行隔离真实栈验收');
test.setTimeout(90_000);
// 文件内包含会话材料的请求不进入 trace、视频或失败截图。
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, apiBase));
async function body<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
async function open(page: Page, label: string) {
  const trigger = page.getByRole('button', { name: '更多操作：浏览器会话' });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('人工导入→存储健康→撤销→新引用恢复，配置停用且不证明平台登录', async ({ page }) => {
  const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('真实栈必须提供管理员验收密码');
  const login = await body<components['schemas']['AuthSession']>(await page.request.post(`${apiBase}/api/v1/auth/login`, { data: { username: 'admin', password } }));
  await registerRealStackLoginSecrets(page.context(), apiBase, login.csrf_token);
  const suffix = randomUUID().slice(0, 8);
  const surface = await body<components['schemas']['GeoEngineSurfaceRead']>(await page.request.post(`${apiBase}/api/v1/geo/engine-surfaces`, {
    headers: { 'X-CSRF-Token': login.csrf_token },
    data: { name: `虚构会话观测面 ${suffix}`, slug: `geo802-${suffix}`, surface_kind: 'CONSUMER_UI', provider_brand: 'CUSTOM', website_url: 'https://example.test', compliance_status: 'APPROVED', capabilities: { answer_text: true, citations: false, web_search_signal: false, model_version: false, usage: false, cost: false } } satisfies components['schemas']['GeoEngineSurfaceCreate'],
  }), 201);
  const profile = await body<Profile>(await page.request.post(`${apiBase}${profilesPath}`, {
    headers: { 'X-CSRF-Token': login.csrf_token },
    data: { engine_surface_id: surface.summary.id, name: `虚构浏览器配置 ${suffix}`, collection_mode: 'BROWSER', adapter_key: 'browser-session', language_code: 'zh-CN', region_code: 'CN', web_search_policy: 'UNKNOWN', login_state: 'AUTHENTICATED', ai_channel_id: null, ai_model_id: null, settings: { require_screenshot: true, answer_timeout_seconds: 120 } } satisfies components['schemas']['GeoBrowserProfileCreate'],
  }), 201);
  const path = `${profilesPath}/${profile.summary.id}/browser-session`;
  const cookieCanary = `Fictional-geo802-cookie-${randomUUID()}`;
  await registerArtifactSecrets([cookieCanary]);
  const storageState = JSON.stringify({ cookies: [{ name: 'fictional-session', value: cookieCanary, domain: 'example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] });
  let phase = 'open';
  const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase });
  audit.watch(page);
  const expectations: TrafficExpectation[] = [];
  async function mutate(next: string, command: string, click: () => Promise<unknown>): Promise<Context> {
    phase = next;
    expectations.push({ phase, method: 'POST', origin: apiOrigin, pathname: `${path}/${command}`, attempts: 1, responses: 1, status: 200 });
    const response = page.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname === `${path}/${command}`);
    await click();
    const result = await response;
    expect(result.status()).toBe(200);
    const canonical = await result.json() as Context;
    expect(JSON.stringify(canonical).includes(cookieCanary)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return canonical;
  }
  async function importState(next: string): Promise<Context> {
    await open(page, '导入浏览器会话');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('会话 JSON 文件').setInputFiles({ name: 'fictional-state.json', mimeType: 'application/json', buffer: Buffer.from(storageState) });
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const localExpiry = new Date(expires.getTime() - expires.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await dialog.getByLabel('有效期（本地时间）').fill(localExpiry);
    await dialog.getByRole('checkbox', { name: '确认此专用账号已获批准用于此观测面' }).check();
    return mutate(next, 'import', () => dialog.getByRole('button', { name: '确认操作', exact: true }).click());
  }
  await page.goto(`/configuration/geo-surfaces?tab=profiles&profile_id=${profile.summary.id}`);
  const panel = page.getByRole('region', { name: '浏览器会话', exact: true });
  await expect(panel.getByText(/尚未导入浏览器会话/)).toBeVisible();
  await expect(panel.getByText(/NOT_IMPLEMENTED/)).toBeVisible();
  const imported = await importState('import');
  expect(imported.session?.health).toBe('AVAILABLE');
  expect(imported.profile_revision).toBeGreaterThan(profile.summary.revision);
  const originalReference = imported.session!.session_reference;
  await expect(panel.getByText(originalReference, { exact: true })).toBeVisible();
  await open(page, '检查存储健康');
  const health = await mutate('health', 'health', () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click());
  expect(health.session?.session_reference).toBe(originalReference);
  expect(health.session?.health).toBe('AVAILABLE');
  await expect(panel.getByText(/不证明平台登录仍有效/)).toBeVisible();
  await open(page, '撤销浏览器会话');
  const revoked = await mutate('revoke', 'revoke', () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click());
  expect(revoked.session?.health).toBe('REVOKED');
  expect(revoked.session?.revoked_at).not.toBeNull();
  expect(revoked.session?.session_reference).toBe(originalReference);
  await expect(panel.getByText(/旧引用无法恢复/)).toBeVisible();
  await expect(page.getByRole('button', { name: '更多操作：浏览器会话' })).toBeEnabled();
  await page.getByRole('button', { name: '更多操作：浏览器会话' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '检查存储健康', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const restored = await importState('reimport');
  expect(restored.session?.session_reference).not.toBe(originalReference);
  expect(restored.session?.health).toBe('AVAILABLE');
  const canonical = await body<Context>(await page.request.get(`${apiBase}${path}`));
  expect(canonical).toEqual(restored);
  const persisted = await body<Profile>(await page.request.get(`${apiBase}${profilesPath}/${profile.summary.id}`));
  expect(persisted.summary.is_active).toBe(false);
  expect(persisted.summary.last_test_status).toBe('UNTESTED');
  expect(persisted.summary.last_tested_at).toBeNull();
  const oldHealth = await page.request.post(`${apiBase}${path}/health`, { headers: { 'X-CSRF-Token': login.csrf_token }, data: { expected_revision: canonical.profile_revision, session_reference: originalReference } satisfies components['schemas']['GeoBrowserSessionCommand'] });
  expect(oldHealth.status()).toBe(409);
  expect((await oldHealth.json()).error.code).toBe('GEO_BROWSER_SESSION_REVOKED');
  await expect(page.getByRole('region', { name: '采集配置详情', exact: true }).getByText(`Revision ${canonical.profile_revision}`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText(restored.session!.session_reference, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate((value) => document.body.textContent?.includes(value) ?? false, cookieCanary)).toBe(false);
  expect(await page.evaluate((value) => JSON.stringify([localStorage, sessionStorage]).includes(value), cookieCanary)).toBe(false);
  expect(audit.rawValues.some((value) => value.includes(cookieCanary))).toBe(false);
  expect(audit.errors).toEqual([]);
  expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
});
