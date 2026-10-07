# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: insights-real-stack.spec.ts >> 全筛选、真实汇总与明细、URL恢复、表格替代和键盘焦点
- Location: tests/e2e/insights-real-stack.spec.ts:16:1

# Error details

```
Error: /api/v1/geo/observation-runs/af61ac00-fcc5-451b-b852-2b38be68dd9d/manual-submit

expect(received).toBe(expected) // Object.is equality

Expected: 201
Received: 422
```

# Test source

```ts
  1   | /** GEO-408 虚构前置配置；已存在的业务写入口全部使用 UI。 */
  2   | import { randomUUID } from 'node:crypto';
  3   | import { expect, type APIResponse, type Page, type Response } from '@playwright/test';
  4   | import type { components } from '../../src/shared/api/generated/schema';
  5   | import { registerRealStackLoginSecrets } from './real-stack-session';
  6   | import { registerArtifactSecrets } from './secret-artifact';
  7   | 
  8   | export const api = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
  9   | export const provider = process.env.PARTSIGNAL_E2E_GEO_PROVIDER_URL ?? 'http://127.0.0.1:19012';
  10  | export const runs = '/api/v1/geo/observation-runs';
  11  | export const batches = '/api/v1/geo/observation-batches';
  12  | const surfaces = '/api/v1/geo/engine-surfaces';
  13  | const profiles = '/api/v1/geo/collection-profiles';
  14  | const plans = '/api/v1/geo/monitoring-plans';
  15  | type Schema = components['schemas'];
  16  | export async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
> 17  |   expect(response.status(), new URL(response.url()).pathname).toBe(status);
      |                                                               ^ Error: /api/v1/geo/observation-runs/af61ac00-fcc5-451b-b852-2b38be68dd9d/manual-submit
  18  |   return response.json() as Promise<T>;
  19  | }
  20  | export async function login(page: Page) {
  21  |   const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  22  |   if (!password) throw new Error('真实栈必须提供管理员验收密码');
  23  |   const auth = await body<Schema['AuthSession']>(await page.request.post(`${api}/api/v1/auth/login`, {
  24  |     data: { username: 'admin', password },
  25  |   }));
  26  |   await registerRealStackLoginSecrets(page.context(), api, auth.csrf_token);
  27  |   return auth;
  28  | }
  29  | export async function uiCommand<T>(page: Page, path: string, click: () => Promise<unknown>, status = 200) {
  30  |   const pending = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === path);
  31  |   await click();
  32  |   return body<T>(await pending, status);
  33  | }
  34  | async function choose(page: Page, label: string, option: string) {
  35  |   await page.getByRole('combobox', { name: label, exact: true }).click();
  36  |   await page.getByRole('option', { name: option, exact: true }).click();
  37  | }
  38  | async function configurationAction<T>(page: Page, path: string, label: string) {
  39  |   await page.getByRole('region', { name: /^(观测面|采集配置)详情$/ }).getByRole('button', { name: /更多操作/ }).click();
  40  |   await page.getByRole('menuitem', { name: label, exact: true }).click();
  41  |   return uiCommand<T>(page, path, () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click());
  42  | }
  43  | export async function configuration(page: Page) {
  44  |   const suffix = randomUUID();
  45  |   const secret = `geo408-fake-${randomUUID()}`;
  46  |   await registerArtifactSecrets([secret]);
  47  |   await page.goto('/settings/ai');
  48  |   await page.getByRole('button', { name: '创建渠道', exact: true }).click();
  49  |   const channelDialog = page.getByRole('dialog', { name: '创建 AI 渠道' });
  50  |   await channelDialog.getByRole('textbox', { name: '渠道名称' }).fill(`GEO408 ${suffix}`);
  51  |   await channelDialog.getByRole('textbox', { name: 'API 根地址' }).fill(`${provider}/v1`);
  52  |   await channelDialog.getByLabel('API Key').fill(secret);
  53  |   const channel = await uiCommand<Schema['AIChannel']>(page, '/api/v1/ai-channels', () => channelDialog.getByRole('button', { name: '创建渠道', exact: true }).click(), 201);
  54  |   await expect(page).toHaveURL(new RegExp(`/settings/ai/${channel.id}`));
  55  |   await page.getByRole('tab', { name: '模型管理' }).click();
  56  |   await page.getByRole('button', { name: '手工新增' }).click();
  57  |   const modelDialog = page.getByRole('dialog', { name: '新增模型' });
  58  |   await modelDialog.getByRole('textbox', { name: '显示名称' }).fill(`GEO408 模型 ${suffix}`);
  59  |   await modelDialog.getByRole('textbox', { name: 'Model ID' }).fill('geo-fixture-model');
  60  |   const model = await uiCommand<Schema['AIModel']>(page, `/api/v1/ai-channels/${channel.id}/models`, () => modelDialog.getByRole('button', { name: '保存模型' }).click(), 201);
  61  |   const row = page.getByRole('row').filter({ hasText: 'geo-fixture-model' });
  62  |   await row.getByRole('button', { name: '测试连接' }).click();
  63  |   await uiCommand(page, `/api/v1/ai-models/${model.id}/test`, () => page.getByRole('dialog', { name: /测试模型/ }).getByRole('button', { name: '开始测试' }).click());
  64  |   await expect(page.getByText(/连接测试通过；模型仍保持停用/)).toBeVisible();
  65  |   await uiCommand(page, `/api/v1/ai-models/${model.id}/enable`, () => row.getByRole('button', { name: '启用模型' }).click());
  66  |   await uiCommand(page, `/api/v1/ai-channels/${channel.id}/enable`, () => row.getByRole('button', { name: '启用所属渠道' }).click());
  67  | 
  68  |   const subjectName = `GEO408 虚构参考型号 ${suffix}`;
  69  |   await page.goto('/configuration/geo-entities');
  70  |   await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  71  |   await choose(page, '对象类型', '参考型号');
  72  |   await page.getByRole('textbox', { name: '规范名称', exact: true }).fill(subjectName);
  73  |   await page.getByRole('textbox', { name: '显示名称', exact: true }).fill(subjectName);
  74  |   await uiCommand<Schema['GeoSubjectOut']>(page, '/api/v1/geo/subjects', () => page.getByRole('button', { name: '创建监测对象', exact: true }).click(), 201);
  75  |   await page.waitForLoadState('networkidle');
  76  |   await page.goto('/configuration/geo-surfaces');
  77  |   await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  78  |   await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`GEO408 API ${suffix}`);
  79  |   await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo408-${suffix}`);
  80  |   await choose(page, '观测面类型', '模型 API');
  81  |   await choose(page, '合规状态', '已批准');
  82  |   const surface = await uiCommand<Schema['GeoEngineSurfaceRead']>(page, surfaces, () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  83  |   await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  84  |   await configurationAction(page, `${surfaces}/${surface.summary.id}/enable`, '启用观测面');
  85  |   await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  86  |   await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  87  |   await choose(page, '采集模式', 'API');
  88  |   await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  89  |   const profileName = `GEO408 API 配置 ${suffix}`;
  90  |   await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(profileName);
  91  |   await page.getByRole('textbox', { name: '适配器标识', exact: true }).fill('openai-compatible-chat');
  92  |   await page.getByRole('textbox', { name: 'AI 渠道 ID', exact: true }).fill(channel.id);
  93  |   await page.getByRole('textbox', { name: 'AI 模型 ID', exact: true }).fill(model.id);
  94  |   const profile = await uiCommand<Schema['GeoCollectionProfileRead']>(page, profiles, () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  95  |   expect(profile.summary.last_test_status).toBe('UNTESTED');
  96  |   await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  97  |   const tested = await configurationAction<Schema['GeoCollectionProfileRead']>(page, `${profiles}/${profile.summary.id}/test`, '测试连接');
  98  |   expect(tested.summary).toMatchObject({ last_test_status: 'PASSED', is_active: false });
  99  |   const enabled = await configurationAction<Schema['GeoCollectionProfileRead']>(page, `${profiles}/${profile.summary.id}/enable`, '启用采集配置');
  100 |   expect(enabled.summary.is_active).toBe(true);
  101 |   return { subjectName, profileName, suffix, secret };
  102 | }
  103 | type Configuration = Awaited<ReturnType<typeof configuration>>;
  104 | export async function createPlan(page: Page, graph: Configuration, mode: 'SUCCESS' | 'RATE_LIMIT' | 'UNKNOWN' | 'INTERNAL' | 'BUDGET') {
  105 |   const suffix = randomUUID();
  106 |   const promptName = `GEO408 ${mode} ${suffix}`;
  107 |   await page.goto('/geo/topics');
  108 |   await page.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
  109 |   const dialog = page.getByRole('dialog', { name: '创建 Query Topic', exact: true });
  110 |   const topicName = `GEO408 虚构主题 ${suffix}`;
  111 |   await dialog.getByRole('textbox', { name: '标准问题', exact: true }).fill(topicName);
  112 |   await dialog.getByRole('textbox', { name: '变体 1', exact: true }).fill(`GEO408 虚构问题 ${suffix}`);
  113 |   const topic = await uiCommand<Schema['QueryTopic']>(page, '/api/v1/query-topics', () => dialog.getByRole('button', { name: '创建', exact: true }).click(), 201);
  114 |   await expect(dialog).toBeHidden();
  115 |   await page.waitForLoadState('networkidle');
  116 |   await page.goto('/geo/questions?new=1');
  117 |   await choose(page, '问题主题', topicName);
```