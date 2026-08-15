/** 通过 V2 页面验证 AI Channel Configuration 的真实栈闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AIChannel = components['schemas']['AIChannel'];
type AIModelList = components['schemas']['AIModelList'];
type AuditLogList = components['schemas']['AuditLogList'];
type AuthSession = components['schemas']['AuthSession'];
type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentTask = components['schemas']['ContentTask'];
type FactVersion = components['schemas']['FactVersion'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformPrompt = components['schemas']['PlatformPromptDetail'];
type PlatformType = components['schemas']['PlatformType'];
type Product = components['schemas']['Product'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const fakeAiBaseUrl = process.env.PARTSIGNAL_E2E_FAKE_AI_BASE_URL ?? 'http://127.0.0.1:9001';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.setTimeout(180_000);

async function responseBody<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`真实 E2E API 请求失败：${response.status()} ${response.url()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page): Promise<AuthSession> {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return responseBody<T>(await page.request.get(`${apiBaseUrl}${path}`));
}

async function command<T>(
  page: Page,
  csrfToken: string,
  path: string,
  data: unknown,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST',
  headers: Record<string, string> = {},
): Promise<T> {
  return responseBody<T>(await page.request.fetch(`${apiBaseUrl}${path}`, {
    data,
    headers: { 'X-CSRF-Token': csrfToken, ...headers },
    method,
  }));
}

async function createSupportData(page: Page, session: AuthSession, suffix: string) {
  const prompt = await command<PlatformPrompt>(page, session.csrf_token, '/api/v1/platform-prompts', {
    name: `Configuration Prompt ${suffix}`,
    template_markdown: '仅依据已批准事实生成技术说明，不得补充未知产品事实。',
  });
  const platformType = await command<PlatformType>(page, session.csrf_token, '/api/v1/platform-types', {
    name: `Configuration 平台类型 ${suffix}`,
    slug: `configuration-${suffix}`,
  });
  const platform = await command<PlatformProfile>(page, session.csrf_token, '/api/v1/platform-profiles', {
    allowed_domains: [`${suffix}.example.invalid`],
    name: `Configuration 平台 ${suffix}`,
    platform_prompt_id: prompt.id,
    platform_type_id: platformType.id,
    slug: `configuration-platform-${suffix}`,
  });
  const partNumber = `CONFIG-${suffix}`;
  const product = await command<Product>(page, session.csrf_token, '/api/v1/products', {
    brand: 'PartSignal E2E',
    category: 'AI Channel Configuration 真实闭环',
    part_number: partNumber,
  });
  const initialFacts = await apiGet<ProductFactsDraft>(page, `/api/v1/products/${product.id}/facts`);
  const savedFacts = await command<ProductFactsDraft>(
    page,
    session.csrf_token,
    `/api/v1/products/${product.id}/facts`,
    {
      body_markdown: `# ${partNumber}\n\n- 工作电压：5 V\n- 数据性质：仅用于本地虚构验收`,
      classification: 'PUBLIC',
      expected_revision: initialFacts.revision,
    },
    'PUT',
  );
  const submitted = await command<FactVersion>(
    page,
    session.csrf_token,
    `/api/v1/products/${product.id}/fact-review-submissions`,
    { change_summary: `Configuration E2E ${suffix}`, expected_revision: savedFacts.revision },
  );
  const fact = await command<FactVersion>(
    page,
    session.csrf_token,
    `/api/v1/fact-versions/${submitted.id}/approve`,
    { comment: '', expected_revision: submitted.revision },
  );
  const task = await command<ContentTask>(
    page,
    session.csrf_token,
    '/api/v1/content-tasks',
    {
      fact_version_id: fact.id,
      platform_profile_id: platform.id,
      product_id: product.id,
    },
    'POST',
    { 'Idempotency-Key': `configuration-${suffix}` },
  );
  return { partNumber, platform, prompt, task };
}

async function openContentEditor(page: Page, partNumber: string) {
  await page.getByRole('link', { name: '内容任务', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '内容任务' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索内容任务' });
  await search.fill(partNumber);
  await search.press('Enter');
  const row = page.getByRole('row').filter({
    has: page.getByRole('link', { name: partNumber, exact: true }),
  });
  await row.getByRole('link', { name: '创建初稿', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+\/editor$/i);
}

async function openPrompt(page: Page, promptName: string) {
  await page.getByRole('link', { name: 'Prompt 管理', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索 Prompt 名称' });
  await search.fill(promptName);
  const prompt = page.getByRole('button', { name: new RegExp(promptName) });
  await expect(prompt).toBeVisible();
  await prompt.click();
}

async function openChannel(page: Page, channelName: string) {
  await page.getByRole('link', { name: 'AI 渠道', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索 AI 渠道' });
  await search.fill(channelName);
  await search.press('Enter');
  await page.getByRole('link', { name: channelName, exact: true }).click();
}

async function createHeader(
  page: Page,
  name: string,
  value: string,
  sensitive: boolean,
) {
  await page.getByRole('button', { name: '新增 Header' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Header' });
  await dialog.getByRole('textbox', { name: 'Header 名' }).fill(name);
  await dialog.getByLabel('替换值').fill(value);
  if (sensitive) {
    await dialog.getByRole('combobox', { name: '类型' }).click();
    await page.getByRole('option', { name: '敏感且永不回显' }).click();
  }
  await dialog.getByRole('button', { name: '保存 Header' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
}

async function deleteModel(page: Page, row: Locator, displayName: string) {
  await row.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除模型' }).click();
  await page.getByRole('dialog', { name: `删除模型“${displayName}”？` })
    .getByRole('button', { name: '删除模型' })
    .click();
  await expect(row).toHaveCount(0);
}

function assertNoProtectedValues(surface: string, value: unknown, protectedValues: string[]) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (protectedValues.some((secret) => serialized.includes(secret))) {
    throw new Error(`${surface} 包含受保护的 E2E credential`);
  }
}

test('AI Channel Configuration 真实栈闭环', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const modelId = `e2e-config-model-${suffix}`;
  const initialApiKey = `e2e-config-initial-key-${suffix}`;
  const replacementApiKey = `e2e-config-replacement-key-${suffix}`;
  const initialSecretHeader = `e2e-config-initial-secret-${suffix}`;
  const replacementSecretHeader = `e2e-config-replacement-secret-${suffix}`;
  const protectedValues = [
    initialApiKey,
    replacementApiKey,
    initialSecretHeader,
    replacementSecretHeader,
  ];
  const browserApiRequests: Array<{ method: string; url: string }> = [];
  const browserGetBodies: Array<Promise<string>> = [];
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('request', (request) => {
    if (request.url().startsWith(apiBaseUrl)) {
      browserApiRequests.push({ method: request.method(), url: request.url() });
    }
  });
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && response.url().startsWith(apiBaseUrl)) {
      browserGetBodies.push(response.text().catch(() => ''));
    }
  });

  const session = await login(page);
  const support = await createSupportData(page, session, suffix);

  await page.goto(`/settings/prompts?promptId=${support.prompt.id}`);
  await expect(page.getByRole('combobox', { name: 'Test Context' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Test Context' }).click();
  await expect(page.getByRole('option', { name: new RegExp(support.partNumber) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('当前没有已启用且测试通过的模型。')).toBeVisible();

  await openContentEditor(page, support.partNumber);
  await page.getByRole('button', { name: 'AI 生成首稿' }).click();
  const emptyGeneration = page.getByRole('dialog', { name: '确认 Prompt 与模型' });
  await expect(emptyGeneration.getByText('当前没有可用模型。')).toBeVisible();
  await emptyGeneration.getByRole('button', { name: '取消' }).click();

  await page.getByRole('link', { name: 'AI 渠道', exact: true }).click();
  await page.getByRole('button', { name: '创建渠道' }).click();
  const create = page.getByRole('dialog', { name: '创建 AI 渠道' });
  const createdName = `E2E 配置渠道 ${suffix}`;
  await create.getByRole('textbox', { name: '渠道名称' }).fill(createdName);
  await create.getByRole('textbox', { name: '描述' }).fill('Configuration real-stack 初始配置');
  await create.getByRole('textbox', { name: 'API 根地址' }).fill(`${fakeAiBaseUrl}/v1`);
  await create.getByLabel('API Key').fill(initialApiKey);
  await create.getByRole('button', { name: '创建渠道' }).click();
  await expect(page).toHaveURL(/\/settings\/ai\/[0-9a-f-]+\?tab=basic$/i);
  const channelId = new URL(page.url()).pathname.split('/').at(-1);
  if (!channelId) throw new Error('创建渠道后 URL 缺少 channelId');

  const savedName = `E2E 已保存渠道 ${suffix}`;
  await page.getByRole('textbox', { name: '渠道名称' }).fill(savedName);
  await page.getByRole('textbox', { name: '描述' }).fill('Configuration real-stack 完整配置');
  await page.getByRole('tab', { name: '请求配置' }).click();
  await page.getByRole('spinbutton', { name: '超时时间（秒）' }).fill('31');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('渠道配置已保存')).toBeVisible();

  const localDraftName = `E2E 本地冲突草稿 ${suffix}`;
  await page.getByRole('tab', { name: '基本信息' }).click();
  await page.getByRole('textbox', { name: '渠道名称' }).fill(localDraftName);
  const current = await apiGet<AIChannel>(page, `/api/v1/ai-channels/${channelId}`);
  const serverName = `E2E 服务端渠道 ${suffix}`;
  await command<AIChannel>(page, session.csrf_token, `/api/v1/ai-channels/${channelId}`, {
    base_url: current.base_url,
    description: current.description,
    expected_revision: current.revision,
    name: serverName,
    protocol_type: current.protocol_type,
    provider_brand: current.provider_brand,
    timeout_seconds: current.timeout_seconds,
  }, 'PATCH');
  const patchesBeforeConflict = browserApiRequests.filter((request) => (
    request.method === 'PATCH'
    && new URL(request.url).pathname === `/api/v1/ai-channels/${channelId}`
  )).length;
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText(/当前非敏感草稿已保留/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: '渠道名称' })).toHaveValue(localDraftName);
  await page.waitForTimeout(150);
  expect(browserApiRequests.filter((request) => (
    request.method === 'PATCH'
    && new URL(request.url).pathname === `/api/v1/ai-channels/${channelId}`
  )))
    .toHaveLength(patchesBeforeConflict + 1);
  await page.getByRole('button', { name: '重新加载服务端版本' }).click();
  await expect(page.getByRole('textbox', { name: '渠道名称' })).toHaveValue(serverName);

  await page.getByRole('tab', { name: '请求配置' }).click();
  await createHeader(page, 'X-E2E-Region', `configuration-${suffix}`, false);
  await createHeader(page, 'X-E2E-Secret', initialSecretHeader, true);

  await page.getByRole('tab', { name: '模型管理' }).click();
  await page.getByRole('button', { name: '发现模型' }).click();
  const discovery = page.getByRole('dialog', { name: '发现远端模型' });
  await expect(discovery.getByText('e2e-model')).toBeVisible();
  await discovery.getByRole('button', { name: '添加' }).click();
  let modelDialog = page.getByRole('dialog', { name: '新增模型' });
  await modelDialog.getByRole('button', { name: '保存模型' }).click();
  const discoveredRow = page.getByRole('row').filter({ hasText: 'e2e-model' });
  await expect(discoveredRow).toBeVisible();

  await page.getByRole('button', { name: '手工新增' }).click();
  modelDialog = page.getByRole('dialog', { name: '新增模型' });
  await modelDialog.getByRole('textbox', { name: '显示名称' }).fill(`E2E 配置模型 ${suffix}`);
  await modelDialog.getByRole('textbox', { name: 'Model ID' }).fill(modelId);
  await modelDialog.getByRole('textbox', { name: '请求参数 JSON' }).fill('{"temperature":0}');
  await modelDialog.getByRole('button', { name: '保存模型' }).click();
  const finalModelName = `E2E 配置模型已编辑 ${suffix}`;
  let credentialRow = page.getByRole('row').filter({ hasText: modelId });
  await credentialRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '编辑模型' }).click();
  const editModel = page.getByRole('dialog', { name: '编辑模型' });
  await editModel.getByRole('textbox', { name: '显示名称' }).fill(finalModelName);
  await editModel.getByRole('textbox', { name: '请求参数 JSON' }).fill('{"temperature":0.1}');
  await editModel.getByRole('button', { name: '保存模型' }).click();
  credentialRow = page.getByRole('row').filter({ hasText: modelId });
  await expect(credentialRow).toContainText(finalModelName);
  await deleteModel(page, discoveredRow, 'e2e-model');

  await credentialRow.getByRole('button', { name: '测试连接' }).click();
  await page.getByRole('dialog', { name: new RegExp(`测试模型“${finalModelName}`) })
    .getByRole('button', { name: '开始测试' })
    .click();
  await expect(page.getByText(/连接测试失败：AI 渠道返回 HTTP 400/)).toBeVisible();
  await expect(credentialRow).toContainText('已停用');
  expect(await responseBody<{ count: number }>(
    await page.request.get(`${fakeAiBaseUrl}/e2e/calls/${modelId}`),
  )).toEqual({ count: 1 });

  await page.getByRole('tab', { name: '请求配置' }).click();
  await page.getByRole('button', { name: '重新配置', exact: true }).click();
  const replaceKey = page.getByRole('dialog', { name: '重新配置 API Key' });
  await replaceKey.getByLabel('新的 API Key').fill(replacementApiKey);
  await replaceKey.getByRole('button', { name: '保存新密钥' }).click();
  const sensitiveRow = page.getByRole('row').filter({ hasText: 'X-E2E-Secret' });
  await sensitiveRow.getByRole('button', { name: '重新配置 Header' }).click();
  const editHeader = page.getByRole('dialog', { name: '编辑 Header' });
  await editHeader.getByLabel('替换值').fill(replacementSecretHeader);
  await editHeader.getByRole('button', { name: '保存 Header' }).click();

  await page.getByRole('tab', { name: '模型管理' }).click();
  credentialRow = page.getByRole('row').filter({ hasText: modelId });
  await credentialRow.getByRole('button', { name: /测试连接|查看失败并重试/ }).click();
  await page.getByRole('dialog', { name: new RegExp(`测试模型“${finalModelName}`) })
    .getByRole('button', { name: '开始测试' })
    .click();
  await expect(page.getByText(/连接测试通过；模型仍保持停用/)).toBeVisible();
  await expect(credentialRow).toContainText('已停用');
  await credentialRow.getByRole('button', { name: '启用模型' }).click();
  await expect(page.getByText('模型已启用')).toBeVisible();
  await credentialRow.getByRole('button', { name: '启用所属渠道' }).click();
  await expect(page.getByText('已启用', { exact: true }).first()).toBeVisible();
  await expect(credentialRow.getByRole('button', { name: '查看运行' })).toBeVisible();

  await openPrompt(page, support.prompt.name);
  await expect(page.getByText('当前没有已启用且测试通过的模型。')).toHaveCount(0);
  await page.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: new RegExp(finalModelName) })).toBeVisible();
  await page.keyboard.press('Escape');

  await openContentEditor(page, support.partNumber);
  await page.getByRole('button', { name: 'AI 生成首稿' }).click();
  let generation = page.getByRole('dialog', { name: '确认 Prompt 与模型' });
  await generation.getByRole('combobox', { name: '模型' }).click();
  await expect(page.getByRole('option', { name: new RegExp(finalModelName) })).toBeVisible();
  await page.keyboard.press('Escape');
  await generation.getByRole('button', { name: '取消' }).click();

  await openChannel(page, serverName);
  await page.getByRole('tab', { name: '使用统计' }).click();
  await expect(page.getByText('业务作业').locator('..')).toContainText('0');

  await openContentEditor(page, support.partNumber);
  await page.getByRole('button', { name: 'AI 生成首稿' }).click();
  generation = page.getByRole('dialog', { name: '确认 Prompt 与模型' });
  await generation.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: new RegExp(finalModelName) }).click();
  await generation.getByRole('button', { name: '确认 Prompt 与模型并开始生成' }).click();
  await expect(page.getByRole('textbox', { name: '标题' })).toHaveValue('连接测试', {
    timeout: 30_000,
  });
  const context = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${support.task.id}/editor-context`,
  );
  expect(context.current_content).toMatchObject({ source_type: 'AI', status: 'DRAFT' });
  expect(await responseBody<{ count: number }>(
    await page.request.get(`${fakeAiBaseUrl}/e2e/calls/${modelId}`),
  )).toEqual({ count: 3 });
  const providerPayload = await responseBody<Record<string, unknown>>(
    await page.request.get(`${fakeAiBaseUrl}/e2e/payloads/${modelId}`),
  );
  expect(Object.keys(providerPayload).sort()).toEqual(['messages', 'model', 'stream', 'temperature']);

  await openChannel(page, serverName);
  await page.getByRole('tab', { name: '使用统计' }).click();
  await page.getByRole('combobox', { name: '统计时间范围' }).click();
  await page.getByRole('option', { name: '全部时间' }).click();
  await expect(page.getByText('业务作业', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('成功', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('失败', { exact: true }).locator('..')).toContainText('0');

  await page.getByRole('tab', { name: '操作日志' }).click();
  await expect(page.getByRole('row').filter({ hasText: '替换 API Key' })).toBeVisible();
  const logRow = page.getByRole('row').filter({ hasText: '替换 API Key' }).first();
  await logRow.getByRole('button', { name: '查看详情' }).click();
  const auditDetail = page.getByRole('dialog', { name: '渠道操作日志详情' });
  await expect(auditDetail.getByText('AI 渠道凭据已更新')).toBeVisible();
  await page.keyboard.press('Escape');
  const logs = await apiGet<AuditLogList>(
    page,
    `/api/v1/ai-channels/${channelId}/audit-logs?page=1&page_size=50`,
  );
  const actions = new Set(logs.items.map((item) => item.action));
  for (const action of [
    'ai_channel.created',
    'ai_channel.updated',
    'ai_channel.api_key_replaced',
    'ai_channel_header.created',
    'ai_channel_header.updated',
    'ai_model.created',
    'ai_model.updated',
    'ai_model.enabled',
    'ai_channel.enabled',
  ]) {
    expect(actions).toContain(action);
  }
  if (Array.from(actions).some((action) => action.includes('discover') || action.includes('test'))) {
    throw new Error('模型发现或连接测试被错误写入永久配置审计');
  }
  const modelList = await apiGet<AIModelList>(page, `/api/v1/ai-channels/${channelId}/models`);

  await page.getByRole('button', { name: `更多操作：${serverName}` }).click();
  await page.getByRole('menuitem', { name: '停用渠道' }).click();
  await page.getByRole('dialog', { name: `停用渠道“${serverName}”？` })
    .getByRole('button', { name: '停用渠道' })
    .click();
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '模型管理' }).click();
  credentialRow = page.getByRole('row').filter({ hasText: modelId });
  await credentialRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '停用模型' }).click();
  await page.getByRole('dialog', { name: `停用模型“${finalModelName}”？` })
    .getByRole('button', { name: '停用模型' })
    .click();
  await expect(page.getByText('模型已停用')).toBeVisible();

  await page.getByRole('tab', { name: '请求配置' }).click();
  const regionRow = page.getByRole('row').filter({ hasText: 'X-E2E-Region' });
  await regionRow.getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '删除 Header' }).click();
  await page.getByRole('dialog', { name: /删除 Header“X-E2E-Region”/ })
    .getByRole('button', { name: '删除 Header' })
    .click();
  await expect(regionRow).toHaveCount(0);

  await page.getByRole('tab', { name: '模型管理' }).click();
  credentialRow = page.getByRole('row').filter({ hasText: modelId });
  await deleteModel(page, credentialRow, finalModelName);
  await page.getByRole('button', { name: `更多操作：${serverName}` }).click();
  await page.getByRole('menuitem', { name: '删除渠道' }).click();
  await page.getByRole('dialog', { name: `删除渠道“${serverName}”？` })
    .getByRole('button', { name: '删除渠道' })
    .click();
  await expect(page).toHaveURL('/settings/ai?page=1&pageSize=20');
  await expect(page.getByRole('link', { name: serverName, exact: true })).toHaveCount(0);

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  assertNoProtectedValues('浏览器请求 URL', browserApiRequests, protectedValues);
  assertNoProtectedValues('浏览器 GET 响应', await Promise.all(browserGetBodies), protectedValues);
  assertNoProtectedValues('浏览器 DOM', await page.locator('body').innerText(), protectedValues);
  assertNoProtectedValues('浏览器 storage', storage, protectedValues);
  assertNoProtectedValues('浏览器 console', consoleMessages, protectedValues);
  assertNoProtectedValues('Provider 请求体', providerPayload, protectedValues);
  assertNoProtectedValues('审计投影', logs, protectedValues);
  assertNoProtectedValues('模型读取投影', modelList, protectedValues);
});
