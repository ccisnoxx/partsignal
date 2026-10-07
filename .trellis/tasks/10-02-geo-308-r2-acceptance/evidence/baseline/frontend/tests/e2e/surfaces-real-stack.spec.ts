/** GEO-205：管理 UI 写入真实 PostgreSQL，工程师只消费服务端摘要。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page, type Response } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { createAuthTrafficScope, createRealStackRuntimeAudit, trafficExpectationErrors, type RuntimeCancellation, type TrafficExpectation } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type Surface = components['schemas']['GeoEngineSurfaceRead'];
type Profile = components['schemas']['GeoCollectionProfileRead'];
const api = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(api).origin;
const route = '/configuration/geo-surfaces';
const surfaces = '/api/v1/geo/engine-surfaces';
const profiles = '/api/v1/geo/collection-profiles';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(90_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
async function action(page: Page, label: string) {
  await page.getByRole('region', { name: /^(观测面|采集配置)详情$/ }).getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function confirmAction(page: Page, label: string) {
  await action(page, label);
  await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click();
}

test('管理员创建、启停和编辑后持久化，工程师仅看摘要，删除尊重真实子配置', async ({ page, browser }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('真实栈必须提供管理员验收密码');
  const login = await body<components['schemas']['AuthSession']>(await page.request.post(`${api}/api/v1/auth/login`, { data: { username: 'admin', password } }));
  await registerRealStackLoginSecrets(page.context(), api, login.csrf_token);
  let phase = 'open';
  const allowedCancellations: RuntimeCancellation[] = [];
  const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase, allowedCancellations });
  audit.watch(page);
  const expectations: TrafficExpectation[] = [];
  async function mutate<T>(next: string, method: string, pathname: string, click: () => Promise<unknown>, status = 200): Promise<T> {
    phase = next;
    expectations.push({ phase, method, origin: apiOrigin, pathname, attempts: 1, responses: 1, status });
    const pending = page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === pathname);
    await click();
    const response = await pending;
    expect(response.status()).toBe(status);
    return status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  await page.goto(route);
  await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`虚构观测面 ${suffix}`);
  await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo205-${suffix}`);
  const surface = await mutate<Surface>('create-surface', 'POST', surfaces, () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  expect(surface.summary.is_active).toBe(false);
  await expect(page).toHaveURL(new RegExp(`surface_id=${surface.summary.id}`));
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await mutate<Surface>('enable-surface', 'POST', `${surfaces}/${surface.summary.id}/enable`, () => confirmAction(page, '启用观测面'));
  await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(`虚构人工配置 ${suffix}`);
  const profile = await mutate<Profile>('create-profile', 'POST', profiles, () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  // 刷新/离开页面会取消尚未完成的 GET；写请求必须完整结束，不能列入取消白名单。
  allowedCancellations.push(
    { phase: 'edit-profile', method: 'GET', origin: apiOrigin, pathname: `${profiles}/${profile.summary.id}`, reason: 'net::ERR_ABORTED' },
    { phase: 'delete-profile', method: 'GET', origin: apiOrigin, pathname: profiles, reason: 'net::ERR_ABORTED' },
  );
  expect(profile.summary.last_test_status).toBe('UNTESTED');
  expect(profile.summary.last_tested_at).toBeNull();
  expect(profile.summary.is_active).toBe(false);
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await expect(page.getByRole('region', { name: '采集配置详情' }).getByText(/UNTESTED/)).toBeVisible();
  await mutate<Profile>('enable-profile', 'POST', `${profiles}/${profile.summary.id}/enable`, () => confirmAction(page, '启用采集配置'));
  await action(page, '编辑采集配置');
  await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(`虚构已编辑配置 ${suffix}`);
  const edited = await mutate<Profile>('edit-profile', 'PATCH', `${profiles}/${profile.summary.id}`, () => page.getByRole('button', { name: '保存采集配置', exact: true }).click());
  expect(edited.summary.is_active).toBe(false);
  expect(edited.summary.last_test_status).toBe('UNTESTED');
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: '采集配置详情' }).getByText(edited.summary.name, { exact: true })).toBeVisible();
  const persisted = await body<Profile>(await page.request.get(`${api}${profiles}/${profile.summary.id}`));
  expect(persisted.summary).toEqual(edited.summary);
  await page.screenshot({ path: testInfo.outputPath('geo205-admin-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByRole('region', { name: '采集配置详情' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('geo205-admin-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const engineerContext = await browser.newContext({ baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:4174' });
  try {
    const engineer = await engineerContext.newPage();
    const engineerPassword = process.env.PARTSIGNAL_SEED_ENGINEER_PASSWORD;
    if (!engineerPassword) throw new Error('真实栈必须提供工程师验收密码');
    const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${api}/api/v1/auth/login`, { data: { username: 'content_editor', password: engineerPassword } }));
    await registerRealStackLoginSecrets(engineerContext, api, session.csrf_token);
    if (session.user.must_change_password) {
      const newPassword = `Geo205-final-${randomUUID()}`;
      await registerArtifactSecrets([newPassword]);
      expect((await engineer.request.post(`${api}/api/v1/auth/change-password`, { headers: { 'X-CSRF-Token': session.csrf_token }, data: { old_password: engineerPassword, new_password: newPassword } })).status()).toBe(204);
      await registerCurrentRealStackCookies(engineerContext, api);
    }
    const readonlyAudit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => 'engineer' });
    readonlyAudit.watch(engineer);
    await engineer.goto(`${route}?tab=profiles&profile_id=${profile.summary.id}`);
    await expect(engineer.getByRole('region', { name: '采集配置详情' }).getByText(edited.summary.name, { exact: true })).toBeVisible();
    await expect(engineer.getByRole('button', { name: /更多操作|新建观测面|新建采集配置/ })).toHaveCount(0);
    const summary = await body<Profile>(await engineer.request.get(`${api}${profiles}/${profile.summary.id}`));
    expect(summary.configuration).toBeNull();
    expect(summary.activation_blockers).toBeNull();
    expect(summary.available_actions).toEqual([]);
    expect(summary.summary).toEqual(persisted.summary);
    await expect(engineer.getByText('适配器：manual（固定）')).toHaveCount(0);
    expect(readonlyAudit.errors).toEqual([]);
    expect(readonlyAudit.attempts.filter(createAuthTrafficScope(apiOrigin))).toEqual([]);
  } finally {
    await registerCurrentRealStackCookies(engineerContext, api);
    await engineerContext.close();
  }
  await page.goto(`${route}?surface_id=${surface.summary.id}`);
  await expect(page.getByRole('region', { name: '观测面详情' }).getByText(/采集配置.*1/)).toBeVisible();
  await page.getByRole('region', { name: '观测面详情' }).getByRole('button', { name: /更多操作/ }).click();
  await expect(page.getByRole('menuitem', { name: '删除观测面', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto(`${route}?tab=profiles&profile_id=${profile.summary.id}`);
  await action(page, '删除采集配置');
  await mutate('delete-profile', 'DELETE', `${profiles}/${profile.summary.id}`, () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(), 204);
  await expect(page.getByText('采集配置已删除。', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '观测面', exact: true }).click();
  await page.getByRole('link', { name: surface.summary.name, exact: true }).click();
  await action(page, '删除观测面');
  await mutate('delete-surface', 'DELETE', `${surfaces}/${surface.summary.id}`, () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(), 204);
  await expect(page.getByText('观测面已删除。', { exact: true })).toBeVisible();
  expect(audit.errors).toEqual([]);
  expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
});
