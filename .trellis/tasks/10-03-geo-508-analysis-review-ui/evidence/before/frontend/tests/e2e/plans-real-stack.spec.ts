/** GEO-209：向导与生命周期使用真实 API，所有业务写入经过 UI。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page, type Response } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { createAuthTrafficScope, createRealStackRuntimeAudit, trafficExpectationErrors, type RuntimeCancellation, type TrafficExpectation } from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

type Plan = components['schemas']['GeoMonitoringPlanDetail'];
const api = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(api).origin;
const plans = '/api/v1/geo/monitoring-plans';
const surfaces = '/api/v1/geo/engine-surfaces';
const profiles = '/api/v1/geo/collection-profiles';
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function resourceAction(page: Page, label: string) {
  await page.getByRole('region', { name: /^(观测面|采集配置)详情$/ }).getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click();
}
async function planAction(page: Page, label: string) {
  const detail = page.getByRole('region', { name: '监测计划详情' });
  const primary = detail.getByRole('button', { name: label, exact: true });
  if (await primary.count()) await primary.click();
  else { await detail.getByRole('button', { name: '更多操作：当前计划' }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); }
}

test('工程师八步创建、服务端预览、dirty、URL、启停修订复制归档与删除持久化', async ({ page, browser }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const adminPassword = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('真实栈必须提供管理员验收密码');
  const admin = await body<components['schemas']['AuthSession']>(await page.request.post(`${api}/api/v1/auth/login`, { data: { username: 'admin', password: adminPassword } }));
  await registerRealStackLoginSecrets(page.context(), api, admin.csrf_token);
  const pendingWrite = async <T,>(method: string, pathname: string, click: () => Promise<unknown>, status = 200) => {
    const pending = page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === pathname);
    await click(); return body<T>(await pending, status);
  };
  // 通过已有管理 UI 准备对象和人工配置；没有真实平台、凭据或外部采集。
  const subjectName = `GEO209 参考型号 ${suffix}`;
  await page.goto('/configuration/geo-entities');
  await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  await choose(page, '对象类型', '参考型号');
  await page.getByRole('textbox', { name: '规范名称', exact: true }).fill(subjectName);
  await page.getByRole('textbox', { name: '显示名称', exact: true }).fill(subjectName);
  const subject = await pendingWrite<components['schemas']['GeoSubjectOut']>('POST', '/api/v1/geo/subjects', () => page.getByRole('button', { name: '创建监测对象', exact: true }).click(), 201);
  expect(subject.is_active).toBe(true);
  await page.waitForLoadState('networkidle'); await page.goto('/configuration/geo-surfaces');
  await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`GEO209 人工观测面 ${suffix}`);
  await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo209-${suffix}`);
  const surface = await pendingWrite<components['schemas']['GeoEngineSurfaceRead']>('POST', surfaces, () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await pendingWrite('POST', `${surfaces}/${surface.summary.id}/enable`, () => resourceAction(page, '启用观测面'));
  await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  const profileName = `GEO209 人工配置 ${suffix}`;
  await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(profileName);
  const profile = await pendingWrite<components['schemas']['GeoCollectionProfileRead']>('POST', profiles, () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await pendingWrite('POST', `${profiles}/${profile.summary.id}/enable`, () => resourceAction(page, '启用采集配置'));

  const temporaryPassword = `Geo209-temp-${randomUUID()}`;
  const newPassword = `Geo209-final-${randomUUID()}`;
  await registerArtifactSecrets([temporaryPassword, newPassword]);
  const username = `geo209-${suffix}`;
  await body(await page.request.post(`${api}/api/v1/users`, { headers: { 'X-CSRF-Token': admin.csrf_token }, data: { username, display_name: 'GEO-209 验收工程师', temporary_password: temporaryPassword, account_type: 'ENGINEER' } satisfies components['schemas']['UserCreate'] }), 201);
  const context = await browser.newContext({ baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:4174', viewport: testInfo.project.use.viewport });
  try {
    const engineer = await context.newPage();
    const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${api}/api/v1/auth/login`, { data: { username, password: temporaryPassword } }));
    await registerRealStackLoginSecrets(context, api, session.csrf_token);
    expect((await engineer.request.post(`${api}/api/v1/auth/change-password`, { headers: { 'X-CSRF-Token': session.csrf_token }, data: { old_password: temporaryPassword, new_password: newPassword } })).status()).toBe(204);
    await registerCurrentRealStackCookies(context, api);
    await engineer.goto('/geo/topics');
    await engineer.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
    const dialog = engineer.getByRole('dialog', { name: '创建 Query Topic', exact: true });
    const topicName = `GEO209 主题 ${suffix}`;
    await dialog.getByRole('textbox', { name: '标准问题' }).fill(topicName);
    await dialog.getByRole('textbox', { name: '变体 1' }).fill(`既有主题问题 ${suffix}`);
    const topicResponse = engineer.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/query-topics' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    const topic = await body<components['schemas']['QueryTopic']>(await topicResponse, 201);
    await expect(dialog).toBeHidden(); await engineer.waitForLoadState('networkidle');
    await engineer.goto('/geo/questions?new=1');
    await choose(engineer, '问题主题', topicName);
    const promptName = `GEO209 替代问题 ${suffix}`;
    await engineer.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(promptName);
    await choose(engineer, '点名属性', '非点名'); await choose(engineer, '优先级', '核心');
    await engineer.getByRole('textbox', { name: '语言代码', exact: true }).fill('zh-CN');
    await engineer.getByRole('textbox', { name: '地区代码', exact: true }).fill('CN');
    const variantResponse = engineer.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/geo/query-topics/${topic.id}/prompt-variants` && response.request().method() === 'POST');
    await engineer.getByRole('button', { name: '创建变体', exact: true }).click();
    const variant = await body<components['schemas']['GeoPromptVariantOut']>(await variantResponse, 201);
    await engineer.waitForLoadState('networkidle');

    let phase = 'open';
    // 写后取消旧列表 GET 是防止旧快照回写的已观测行为；写请求不允许取消。
    const allowedCancellations: RuntimeCancellation[] = ['resume', 'delete', 'archive'].map((phase) => ({ phase, method: 'GET', origin: apiOrigin, pathname: plans, reason: 'net::ERR_ABORTED' }));
    const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase, allowedCancellations }); audit.watch(engineer);
    const expectations: TrafficExpectation[] = [];
    const mutate = async <T,>(next: string, method: string, pathname: string, click: () => Promise<unknown>, status = 200): Promise<T> => {
      await engineer.waitForLoadState('networkidle'); phase = next;
      expectations.push({ phase, origin: apiOrigin, method, pathname, attempts: 1, responses: 1, status });
      const pending = engineer.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === method);
      await click(); const result = await pending; expect(result.status()).toBe(status);
      return status === 204 ? undefined as T : result.json() as Promise<T>;
    };
    await engineer.goto('/geo/plans?new=1');
    const planName = `GEO209 计划 ${suffix}`;
    await engineer.getByRole('textbox', { name: '计划名称', exact: true }).fill(planName);
    await engineer.getByRole('button', { name: '关闭向导' }).click();
    await expect(engineer.getByRole('dialog', { name: '要离开当前页面吗？' })).toBeVisible();
    await engineer.getByRole('button', { name: '继续编辑' }).click();
    await expect(engineer.getByRole('textbox', { name: '计划名称', exact: true })).toHaveValue(planName);
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(engineer.getByRole('heading', { name: '2. 监测对象', exact: true })).toBeFocused();
    await engineer.waitForLoadState('networkidle');
    await engineer.getByRole('searchbox', { name: '搜索监测对象选项' }).fill(suffix);
    await choose(engineer, `选择对象角色：${subjectName}`, '主要监测对象');
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    await engineer.waitForLoadState('networkidle');
    await engineer.getByRole('searchbox', { name: '搜索问题变体选项' }).fill(suffix);
    await engineer.getByRole('button', { name: `选择问题变体：${promptName}`, exact: true }).click();
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    await engineer.waitForLoadState('networkidle');
    await engineer.getByRole('searchbox', { name: '搜索采集配置选项' }).fill(suffix);
    await engineer.getByRole('button', { name: `选择采集配置：${profileName}`, exact: true }).click();
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(engineer.getByRole('spinbutton', { name: '重复次数' })).toHaveValue('3');
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    await choose(engineer, '调度方式', '定时配置');
    await engineer.getByRole('textbox', { name: 'Cron 表达式' }).fill('0 9 * * *');
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    const serverPreview = await mutate<components['schemas']['GeoMonitoringPlanPreview']>('preview', 'POST', `${plans}/preview`, () => engineer.getByRole('button', { name: '预览当前配置' }).click());
    expect(serverPreview).toMatchObject({ run_count: 3, manual_run_count: 3, estimated_cost: { value: null }, blockers: [] });
    await expect(engineer.getByText('服务端运行矩阵：1 × 1 × 3 = 3。保存时服务端会重新校验当前资源与运行资格。')).toBeVisible();
    for (const width of [375, 768, 1024, 1440]) {
      await engineer.setViewportSize({ width, height: 900 });
      expect(await engineer.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(engineer.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
      if (width === 375) {
        const empty = engineer.getByText('暂无监测计划', { exact: true });
        const bounds = await empty.boundingBox();
        expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await engineer.evaluate(() => window.scrollTo(0, 0));
        await engineer.screenshot({ path: testInfo.outputPath('geo209-wizard-mobile.png'), fullPage: true });
      }
    }
    await engineer.evaluate(() => window.scrollTo(0, 0));
    await engineer.screenshot({ path: testInfo.outputPath('geo209-wizard-preview.png'), fullPage: true });
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    const created = await mutate<Plan>('create', 'POST', plans, () => engineer.getByRole('button', { name: '创建监测计划', exact: true }).click(), 201);
    expect(created).toMatchObject({ status: 'DISABLED', revision: 0, prompt_variant_ids: [variant.id], collection_profile_ids: [profile.summary.id], subjects: [{ subject_id: subject.id, role: 'PRIMARY' }], cron_expression: '0 9 * * *' });
    await expect(engineer).toHaveURL(new RegExp(`selected=${created.id}`));
    const detail = engineer.getByRole('region', { name: '监测计划详情' });
    await expect(detail.getByText(/NOT_IMPLEMENTED/)).toBeVisible();
    for (const [command, label, revision, status] of [['activate', '启用计划', 1, 'ACTIVE'], ['pause', '暂停计划', 2, 'PAUSED'], ['resume', '恢复计划', 3, 'ACTIVE']] as const) {
      await planAction(engineer, label);
      const result = await mutate<Plan>(command, 'POST', `${plans}/${created.id}/${command}`, () => engineer.getByRole('dialog', { name: `确认${label}` }).getByRole('button', { name: '确认操作' }).click());
      expect(result).toMatchObject({ status, revision });
      await engineer.waitForLoadState('networkidle');
    }
    await engineer.reload(); await expect(detail.getByText('Revision 3', { exact: true })).toBeVisible();
    await planAction(engineer, '修订配置');
    await engineer.getByRole('textbox', { name: '计划名称', exact: true }).fill(`${planName} 已修订`);
    await engineer.getByRole('button', { name: '7. 服务端预览', exact: true }).click();
    await mutate('revision-preview', 'POST', `${plans}/preview`, () => engineer.getByRole('button', { name: '预览当前配置' }).click());
    await engineer.getByRole('button', { name: '下一步', exact: true }).click();
    const revised = await mutate<Plan>('revision', 'PATCH', `${plans}/${created.id}`, () => engineer.getByRole('button', { name: '保存计划配置' }).click());
    expect(revised.revision).toBe(4); expect(revised.status).toBe('ACTIVE');
    await engineer.waitForLoadState('networkidle');
    await planAction(engineer, '复制为新计划');
    const copyDialog = engineer.getByRole('dialog', { name: '确认复制为新计划' });
    await copyDialog.getByRole('textbox', { name: '新计划名称' }).fill(`${planName} 副本`);
    const copied = await mutate<Plan>('copy', 'POST', `${plans}/${created.id}/copy`, () => copyDialog.getByRole('button', { name: '确认操作' }).click(), 201);
    expect(copied).toMatchObject({ status: 'DISABLED', revision: 0 }); expect(copied.id).not.toBe(created.id);
    await expect(engineer).toHaveURL(new RegExp(`selected=${copied.id}`));
    await planAction(engineer, '删除计划');
    await mutate('delete', 'DELETE', `${plans}/${copied.id}`, () => engineer.getByRole('dialog', { name: '确认删除计划' }).getByRole('button', { name: '确认操作' }).click(), 204);
    await expect(engineer.getByRole('dialog', { name: '监测计划工作区' })).toBeHidden();
    await engineer.waitForLoadState('networkidle');
    await engineer.goto(`/geo/plans?selected=${created.id}&q=${suffix}&schedule_kind=CRON&sort=NAME_ASC`);
    await planAction(engineer, '归档计划');
    const archived = await mutate<Plan>('archive', 'POST', `${plans}/${created.id}/archive`, () => engineer.getByRole('dialog', { name: '确认归档计划' }).getByRole('button', { name: '确认操作' }).click());
    expect(archived).toMatchObject({ status: 'ARCHIVED', revision: 5, available_actions: ['COPY'] });
    await engineer.waitForLoadState('networkidle'); await engineer.reload();
    expect(await body<Plan>(await engineer.request.get(`${api}${plans}/${created.id}`))).toMatchObject({ status: 'ARCHIVED', revision: 5, name: `${planName} 已修订` });
    await engineer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(engineer.getByRole('textbox', { name: '搜索计划名称' })).toHaveValue(suffix);
    await expect(engineer.getByRole('combobox', { name: '筛选调度' })).toContainText('定时配置');
    expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
    expect(audit.errors).toEqual([]);
    expect(audit.attempts.some((item) => /\/(run|runs|batches)(\/|$)/.test(item.pathname))).toBe(false);
  } finally { await registerCurrentRealStackCookies(context, api); await context.close(); }
});
