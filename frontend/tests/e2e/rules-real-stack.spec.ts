/** GEO-701：真实登录、规则 preview、保存/刷新与管理员路由隔离。 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body, login } from './geo-api-support';
import { createRealStackRuntimeAudit } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

const route = '/configuration/geo-rules';
const rules = '/api/v1/geo/rules';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(90_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));

test('规则预览无写入，保存后刷新持久化，工程师拒绝且无配置请求', async ({ page, browser }, testInfo) => {
  await login(page);
  const before = await body<components['schemas']['GeoRuleSetRead']>(await page.request.get(`${api}${rules}`));
  const audit = createRealStackRuntimeAudit({ apiOrigin: new URL(api).origin, getPhase: () => 'rules' });
  audit.watch(page);
  await page.goto(route);
  await expect(page.getByRole('heading', { name: 'GEO 规则与阈值', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '数据质量：最低成功率', exact: true })).toHaveValue('');
  const threshold = page.getByRole('spinbutton', { name: '可见度下降阈值', exact: true });
  await threshold.fill('0.25');
  await page.getByRole('spinbutton', { name: '当前窗口样本数', exact: true }).fill('5');
  await page.getByRole('spinbutton', { name: '前期窗口样本数', exact: true }).fill('5');
  async function preview() {
    const pending = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `${rules}/preview`);
    const button = page.getByRole('button', { name: '预览配置与样本资格', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    return body<components['schemas']['GeoRulePreviewRead']>(await pending);
  }
  const proposed = await preview();
  expect(proposed.snapshot.configuration.visibility_drop_points).toBe(0.25);
  expect(proposed.proposed_revision).toBe(before.revision + 1);
  expect(await body(await page.request.get(`${api}${rules}`))).toEqual(before);
  await expect(page.getByRole('region', { name: '服务端规则预览结果', exact: true })).toBeVisible();
  await threshold.fill('0.2');
  await expect(page.getByRole('region', { name: '服务端规则预览结果', exact: true })).toHaveCount(0);
  const finalPreview = await preview();
  expect(finalPreview.snapshot.configuration.visibility_drop_points).toBe(0.2);
  const savedResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === rules);
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  const saved = await body<components['schemas']['GeoRuleSetRead']>(await savedResponse);
  expect(saved.configuration).toEqual(finalPreview.snapshot.configuration);
  expect(saved.revision).toBe(finalPreview.proposed_revision);
  await expect(page.getByText(`规则已保存（revision ${saved.revision}），仅用于未来评估。`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(threshold).toHaveValue('0.2');
  expect(await body(await page.request.get(`${api}${rules}`))).toEqual(saved);
  await page.screenshot({ path: testInfo.outputPath('geo701-rules-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByRole('button', { name: '保存规则', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('geo701-rules-mobile.png'), fullPage: true });
  expect(audit.errors).toEqual([]);

  const context = await browser.newContext({ baseURL: process.env.PARTSIGNAL_E2E_BASE_URL });
  try {
    const engineer = await context.newPage();
    const password = process.env.PARTSIGNAL_SEED_ENGINEER_PASSWORD;
    if (!password) throw new Error('真实栈必须提供工程师验收密码');
    const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${api}/api/v1/auth/login`, { data: { username: 'content_editor', password } }));
    await registerRealStackLoginSecrets(context, api, session.csrf_token);
    if (session.user.must_change_password) {
      const replacement = `Geo701-final-${randomUUID()}`;
      await registerArtifactSecrets([replacement]);
      expect((await engineer.request.post(`${api}/api/v1/auth/change-password`, { headers: { 'X-CSRF-Token': session.csrf_token }, data: { old_password: password, new_password: replacement } })).status()).toBe(204);
      await registerCurrentRealStackCookies(context, api);
    }
    const requests: string[] = [];
    engineer.on('request', (request) => { if (new URL(request.url()).pathname.startsWith(rules)) requests.push(request.method()); });
    await engineer.goto(route);
    await expect(engineer.getByRole('heading', { name: '无权访问 GEO 规则配置', exact: true })).toBeVisible();
    await expect(engineer).toHaveURL(new RegExp(`${route}$`));
    expect(requests).toEqual([]);
    expect((await engineer.request.get(`${api}${rules}`)).status()).toBe(403);
  } finally {
    await registerCurrentRealStackCookies(context, api);
    await context.close();
  }
});
