/** GEO-202：ENGINEER 通过实际工作区维护问题变体，所有业务请求使用真实 API。 */
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page, type Response } from '@playwright/test';
import { defaultStringifySearch } from '@tanstack/react-router';
import type { components } from '../../src/shared/api/generated/schema';
import { createAuthTrafficScope, createRealStackRuntimeAudit, trafficExpectationErrors, type RuntimeCancellation, type TrafficExpectation } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type Variant = components['schemas']['GeoPromptVariantOut'];
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(apiBaseUrl).origin;
const variantsPath = '/api/v1/geo/prompt-variants';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(90_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, apiBaseUrl));
async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function detailAction(page: Page, label: string) {
  await page.getByRole('button', { name: '更多操作：当前变体' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('工程师创建、筛选、编辑、启停、复制与删除；刷新持久化，运行入口不可用', async ({ page, browser }, testInfo) => {
  const suffix = randomInt(10_000_000, 100_000_000).toString();
  const temporaryPassword = `Geo202-temp-${randomUUID()}`;
  const newPassword = `Geo202-final-${randomUUID()}`;
  await registerArtifactSecrets([temporaryPassword, newPassword]);
  const adminPassword = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('真实栈必须提供管理员验收密码');
  const admin = await body<components['schemas']['AuthSession']>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password: adminPassword },
  }));
  await registerRealStackLoginSecrets(page.context(), apiBaseUrl, admin.csrf_token);
  const username = `geo202-${suffix}`;
  await body(await page.request.post(`${apiBaseUrl}/api/v1/users`, { headers: { 'X-CSRF-Token': admin.csrf_token }, data: { username, display_name: 'GEO-202 验收工程师', temporary_password: temporaryPassword, account_type: 'ENGINEER' } satisfies components['schemas']['UserCreate'] }), 201);
  const context = await browser.newContext({ baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:4174', viewport: testInfo.project.use.viewport });
  try {
    const engineer = await context.newPage();
    const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${apiBaseUrl}/api/v1/auth/login`, { data: { username, password: temporaryPassword } }));
    await registerRealStackLoginSecrets(context, apiBaseUrl, session.csrf_token);
    expect((await engineer.request.post(`${apiBaseUrl}/api/v1/auth/change-password`, { headers: { 'X-CSRF-Token': session.csrf_token }, data: { old_password: temporaryPassword, new_password: newPassword } satisfies components['schemas']['ChangePasswordRequest'] })).status()).toBe(204);
    await registerCurrentRealStackCookies(context, apiBaseUrl);

    let phase = 'topic'; let createPath = '';
    const allowedCancellations: RuntimeCancellation[] = [
      { phase: 'topic', method: 'GET', origin: apiOrigin, pathname: '/api/v1/query-topics/list-items', reason: 'net::ERR_ABORTED' },
      // 删除后列表资格变化会取消旧读取；写请求仍由唯一响应和最终持久化断言保护。
      ...['create', 'enable', 'delete-copy', 'delete'].map((phase) => ({ phase, method: 'GET', origin: apiOrigin, pathname: variantsPath, reason: 'net::ERR_ABORTED' })),
    ];
    const allowedHttpErrors: { phase: string; method: string; origin: string; pathname: string; status: number }[] = [];
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase,
      allowedCancellations, allowedHttpErrors,
      allowedConsoleErrors: [{ phase: 'duplicate-copy', text: 'Failed to load resource: the server responded with a status of 409 (Conflict)' }],
    });
    const expectations: TrafficExpectation[] = [];
    const businessResponses: { phase: string; method: string; path: string; status: number }[] = [];
    const errors: string[] = [];
    engineer.on('pageerror', () => errors.push('pageerror'));
    engineer.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/api/v1/') && response.status() >= 400 && !(phase === 'duplicate-copy' && response.request().method() === 'POST' && path === createPath && response.status() === 409)) errors.push(`HTTP ${response.status()} ${path}`);
      if (['POST', 'PATCH', 'DELETE'].includes(response.request().method())) businessResponses.push({ phase, method: response.request().method(), path, status: response.status() });
    });
    audit.watch(engineer);
    const mutate = async (label: string, method: string, pathname: string, submit: () => Promise<void>, status: number) => {
      await engineer.waitForLoadState('networkidle'); phase = label;
      expectations.push({ phase, origin: apiOrigin, pathname, method, attempts: 1, responses: 1, status });
      const pending = engineer.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === method);
      await submit(); const response = await pending; expect(response.status()).toBe(status); return response;
    };
    await engineer.goto('/geo/topics');
    await engineer.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
    const topicDialog = engineer.getByRole('dialog', { name: '创建 Query Topic', exact: true });
    const topicQuestion = `GEO202 标准主题 ${suffix}`;
    await topicDialog.getByRole('textbox', { name: '标准问题', exact: true }).fill(topicQuestion);
    await topicDialog.getByRole('textbox', { name: '变体 1', exact: true }).fill(`旧主题数组 ${suffix}`);
    const topic = await body<components['schemas']['QueryTopic']>(await mutate('topic', 'POST', '/api/v1/query-topics', () => topicDialog.getByRole('button', { name: '创建', exact: true }).click(), 201), 201);
    await expect(topicDialog).toBeHidden(); createPath = `/api/v1/geo/query-topics/${topic.id}/prompt-variants`;
    allowedHttpErrors.push({ phase: 'duplicate-copy', method: 'POST', origin: apiOrigin, pathname: createPath, status: 409 });
    await engineer.waitForLoadState('networkidle');
    await engineer.goto('/geo/questions?new=1');
    await choose(engineer, '问题主题', topicQuestion);
    const prompt = `PartSignal 型号替代验收 ${suffix}`;
    await engineer.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(prompt);
    await expect(engineer.getByRole('combobox', { name: '点名属性', exact: true })).toContainText('请选择点名属性');
    await choose(engineer, '点名属性', '非点名'); await choose(engineer, '优先级', '核心');
    await engineer.getByRole('textbox', { name: '语言代码', exact: true }).fill('zh-CN');
    await engineer.getByRole('textbox', { name: '地区代码', exact: true }).fill('CN');
    const created = await body<Variant>(await mutate('create', 'POST', createPath, () => engineer.getByRole('button', { name: '创建变体', exact: true }).click(), 201), 201);
    expect(created).toMatchObject({ query_topic_id: topic.id, mention_mode: 'UNBRANDED', language_code: 'zh-cn', region_code: 'CN', priority: 'CORE', revision: 0, run_entry: { available: false, reason_code: 'NOT_IMPLEMENTED' } });
    await expect(engineer).toHaveURL(new RegExp(`selected=${created.id}`));
    const workspace = engineer.getByRole('dialog', { name: '问题变体工作区' });
    await expect(workspace.getByRole('button', { name: '立即运行' })).toBeDisabled(); await expect(workspace.getByText(/NOT_IMPLEMENTED/)).toBeVisible();
    await workspace.getByRole('button', { name: '关闭', exact: true }).click();
    await engineer.getByRole('textbox', { name: '搜索完整问题文本' }).fill(suffix);
    await engineer.getByText('主题、语言和地区筛选', { exact: true }).click();
    await choose(engineer, '筛选问题主题', topicQuestion);
    await engineer.getByRole('button', { name: '应用筛选', exact: true }).click();
    await engineer.waitForLoadState('networkidle');
    await choose(engineer, '筛选点名属性', '非点名'); await engineer.waitForLoadState('networkidle');
    await choose(engineer, '筛选优先级', '核心'); await engineer.waitForLoadState('networkidle');
    await choose(engineer, '筛选启用状态', '已启用');
    await engineer.waitForLoadState('networkidle'); await engineer.reload();
    await expect(engineer.getByRole('textbox', { name: '搜索完整问题文本' })).toHaveValue(suffix);
    await expect(engineer.getByRole('combobox', { name: '筛选点名属性' })).toContainText('非点名');
    await expect(engineer).toHaveURL(new RegExp(`query_topic_id=${topic.id}`));
    const row = engineer.getByRole('region', { name: '问题变体列表' }).getByRole('row', { name: new RegExp(prompt) });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    const editedText = `${prompt} 编辑后`;
    await engineer.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(editedText);
    const updated = await body<Variant>(await mutate('edit', 'PATCH', `${variantsPath}/${created.id}`, () => engineer.getByRole('button', { name: '保存变体' }).click(), 200));
    expect(updated.revision).toBe(1); expect(updated.mention_mode).toBe('UNBRANDED');
    await engineer.getByRole('button', { name: '关闭表单' }).click();
    await detailAction(engineer, '停用变体');
    await mutate('disable', 'POST', `${variantsPath}/${created.id}/disable`, () => engineer.getByRole('dialog', { name: '确认停用变体' }).getByRole('button', { name: '确认操作' }).click(), 200);
    await expect(workspace.getByText('停用变体已完成。')).toBeVisible();
    await detailAction(engineer, '启用变体');
    await mutate('enable', 'POST', `${variantsPath}/${created.id}/enable`, () => engineer.getByRole('dialog', { name: '确认启用变体' }).getByRole('button', { name: '确认操作' }).click(), 200);
    await engineer.waitForLoadState('networkidle'); await engineer.reload();
    await expect(workspace.getByText(editedText, { exact: true })).toBeVisible();
    await expect(workspace.getByText(/Revision 3 · 启用/)).toBeVisible();
    for (const width of [375, 768, 1024, 1440]) {
      await engineer.setViewportSize({ width, height: 900 });
      expect(await engineer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await engineer.evaluate(() => document.documentElement.clientWidth));
      await expect(workspace.getByRole('button', { name: '立即运行' })).toBeVisible();
    }
    await engineer.screenshot({ path: testInfo.outputPath('questions-real-api.png'), fullPage: true });
    await detailAction(engineer, '复制为新变体');
    await expect(engineer).toHaveURL(new RegExp(`copy=${created.id}`));
    await expect(engineer.getByRole('textbox', { name: '完整问题文本', exact: true })).toHaveValue(editedText);
    const duplicate = await body<components['schemas']['ErrorEnvelope']>(await mutate('duplicate-copy', 'POST', createPath, () => engineer.getByRole('button', { name: '创建变体' }).click(), 409), 409);
    expect(duplicate.error.code).toBe('GEO_PROMPT_VARIANT_EXISTS');
    await expect(engineer.getByRole('textbox', { name: '完整问题文本', exact: true })).toHaveValue(editedText);
    await engineer.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(`${editedText} 复制新语义`);
    const copied = await body<Variant>(await mutate('copy', 'POST', createPath, () => engineer.getByRole('button', { name: '创建变体' }).click(), 201), 201);
    expect(copied.id).not.toBe(created.id); expect(copied.revision).toBe(0);
    // Chromium 可在已返回204的空响应结束时发出ERR_ABORTED；仍严格断言唯一204响应和持久化删除。
    allowedCancellations.push({ phase: 'delete-copy', method: 'DELETE', origin: apiOrigin, pathname: `${variantsPath}/${copied.id}`, reason: 'net::ERR_ABORTED' });
    await detailAction(engineer, '删除变体');
    await mutate('delete-copy', 'DELETE', `${variantsPath}/${copied.id}`, () => engineer.getByRole('dialog', { name: '确认删除变体' }).getByRole('button', { name: '确认操作' }).click(), 204);
    await expect(workspace).toBeHidden();
    await engineer.waitForLoadState('networkidle');
    // 字符串查询必须经过 Router 序列化，数值形式也应保持字符串筛选。
    await engineer.goto(`/geo/questions${defaultStringifySearch({ selected: created.id, q: suffix })}`);
    allowedCancellations.push({ phase: 'delete', method: 'DELETE', origin: apiOrigin, pathname: `${variantsPath}/${created.id}`, reason: 'net::ERR_ABORTED' });
    await detailAction(engineer, '删除变体');
    await mutate('delete', 'DELETE', `${variantsPath}/${created.id}`, () => engineer.getByRole('dialog', { name: '确认删除变体' }).getByRole('button', { name: '确认操作' }).click(), 204);
    await expect(workspace).toBeHidden(); await engineer.waitForLoadState('networkidle'); await engineer.reload();
    await expect(engineer.getByText('未找到匹配变体', { exact: true })).toBeVisible();
    const persisted = await body<components['schemas']['GeoPromptVariantListPage']>(await engineer.request.get(`${apiBaseUrl}${variantsPath}?query_topic_id=${topic.id}`));
    expect(persisted.items).toEqual([]); expect(persisted.total).toBe(0);
    expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
    expect(audit.errors).toEqual([]); expect(errors).toEqual([]);
    expect(businessResponses.some((item) => /batch|run/.test(item.path))).toBe(false);
  } finally { await registerCurrentRealStackCookies(context, apiBaseUrl); await context.close(); }
});
