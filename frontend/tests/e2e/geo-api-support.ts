/** GEO-408 虚构前置配置；已存在的业务写入口全部使用 UI。 */
import { randomUUID } from 'node:crypto';
import { expect, type APIResponse, type Page, type Response } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { registerRealStackLoginSecrets } from './real-stack-session';
import { registerArtifactSecrets } from './secret-artifact';

export const api = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
export const provider = process.env.PARTSIGNAL_E2E_GEO_PROVIDER_URL ?? 'http://127.0.0.1:19012';
export const runs = '/api/v1/geo/observation-runs';
export const batches = '/api/v1/geo/observation-batches';
const surfaces = '/api/v1/geo/engine-surfaces';
const profiles = '/api/v1/geo/collection-profiles';
const plans = '/api/v1/geo/monitoring-plans';
type Schema = components['schemas'];
export async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
export async function login(page: Page) {
  const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('真实栈必须提供管理员验收密码');
  const auth = await body<Schema['AuthSession']>(await page.request.post(`${api}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
  await registerRealStackLoginSecrets(page.context(), api, auth.csrf_token);
  return auth;
}
export async function uiCommand<T>(page: Page, path: string, click: () => Promise<unknown>, status = 200) {
  const pending = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === path);
  await click();
  return body<T>(await pending, status);
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function configurationAction<T>(page: Page, path: string, label: string) {
  await page.getByRole('region', { name: /^(观测面|采集配置)详情$/ }).getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  return uiCommand<T>(page, path, () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click());
}
export async function configuration(page: Page) {
  const suffix = randomUUID();
  const secret = `geo408-fake-${randomUUID()}`;
  await registerArtifactSecrets([secret]);
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: '创建渠道', exact: true }).click();
  const channelDialog = page.getByRole('dialog', { name: '创建 AI 渠道' });
  await channelDialog.getByRole('textbox', { name: '渠道名称' }).fill(`GEO408 ${suffix}`);
  await channelDialog.getByRole('textbox', { name: 'API 根地址' }).fill(`${provider}/v1`);
  await channelDialog.getByLabel('API Key').fill(secret);
  const channel = await uiCommand<Schema['AIChannel']>(page, '/api/v1/ai-channels', () => channelDialog.getByRole('button', { name: '创建渠道', exact: true }).click(), 201);
  await expect(page).toHaveURL(new RegExp(`/settings/ai/${channel.id}`));
  await page.getByRole('tab', { name: '模型管理' }).click();
  await page.getByRole('button', { name: '手工新增' }).click();
  const modelDialog = page.getByRole('dialog', { name: '新增模型' });
  await modelDialog.getByRole('textbox', { name: '显示名称' }).fill(`GEO408 模型 ${suffix}`);
  await modelDialog.getByRole('textbox', { name: 'Model ID' }).fill('geo-fixture-model');
  const model = await uiCommand<Schema['AIModel']>(page, `/api/v1/ai-channels/${channel.id}/models`, () => modelDialog.getByRole('button', { name: '保存模型' }).click(), 201);
  const row = page.getByRole('row').filter({ hasText: 'geo-fixture-model' });
  await row.getByRole('button', { name: '测试连接' }).click();
  await uiCommand(page, `/api/v1/ai-models/${model.id}/test`, () => page.getByRole('dialog', { name: /测试模型/ }).getByRole('button', { name: '开始测试' }).click());
  await expect(page.getByText(/连接测试通过；模型仍保持停用/)).toBeVisible();
  await uiCommand(page, `/api/v1/ai-models/${model.id}/enable`, () => row.getByRole('button', { name: '启用模型' }).click());
  await uiCommand(page, `/api/v1/ai-channels/${channel.id}/enable`, () => row.getByRole('button', { name: '启用所属渠道' }).click());

  const subjectName = `GEO408 虚构参考型号 ${suffix}`;
  await page.goto('/configuration/geo-entities');
  await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  await choose(page, '对象类型', '参考型号');
  await page.getByRole('textbox', { name: '规范名称', exact: true }).fill(subjectName);
  await page.getByRole('textbox', { name: '显示名称', exact: true }).fill(subjectName);
  await uiCommand<Schema['GeoSubjectOut']>(page, '/api/v1/geo/subjects', () => page.getByRole('button', { name: '创建监测对象', exact: true }).click(), 201);
  await page.waitForLoadState('networkidle');
  await page.goto('/configuration/geo-surfaces');
  await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`GEO408 API ${suffix}`);
  await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo408-${suffix}`);
  await choose(page, '观测面类型', '模型 API');
  await choose(page, '合规状态', '已批准');
  const surface = await uiCommand<Schema['GeoEngineSurfaceRead']>(page, surfaces, () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await configurationAction(page, `${surfaces}/${surface.summary.id}/enable`, '启用观测面');
  await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  await choose(page, '采集模式', 'API');
  await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  const profileName = `GEO408 API 配置 ${suffix}`;
  await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(profileName);
  await page.getByRole('textbox', { name: '适配器标识', exact: true }).fill('openai-compatible-chat');
  await page.getByRole('textbox', { name: 'AI 渠道 ID', exact: true }).fill(channel.id);
  await page.getByRole('textbox', { name: 'AI 模型 ID', exact: true }).fill(model.id);
  const profile = await uiCommand<Schema['GeoCollectionProfileRead']>(page, profiles, () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  expect(profile.summary.last_test_status).toBe('UNTESTED');
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  const tested = await configurationAction<Schema['GeoCollectionProfileRead']>(page, `${profiles}/${profile.summary.id}/test`, '测试连接');
  expect(tested.summary).toMatchObject({ last_test_status: 'PASSED', is_active: false });
  const enabled = await configurationAction<Schema['GeoCollectionProfileRead']>(page, `${profiles}/${profile.summary.id}/enable`, '启用采集配置');
  expect(enabled.summary.is_active).toBe(true);
  return { subjectName, profileName, suffix, secret };
}
type Configuration = Awaited<ReturnType<typeof configuration>>;
export async function createPlan(page: Page, graph: Configuration, mode: 'SUCCESS' | 'RATE_LIMIT' | 'UNKNOWN' | 'INTERNAL' | 'BUDGET') {
  const suffix = randomUUID();
  const promptName = `GEO408 ${mode} ${suffix}`;
  await page.goto('/geo/topics');
  await page.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建 Query Topic', exact: true });
  const topicName = `GEO408 虚构主题 ${suffix}`;
  await dialog.getByRole('textbox', { name: '标准问题', exact: true }).fill(topicName);
  await dialog.getByRole('textbox', { name: '变体 1', exact: true }).fill(`GEO408 虚构问题 ${suffix}`);
  const topic = await uiCommand<Schema['QueryTopic']>(page, '/api/v1/query-topics', () => dialog.getByRole('button', { name: '创建', exact: true }).click(), 201);
  await expect(dialog).toBeHidden();
  await page.waitForLoadState('networkidle');
  await page.goto('/geo/questions?new=1');
  await choose(page, '问题主题', topicName);
  await page.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(promptName);
  await choose(page, '点名属性', '非点名');
  await choose(page, '优先级', '核心');
  await page.getByRole('textbox', { name: '语言代码', exact: true }).fill('zh-CN');
  await page.getByRole('textbox', { name: '地区代码', exact: true }).fill('CN');
  await uiCommand(page, `/api/v1/geo/query-topics/${topic.id}/prompt-variants`, () => page.getByRole('button', { name: '创建变体', exact: true }).click(), 201);
  await page.waitForLoadState('networkidle');
  await page.goto('/geo/plans?new=1');
  const planName = `GEO408 ${mode} 计划 ${suffix}`;
  await page.getByRole('textbox', { name: '计划名称', exact: true }).fill(planName);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索监测对象选项' }).fill(graph.suffix);
  await choose(page, `选择对象角色：${graph.subjectName}`, '主要监测对象');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索问题变体选项' }).fill(suffix);
  await page.getByRole('button', { name: `选择问题变体：${promptName}`, exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索采集配置选项' }).fill(graph.suffix);
  await page.getByRole('button', { name: `选择采集配置：${graph.profileName}`, exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('spinbutton', { name: '重复次数' }).fill('1');
  if (mode === 'BUDGET') await page.getByRole('textbox', { name: '预算上限' }).fill('0.000001');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await uiCommand(page, `${plans}/preview`, () => page.getByRole('button', { name: '预览当前配置' }).click());
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const plan = await uiCommand<Schema['GeoMonitoringPlanDetail']>(page, plans, () => page.getByRole('button', { name: '创建监测计划', exact: true }).click(), 201);
  await expect(page.getByRole('region', { name: '监测计划详情' })).toBeVisible();
  // 预算不足的未启用计划仍允许从运行中心创建，Worker 最终执行准入。
  return { plan, planName, promptName };
}
export async function createBatch(page: Page, plan: Schema['GeoMonitoringPlanDetail'], planName: string, promptName: string) {
  await page.goto('/geo/runs?create=1');
  await page.getByRole('textbox', { name: '搜索可选计划' }).fill(planName);
  await page.getByRole('button', { name: '搜索计划', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`${planName} · Revision`) }).click();
  const result = await uiCommand<Schema['GeoBatchCreated']>(page, `${plans}/${plan.id}/run`, () => page.getByRole('button', { name: '确认创建批次', exact: true }).click(), 201);
  await expect(page).toHaveURL(new RegExp(`batch_id=${result.batch_id}`));
  await page.getByRole('region', { name: '运行列表' }).getByRole('button', { name: promptName, exact: true }).click();
  const runId = new URL(page.url()).searchParams.get('run_id');
  if (!runId) throw new Error('真实批次缺少 Run UUID');
  return { batchId: result.batch_id, runId };
}
export async function detail(page: Page, id: string) {
  return body<Schema['GeoRunDetail']>(await page.request.get(`${api}${runs}/${id}`));
}
export async function calls(page: Page, id: string) {
  return body<{ count: number }>(await page.request.get(`${provider}/__geo__/calls/${id}`));
}
