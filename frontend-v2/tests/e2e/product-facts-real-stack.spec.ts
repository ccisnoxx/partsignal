/** 通过 V2 页面验证真实 PostgreSQL/FastAPI Product Facts 业务闭环。 */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type Page,
} from '@playwright/test';

import type { components } from '../../src/shared/api/generated/schema';

type AuthSession = components['schemas']['AuthSession'];
type ProductDetail = components['schemas']['ProductDetail'];
type ProductFactReviewWorkspace = components['schemas']['ProductFactReviewWorkspace'];
type ProductFactReviewTarget = components['schemas']['ProductFactReviewTarget'];

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

async function login(page: Page): Promise<void> {
  await responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return responseBody<T>(await page.request.get(`${apiBaseUrl}${path}`));
}

async function createProduct(page: Page, prefix: string) {
  const suffix = randomUUID().slice(0, 8);
  const partNumber = `${prefix}-${suffix}`;
  await page.goto('/products/new');
  await expect(page.getByRole('heading', { level: 1, name: '新建产品' })).toBeVisible();
  await page.getByRole('textbox', { name: '产品型号' }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌' }).fill('PartSignal E2E');
  await page.getByRole('textbox', { name: '类别' }).fill('真实闭环测试');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/i);
  const productId = new URL(page.url()).pathname.split('/').at(-1);
  if (!productId) throw new Error('创建产品后 URL 缺少 productId');
  await expect(page.getByRole('heading', { level: 1, name: partNumber })).toBeVisible();
  return { partNumber, productId, suffix };
}

async function enterFactsAndSubmit(
  page: Page,
  markdown: string,
  changeSummary: string,
): Promise<void> {
  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  await editor.fill(markdown);
  await page.getByRole('combobox', { name: '数据级别' }).click();
  await page.getByRole('option', { name: '公开' }).click();
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const dialog = page.getByRole('dialog', { name: '提交事实审核' });
  await dialog.getByRole('textbox', { name: '变更摘要' }).fill(changeSummary);
  await dialog.getByRole('button', { name: '确认提交审核' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/事实版本 v\d+ 已提交审核/).first()).toBeVisible();
}

async function openProductsList(page: Page): Promise<void> {
  await page.locator('aside a[href="/products"]').click();
  await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
}

async function productRow(page: Page, partNumber: string) {
  const search = page.getByRole('searchbox', { name: '搜索产品' });
  await search.fill(partNumber);
  await search.press('Enter');
  const productLink = page.getByRole('link', { name: partNumber, exact: true });
  await expect(productLink).toBeVisible();
  return page.getByRole('row').filter({ has: productLink });
}

async function reviewContext(page: Page, productId: string): Promise<ProductFactReviewTarget> {
  const workspace = await apiGet<ProductFactReviewWorkspace>(
    page,
    `/api/v1/products/${productId}/fact-review-context`,
  );
  if (!workspace.review) throw new Error('真实审核上下文缺少目标 FactVersion');
  return workspace.review;
}

test('Flow A：批准事实后展示不可变版本并交接 CREATE_CONTENT_TASK', async ({ page }) => {
  await login(page);
  const product = await createProduct(page, 'PF-A');
  const marker = `flow-a-${product.suffix}`;
  const markdown = `# Product Facts ${marker}\n\n- 数据来源：真实 V2 页面\n- 可见级别：PUBLIC`;
  const summary = `提交 ${marker} 审核`;

  await enterFactsAndSubmit(page, markdown, summary);
  await openProductsList(page);
  const reviewRow = await productRow(page, product.partNumber);
  await reviewRow.getByRole('link', { name: '审核', exact: true }).click();
  await expect(page.getByLabel(/事实版本 v\d+ Markdown 快照/)).toContainText(marker);
  await expect(page.getByRole('heading', { name: '审核历史' }).locator('xpath=ancestor::section[1]'))
    .toContainText(summary);
  await page.getByRole('button', { name: '批准事实' }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();

  await openProductsList(page);
  const approvedRow = await productRow(page, product.partNumber);
  await approvedRow.getByRole('link', { name: product.partNumber, exact: true }).click();
  const createContentLink = page.getByRole('link', { name: '创建内容', exact: true });
  await expect(createContentLink).toHaveAttribute(
    'href',
    `/content/tasks/new?productId=${encodeURIComponent(product.productId)}`,
  );

  const detail = await apiGet<ProductDetail>(page, `/api/v1/products/${product.productId}/detail`);
  expect(detail.product.primary_task).toBe('CREATE_CONTENT_TASK');
  expect(detail.approved_fact).not.toBeNull();
  const approvedFact = page.getByRole('region', { name: '当前批准事实' });
  const versionLink = approvedFact.getByRole('link', { name: /^v\d+$/ });
  await expect(versionLink).toHaveAttribute(
    'href',
    `/products/${encodeURIComponent(product.productId)}/facts/versions/${detail.approved_fact!.id}`,
  );
  await versionLink.click();

  await expect(page.getByRole('heading', { level: 1, name: `FactVersion v${detail.approved_fact!.version}` }))
    .toBeVisible();
  await expect(page.getByLabel(`事实版本 v${detail.approved_fact!.version} Markdown 快照`))
    .toContainText(marker);
  await expect(page.getByText('已批准', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /保存|提交|批准|退回/ })).toHaveCount(0);
});

