/** 通过 V2 页面验证真实 PostgreSQL/FastAPI Content Review 批准与退回闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type ContentReviewContext = components['schemas']['ContentReviewContext'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformType = components['schemas']['PlatformType'];

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

async function login(page: Page): Promise<AuthSession> {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function createActivePlatform(page: Page, csrfToken: string, suffix: string) {
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    { data: { name: `Content Review 平台-${suffix}`, slug: `content-review-${suffix}` }, headers },
  ));
  return responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name: `Content Review 平台-${suffix}`,
        slug: `content-review-${suffix}`,
        allowed_domains: [`${suffix}.example.invalid`],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
      },
      headers,
    },
  ));
}

async function createApprovedProduct(page: Page, suffix: string) {
  const partNumber = `CR-${suffix}`;
  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号' }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌' }).fill('PartSignal E2E');
  await page.getByRole('textbox', { name: '类别' }).fill('Content Review 真实闭环');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1);
  if (!productId) throw new Error('创建产品后 URL 缺少 productId');

  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  await page.getByRole('textbox', { name: '事实 Markdown' }).fill(
    `# ${partNumber}\n\n- 工作电压：3.3 V\n- 数据性质：本地虚构验收`,
  );
  await page.getByRole('combobox', { name: '数据级别' }).click();
  await page.getByRole('option', { name: '公开' }).click();
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交事实审核' });
  await submit.getByRole('textbox', { name: '变更摘要' }).fill(`批准事实 ${suffix}`);
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

async function createReviewReadyTask(
  page: Page,
  product: { partNumber: string; productId: string },
  platformName: string,
  suffix: string,
) {
  await page.goto(`/products/${product.productId}`);
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
  await page.getByRole('textbox', { name: '标题' }).fill(`${product.partNumber} 审核内容`);
  await page.getByRole('textbox', { name: '摘要' }).fill('Content Review 真实栈摘要');
  await page.getByRole('textbox', { name: '标签' }).fill('真实栈\n审核');
  await page.getByRole('textbox', { name: '变更说明' }).fill(`创建审核稿 ${suffix}`);
  await page.getByRole('textbox', { name: '内容 Markdown' }).fill(
    `# ${product.partNumber} 审核内容\n\n工作电压为 3.3 V。`,
  );
  await page.getByRole('button', { name: '创建人工首稿' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交内容审核' });
  await submit.getByRole('textbox', { name: '备注（可选）' }).fill(`真实栈提交 ${suffix}`);
  await submit.getByRole('button', { name: '确认提交审核' }).click();
  await expect(submit).toBeHidden();

  await page.goto(`/content/tasks/${taskId}`);
  await page.getByRole('link', { name: '审核内容' }).click();
  await expect(page).toHaveURL(`/content/tasks/${taskId}/review`);
  await expect(page.locator('#content-review-title')).toHaveText(`${product.partNumber} 审核内容`);
  return taskId;
}

async function reviewContext(page: Page, taskId: string) {
  return responseBody<ContentReviewContext>(await page.request.get(
    `${apiBaseUrl}/api/v1/content-tasks/${taskId}/review-context`,
  ));
}

function immutableContent(content: ContentReviewContext['content']) {
  return {
    body_markdown: content.body_markdown,
    content_hash: content.content_hash,
    id: content.id,
    source_job_id: content.source_job_id,
    summary: content.summary,
    tags: content.tags,
    title: content.title,
  };
}

test('独立真实栈 APPROVE：页面提交后 canonical context 只读且历史 append-only', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const platform = await createActivePlatform(page, session.csrf_token, suffix);
  const product = await createApprovedProduct(page, suffix);
  const taskId = await createReviewReadyTask(page, product, platform.name, suffix);
  const before = await reviewContext(page, taskId);

  await page.getByRole('button', { name: '批准内容' }).click();
  await page.getByRole('dialog', { name: /批准内容版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/内容版本 v\d+ 已批准/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准内容|退回修改/ })).toHaveCount(0);

  const after = await reviewContext(page, taskId);
  expect(after.content.status).toBe('APPROVED');
  expect(after.available_actions).toEqual([]);
  expect(immutableContent(after.content)).toEqual(immutableContent(before.content));
  expect(after.review_history.map((record) => record.action)).toEqual([
    ...before.review_history.map((record) => record.action),
    'approve',
  ]);
});

test('独立真实栈 REQUEST_CHANGES：意见持久化且 canonical context 只读', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const session = await login(page);
  const platform = await createActivePlatform(page, session.csrf_token, suffix);
  const product = await createApprovedProduct(page, suffix);
  const taskId = await createReviewReadyTask(page, product, platform.name, suffix);
  const before = await reviewContext(page, taskId);
  const comment = `请补充平台约束 ${suffix}`;

  await page.getByRole('button', { name: '退回修改' }).click();
  const dialog = page.getByRole('dialog', { name: /退回内容版本 v\d+/ });
  await dialog.getByRole('textbox', { name: '审核意见' }).fill(comment);
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(page.getByText(/内容版本 v\d+ 已退回修改/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准内容|退回修改/ })).toHaveCount(0);

  const after = await reviewContext(page, taskId);
  expect(after.content.status).toBe('CHANGES_REQUESTED');
  expect(after.available_actions).toEqual([]);
  expect(immutableContent(after.content)).toEqual(immutableContent(before.content));
  expect(after.review_history.at(-1)).toMatchObject({ action: 'request-changes', comment });
});
