/** 真实 PostgreSQL 与对象存储下验证 Publication Workspace Core Flow A。 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type Product = components['schemas']['Product'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];
type FactVersion = components['schemas']['FactVersion'];
type PlatformType = components['schemas']['PlatformType'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformAccount = components['schemas']['PlatformAccount'];
type ContentTask = components['schemas']['ContentTask'];
type ContentVersion = components['schemas']['ContentVersion'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];

const realStackEnabled = process.env.PARTSIGNAL_E2E_REAL_STACK === '1';
const apiBaseUrl = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';

test.skip(!realStackEnabled, '只由隔离真实栈入口运行');
test.setTimeout(90_000);

async function responseBody<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`真实 E2E API 请求失败：${response.status()} ${response.url()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function login(page: Page) {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function createPrerequisites(page: Page, csrfToken: string, suffix: string) {
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    { data: { name: `Publication Core-${suffix}`, slug: `publication-core-${suffix}` }, headers },
  ));
  const domain = `${suffix}.example.invalid`;
  const platform = await responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name: `Publication Core-${suffix}`,
        slug: `publication-core-${suffix}`,
        allowed_domains: [domain],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
        website_url: `https://${domain}`,
      },
      headers,
    },
  ));
  const firstAccount = await responseBody<PlatformAccount>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-accounts`,
    { data: { platform_profile_id: platform.id, label: '首发账号', account_identifier: `first-${suffix}` }, headers },
  ));
  const secondAccount = await responseBody<PlatformAccount>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-accounts`,
    { data: { platform_profile_id: platform.id, label: '复核账号', account_identifier: `second-${suffix}` }, headers },
  ));
  const product = await responseBody<Product>(await page.request.post(`${apiBaseUrl}/api/v1/products`, {
    data: { part_number: `PUB-${suffix}`, brand: 'PartSignal E2E', category: 'Publication Core' },
    headers,
  }));
  const draft = await responseBody<ProductFactsDraft>(await page.request.get(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
  ));
  const savedDraft = await responseBody<ProductFactsDraft>(await page.request.put(
    `${apiBaseUrl}/api/v1/products/${product.id}/facts`,
    {
      data: {
        expected_revision: draft.revision,
        body_markdown: `# ${product.part_number}\n\n- 工作电压：3.3 V\n- 数据性质：本地虚构验收`,
        classification: 'PUBLIC',
      },
      headers,
    },
  ));
  const pendingFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/products/${product.id}/fact-review-submissions`,
    { data: { expected_revision: savedDraft.revision, change_summary: `批准事实 ${suffix}` }, headers },
  ));
  const approvedFact = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/fact-versions/${pendingFact.id}/approve`,
    { data: { expected_revision: pendingFact.revision, comment: `真实栈批准 ${suffix}` }, headers },
  ));
  const task = await responseBody<ContentTask>(await page.request.post(`${apiBaseUrl}/api/v1/content-tasks`, {
    data: { product_id: product.id, fact_version_id: approvedFact.id, platform_profile_id: platform.id },
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
  }));
  const draftContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-tasks/${task.id}/manual-versions`,
    {
      data: {
        title: `${product.part_number} 发布内容`,
        summary: 'Publication Workspace Core 真实栈摘要',
        body_markdown: `# ${product.part_number} 发布内容\n\n工作电压为 3.3 V。`,
        tags: ['真实栈', 'Publication Core'],
        change_summary: `创建发布稿 ${suffix}`,
      },
      headers,
    },
  ));
  const pendingContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${draftContent.id}/submit-review`,
    { data: { expected_revision: draftContent.revision, comment: `提交发布稿 ${suffix}` }, headers },
  ));
  const approvedContent = await responseBody<ContentVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/content-versions/${pendingContent.id}/approve`,
    { data: { expected_revision: pendingContent.revision, comment: `批准发布稿 ${suffix}` }, headers },
  ));
  const work = await responseBody<PublicationWork>(await page.request.post(
    `${apiBaseUrl}/api/v1/publication-works`,
    {
      data: { content_version_id: approvedContent.id, platform_account_id: firstAccount.id },
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    },
  ));
  return { approvedContent, domain, secondAccount, work };
}

test('Flow A：V2 UI 完成准备、平台审核、截图上传与结果登记', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const setup = await createPrerequisites(page, session.csrf_token, suffix);

  await page.goto(`/publishing/work/${setup.work.id}#preparation`);
  await expect(page.locator('#publication-workspace-title')).toHaveText(setup.approvedContent.title);

  await page.getByRole('button', { name: '更新准备信息' }).click();
  let dialog = page.getByRole('dialog', { name: '更新准备信息' });
  await dialog.getByRole('combobox', { name: '发布账号' }).click();
  await page.getByRole('option', { name: new RegExp(setup.secondAccount.label) }).click();
  await dialog.getByRole('textbox', { name: '备注' }).fill(`切换到复核账号 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '标记平台处理中' }).click();
  dialog = page.getByRole('dialog', { name: '标记平台处理中' });
  await dialog.getByRole('textbox', { name: '备注' }).fill(`平台审核 ${suffix}`);
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '登记发布结果' }).click();
  dialog = page.getByRole('dialog', { name: '登记发布结果' });
  const actualTitle = `${setup.approvedContent.title} · 已发布`;
  const finalUrl = `https://${setup.domain}/articles/${suffix}`;
  await dialog.getByRole('textbox', { name: '实际发布标题' }).fill(actualTitle);
  await dialog.getByRole('textbox', { name: '最终 URL' }).fill(finalUrl);
  await dialog.getByLabel('发布时间').fill('2026-08-11T12:00');
  await dialog.getByRole('textbox', { name: '备注' }).fill(`结果登记 ${suffix}`);
  await dialog.getByLabel('上传发布证据截图').setInputFiles({
    name: `publication-${suffix}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(dialog.getByText(new RegExp(`已校验：publication-${suffix}\\.png`))).toBeVisible();
  await dialog.getByRole('button', { name: '确认提交' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('当前工作已等待核验；核验能力由下一子任务交付。')).toBeVisible();

  const context = await responseBody<PublicationWorkspaceContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/publication-works/${setup.work.id}/workspace-context`,
  ));
  expect(context.work.status).toBe('AWAITING_VERIFICATION');
  expect(context.work.actual_title).toBe(actualTitle);
  expect(context.work.final_url).toBe(finalUrl);
  expect(context.work.content_hash).toBe(setup.approvedContent.content_hash);
  expect(context.work.attachments).toHaveLength(1);
  expect(context.work.attachments[0]?.status).toBe('VERIFIED');
  expect(context.work.events.map((event) => event.action)).toEqual([
    'CREATED', 'PREPARATION_UPDATED', 'PLATFORM_REVIEW_MARKED', 'RESULT_REGISTERED',
  ]);
});
