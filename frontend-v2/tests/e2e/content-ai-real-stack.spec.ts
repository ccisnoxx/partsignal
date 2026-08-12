/** 通过 V2 页面验证真实 PostgreSQL/FastAPI/Celery AI Production 闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AIChannel = components['schemas']['AIChannel'];
type AIModel = components['schemas']['AIModel'];
type AuthSession = components['schemas']['AuthSession'];
type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentVersion = components['schemas']['ContentVersion'];
type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobDetail = components['schemas']['GenerationJobDetail'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformPrompt = components['schemas']['PlatformPromptDetail'];
type PlatformType = components['schemas']['PlatformType'];

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const fakeAiBaseUrl = process.env.PARTSIGNAL_E2E_FAKE_AI_BASE_URL ?? 'http://127.0.0.1:9001';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.setTimeout(150_000);

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
  data?: unknown,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST',
): Promise<T> {
  return responseBody<T>(await page.request.fetch(`${apiBaseUrl}${path}`, {
    data,
    headers: { 'X-CSRF-Token': csrfToken },
    method,
  }));
}

async function configurePlatform(page: Page, csrfToken: string, suffix: string) {
  const platformPrompt = await command<PlatformPrompt>(page, csrfToken, '/api/v1/platform-prompts', {
    name: `V2 AI Prompt ${suffix}`,
    template_markdown: '仅依据已批准事实生成技术说明，不得补充未知产品事实。',
  });
  const platformType = await command<PlatformType>(page, csrfToken, '/api/v1/platform-types', {
    name: `V2 AI 平台类型 ${suffix}`,
    slug: `v2-ai-${suffix}`,
  });
  const platform = await command<PlatformProfile>(page, csrfToken, '/api/v1/platform-profiles', {
    allowed_domains: [`${suffix}.example.invalid`],
    name: `V2 AI 平台 ${suffix}`,
    platform_prompt_id: platformPrompt.id,
    platform_type_id: platformType.id,
    slug: `v2-ai-platform-${suffix}`,
  });

  const currentHumanization = await page.request.get(
    `${apiBaseUrl}/api/v1/content-humanization-prompt`,
  );
  expect([200, 204]).toContain(currentHumanization.status());
  const expectedRevision = currentHumanization.status() === 200
    ? (await responseBody<{ revision: number }>(currentHumanization)).revision
    : null;
  await command(page, csrfToken, '/api/v1/content-humanization-prompt', {
    expected_revision: expectedRevision,
    template_markdown: '保持原事实不变，降低机械表达并输出同一四字段 Markdown 内容。',
  }, 'PUT');
  return { platform, platformPrompt };
}

async function configureModel(
  page: Page,
  csrfToken: string,
  {
    channelName,
    modelDisplayName,
    modelId,
    timeoutSeconds,
  }: {
    channelName: string;
    modelDisplayName: string;
    modelId: string;
    timeoutSeconds: number;
  },
) {
  const channel = await command<AIChannel>(page, csrfToken, '/api/v1/ai-channels', {
    api_key: modelId.startsWith('e2e-timeout-model-') ? 'e2e-second-key' : 'e2e-only-key',
    base_url: `${fakeAiBaseUrl}/v1`,
    description: 'Frontend V2 AI real-stack 隔离渠道',
    name: channelName,
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'CUSTOM',
    timeout_seconds: timeoutSeconds,
  });
  const withRegion = await command<AIChannel>(
    page,
    csrfToken,
    `/api/v1/ai-channels/${channel.id}/headers`,
    {
      expected_channel_revision: channel.revision,
      is_sensitive: false,
      name: 'X-E2E-Region',
      value: modelId.startsWith('e2e-timeout-model-') ? 'timeout-test' : 'v2-ai-test',
    },
  );
  const withSecret = await command<AIChannel>(
    page,
    csrfToken,
    `/api/v1/ai-channels/${channel.id}/headers`,
    {
      expected_channel_revision: withRegion.revision,
      is_sensitive: true,
      name: 'X-E2E-Secret',
      value: modelId.startsWith('e2e-timeout-model-') ? 'timeout-secret' : 'v2-ai-secret',
    },
  );
  const model = await command<AIModel>(
    page,
    csrfToken,
    `/api/v1/ai-channels/${channel.id}/models`,
    { display_name: modelDisplayName, model_id: modelId, request_parameters: { temperature: 0 } },
  );
  const tested = await command<AIModel>(page, csrfToken, `/api/v1/ai-models/${model.id}/test`);
  await command<AIModel>(
    page,
    csrfToken,
    `/api/v1/ai-models/${model.id}/enable`,
    { expected_revision: tested.revision },
  );
  const enabledChannel = await command<AIChannel>(
    page,
    csrfToken,
    `/api/v1/ai-channels/${channel.id}/enable`,
    { expected_revision: withSecret.revision },
  );
  const sensitiveHeaderId = withSecret.headers.find((header) => header.name === 'X-E2E-Secret')?.id;
  if (!sensitiveHeaderId) throw new Error('真实 E2E 超时渠道缺少敏感 Header');
  return { channel: enabledChannel, model, sensitiveHeaderId };
}

async function createApprovedProduct(page: Page, suffix: string) {
  const partNumber = `AI-V2-${suffix}`;
  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号' }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌' }).fill('PartSignal E2E');
  await page.getByRole('textbox', { name: '类别' }).fill('AI Production 真实闭环');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1);
  if (!productId) throw new Error('创建产品后 URL 缺少 productId');

  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  await page.getByRole('textbox', { name: '事实 Markdown' }).fill(
    `# ${partNumber}\n\n- 工作电压：5 V\n- 数据性质：仅用于本地虚构验收`,
  );
  await page.getByRole('combobox', { name: '数据级别' }).click();
  await page.getByRole('option', { name: '公开' }).click();
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交事实审核' });
  await submit.getByRole('textbox', { name: '变更摘要' }).fill('V2 AI real-stack 虚构事实');
  await submit.getByRole('button', { name: '确认提交审核' }).click();

  await page.goto('/products');
  const search = page.getByRole('searchbox', { name: '搜索产品' });
  await search.fill(partNumber);
  await search.press('Enter');
  const row = page.getByRole('row').filter({
    has: page.getByRole('link', { name: partNumber, exact: true }),
  });
  await row.getByRole('link', { name: '审核', exact: true }).click();
  await page.getByRole('button', { name: '批准事实' }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();
  return { partNumber, productId };
}

async function createContentTask(
  page: Page,
  productId: string,
  platformName: string,
): Promise<string> {
  await page.goto(`/products/${productId}`);
  await page.getByRole('link', { name: '创建内容', exact: true }).click();
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await page.getByRole('option', { name: /v\d+ · 公开/ }).click();
  await page.getByRole('combobox', { name: '目标平台' }).click();
  await page.getByRole('option', { name: platformName, exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+$/i);
  const taskId = new URL(page.url()).pathname.split('/').at(-1);
  if (!taskId) throw new Error('创建内容任务后 URL 缺少 taskId');
  await page.getByRole('link', { name: '创建初稿' }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}/editor`);
  return taskId;
}

async function selectModelAndSubmit(page: Page, dialogName: string, modelName: string, submitName: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.getByRole('combobox', { name: '模型' }).click();
  await page.getByRole('option', { name: new RegExp(modelName) }).click();
  await dialog.getByRole('button', { name: submitName }).click();
}

function immutableContentFields(content: ContentVersion) {
  return {
    based_on_id: content.based_on_id,
    body_markdown: content.body_markdown,
    content_hash: content.content_hash,
    id: content.id,
    revision: content.revision,
    source_job_id: content.source_job_id,
    source_type: content.source_type,
    status: content.status,
    summary: content.summary,
    tags: content.tags,
    title: content.title,
  };
}

test('AI Production：成功、自然化、失败详情与 exact snapshot retry', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const { platform, platformPrompt } = await configurePlatform(page, session.csrf_token, suffix);
  const successModel = await configureModel(page, session.csrf_token, {
    channelName: `V2 AI 成功渠道 ${suffix}`,
    modelDisplayName: `V2 AI 成功模型 ${suffix}`,
    modelId: `e2e-v2-model-${suffix}`,
    timeoutSeconds: 30,
  });
  const timeoutModelId = `e2e-timeout-model-${suffix}`;
  const timeoutModel = await configureModel(page, session.csrf_token, {
    channelName: `V2 AI 超时渠道 ${suffix}`,
    modelDisplayName: `V2 AI 超时模型 ${suffix}`,
    modelId: timeoutModelId,
    timeoutSeconds: 10,
  });
  const product = await createApprovedProduct(page, suffix);

  const successTaskId = await createContentTask(page, product.productId, platform.name);
  await page.getByRole('button', { name: 'AI 生成首稿' }).click();
  const generationDialog = page.getByRole('dialog', { name: '确认 Prompt 与模型' });
  await expect(generationDialog).toContainText(platformPrompt.name);
  await expect(generationDialog).toContainText(`Revision ${platformPrompt.revision}`);
  await expect(generationDialog).toContainText(platformPrompt.template_markdown);
  await selectModelAndSubmit(
    page,
    '确认 Prompt 与模型',
    successModel.model.display_name,
    '确认 Prompt 与模型并开始生成',
  );
  await expect(page.getByRole('textbox', { name: '标题' })).toHaveValue('连接测试', {
    timeout: 30_000,
  });
  await expect(page.getByText('只读').first()).toBeVisible();

  const generatedContext = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${successTaskId}/editor-context`,
  );
  expect(generatedContext.current_content?.source_type).toBe('AI');
  expect(generatedContext.current_content?.source_job_id).toBe(generatedContext.latest_generation?.id);
  const sourceId = generatedContext.current_content!.id;
  const sourceBeforeHumanization = await apiGet<ContentVersion>(
    page,
    `/api/v1/content-versions/${sourceId}`,
  );

  await page.getByRole('button', { name: '创建自然化版本' }).click();
  const humanizationResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/v1/content-versions/${sourceId}/humanization-jobs`)
  ));
  await selectModelAndSubmit(
    page,
    '创建自然化作业',
    successModel.model.display_name,
    '确认创建自然化版本',
  );
  const humanizationResponse = await humanizationResponsePromise;
  expect(humanizationResponse.status()).toBe(202);
  const humanizationRequestId = await humanizationResponse.headerValue('x-request-id');
  expect(humanizationRequestId).toBeTruthy();
  const humanizationJob = await humanizationResponse.json() as GenerationJob;
  expect(humanizationJob).toMatchObject({
    job_type: 'HUMANIZE',
    source_content_version_id: sourceId,
  });
  expect(['PENDING', 'RUNNING', 'SUCCEEDED']).toContain(humanizationJob.status);
  console.info(JSON.stringify({
    event: 'E2E_HUMANIZATION_RESPONSE',
    job_id: humanizationJob.id,
    request_id: humanizationRequestId,
    status: humanizationJob.status,
  }));
  await expect(page.getByText(`Job ${humanizationJob.id}`)).toBeVisible();
  await expect(page.getByText('自然化次数：1')).toBeVisible({ timeout: 30_000 });
  const humanizedContext = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${successTaskId}/editor-context`,
  );
  const humanized = humanizedContext.current_content!;
  const humanizationDetail = await apiGet<GenerationJobDetail>(
    page,
    `/api/v1/generation-jobs/${humanizationJob.id}`,
  );
  const sourceAfterHumanization = await apiGet<ContentVersion>(
    page,
    `/api/v1/content-versions/${sourceId}`,
  );
  expect(immutableContentFields(sourceAfterHumanization))
    .toEqual(immutableContentFields(sourceBeforeHumanization));
  expect(humanized).toMatchObject({
    based_on_id: sourceId,
    source_job_id: humanizationJob.id,
    source_type: 'AI',
    status: 'DRAFT',
  });
  expect(humanizedContext.latest_generation?.id).toBe(humanizationJob.id);
  expect(humanizationDetail).toMatchObject({
    attempt_count: 1,
    content_version_id: humanized.id,
    id: humanizationJob.id,
    job_type: 'HUMANIZE',
    provider_request_id: 'e2e-provider-request',
    source_content_version_id: sourceId,
    status: 'SUCCEEDED',
  });
  expect(humanizationDetail.response_duration_ms).not.toBeNull();
  console.info(JSON.stringify({
    attempt_count: humanizationDetail.attempt_count,
    content_version_id: humanizationDetail.content_version_id,
    event: 'E2E_HUMANIZATION_TERMINAL',
    finished_at: humanizationDetail.finished_at,
    job_id: humanizationDetail.id,
    provider_request_id: humanizationDetail.provider_request_id,
    started_at: humanizationDetail.started_at,
    status: humanizationDetail.status,
  }));

  const failedTaskId = await createContentTask(page, product.productId, platform.name);
  await page.getByRole('button', { name: 'AI 生成首稿' }).click();
  await selectModelAndSubmit(
    page,
    '确认 Prompt 与模型',
    timeoutModel.model.display_name,
    '确认 Prompt 与模型并开始生成',
  );
  await expect(page.getByRole('alert').filter({ hasText: 'AI_PROVIDER_TIMEOUT' }))
    .toBeVisible({ timeout: 30_000 });
  const failedContext = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${failedTaskId}/editor-context`,
  );
  const failedJobId = failedContext.latest_generation!.id;
  const failedDetail = await apiGet<GenerationJobDetail>(
    page,
    `/api/v1/generation-jobs/${failedJobId}`,
  );
  expect(failedDetail).toMatchObject({ attempt_count: 1, error_code: 'AI_PROVIDER_TIMEOUT' });

  await page.getByRole('button', { name: '查看完整作业快照' }).click();
  const detailDialog = page.getByRole('dialog', { name: '完整生成作业快照' });
  await expect(detailDialog).toContainText('content-markdown-v3');
  await detailDialog.getByRole('button', { name: '关闭' }).first().click();

  const replacedKey = await command<AIChannel>(
    page,
    session.csrf_token,
    `/api/v1/ai-channels/${timeoutModel.channel.id}/api-key`,
    { api_key: 'e2e-second-key-updated', expected_revision: timeoutModel.channel.revision },
    'PUT',
  );
  const updatedHeader = await command<AIChannel>(
    page,
    session.csrf_token,
    `/api/v1/ai-channel-headers/${timeoutModel.sensitiveHeaderId}`,
    {
      expected_channel_revision: replacedKey.revision,
      is_sensitive: true,
      name: 'X-E2E-Secret',
      value: 'timeout-secret-updated',
    },
    'PATCH',
  );
  const retested = await command<AIModel>(
    page,
    session.csrf_token,
    `/api/v1/ai-models/${timeoutModel.model.id}/test`,
  );
  await command<AIModel>(
    page,
    session.csrf_token,
    `/api/v1/ai-models/${timeoutModel.model.id}/enable`,
    { expected_revision: retested.revision },
  );
  await command<AIChannel>(
    page,
    session.csrf_token,
    `/api/v1/ai-channels/${timeoutModel.channel.id}/enable`,
    { expected_revision: updatedHeader.revision },
  );

  await page.getByRole('button', { name: '按原快照重试' }).click();
  await page.getByRole('dialog', { name: '按原快照重试？' })
    .getByRole('button', { name: '确认按原快照重试' })
    .click();
  await expect(page.getByRole('textbox', { name: '标题' })).toHaveValue('连接测试', {
    timeout: 30_000,
  });
  const retriedContext = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${failedTaskId}/editor-context`,
  );
  const retriedDetail = await apiGet<GenerationJobDetail>(
    page,
    `/api/v1/generation-jobs/${retriedContext.latest_generation!.id}`,
  );
  expect(retriedDetail.retry_of_id).toBe(failedJobId);
  expect(retriedDetail.input_snapshot).toEqual(failedDetail.input_snapshot);
  expect(await responseBody<{ count: number }>(
    await page.request.get(`${fakeAiBaseUrl}/e2e/calls/${timeoutModelId}`),
  )).toEqual({ count: 4 });

});