test('Flow B：退回后修订产生新版本，审核历史严格归属当前 FactVersion', async ({ page }) => {
  await login(page);
  const product = await createProduct(page, 'PF-B');
  const firstSummary = `flow-b-v1-${product.suffix}`;
  const returnComment = `flow-b-return-v1-${product.suffix}`;
  const secondSummary = `flow-b-v2-${product.suffix}`;
  const firstMarkdown = `# Flow B ${product.suffix}\n\n- 参数：初稿`;
  const secondMarkdown = `# Flow B ${product.suffix}\n\n- 参数：修订稿\n- 条件：已补充`;

  await enterFactsAndSubmit(page, firstMarkdown, firstSummary);
  await openProductsList(page);
  const firstReviewRow = await productRow(page, product.partNumber);
  await firstReviewRow.getByRole('link', { name: '审核', exact: true }).click();
  await expect(page.getByText('FactVersion v1', { exact: false }).first()).toBeVisible();
  let history = page.getByRole('heading', { name: '审核历史' }).locator('xpath=ancestor::section[1]');
  await expect(history).toContainText(firstSummary);

  await page.getByRole('button', { name: '退回修改' }).click();
  const requestDialog = page.getByRole('dialog', { name: /退回事实版本 v\d+/ });
  await requestDialog.getByRole('textbox', { name: '退回意见' }).fill(returnComment);
  await requestDialog.getByRole('button', { name: '确认退回' }).click();
  await expect(requestDialog).toBeHidden();
  await expect(page.getByText(/事实版本 v\d+ 已退回修改/).first()).toBeVisible();
  await expect(page.getByText('待修订', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /批准事实|退回修改/ })).toHaveCount(0);

  await openProductsList(page);
  const reviseRow = await productRow(page, product.partNumber);
  await reviseRow.getByRole('link', { name: '修订', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '事实 Markdown' });
  await editor.fill(secondMarkdown);
  await page.getByRole('button', { name: '保存事实' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交事实审核' }).click();
  const submitDialog = page.getByRole('dialog', { name: '提交事实审核' });
  await submitDialog.getByRole('textbox', { name: '变更摘要' }).fill(secondSummary);
  await submitDialog.getByRole('button', { name: '确认提交审核' }).click();
  await expect(submitDialog).toBeHidden();

  await openProductsList(page);
  const secondReviewRow = await productRow(page, product.partNumber);
  await secondReviewRow.getByRole('link', { name: '审核', exact: true }).click();
  await expect(page.getByText('FactVersion v2', { exact: false }).first()).toBeVisible();

  history = page.getByRole('heading', { name: '审核历史' }).locator('xpath=ancestor::section[1]');
  await expect(history).toContainText(secondSummary);
  await expect(history).not.toContainText(firstSummary);
  await expect(history).not.toContainText(returnComment);
  await page.getByRole('button', { name: '批准事实' }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();

  const finalTarget = await reviewContext(page, product.productId);
  const secondVersionId = finalTarget.fact_version.id;
  expect(finalTarget.fact_version.version).toBe(2);
  expect(finalTarget.fact_version.status).toBe('APPROVED');
  expect(finalTarget.available_actions).toEqual([]);
  expect(finalTarget.review_history.map((record) => record.action)).toEqual([
    'submit-review',
    'approve',
  ]);
  expect(finalTarget.review_history.every((record) => record.target_id === secondVersionId)).toBe(true);
  expect(finalTarget.review_history.map((record) => record.comment)).not.toContain(firstSummary);
  expect(finalTarget.review_history.map((record) => record.comment)).not.toContain(returnComment);
});
