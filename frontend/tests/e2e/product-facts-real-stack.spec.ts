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
type CommandRequest = components['schemas']['CommandRequest'];
type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type FactVersion = components['schemas']['FactVersion'];
type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformType = components['schemas']['PlatformType'];
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

async function login(page: Page): Promise<AuthSession> {
  return responseBody<AuthSession>(await page.request.post(`${apiBaseUrl}/api/v1/auth/login`, {
    data: { username: 'admin', password },
  }));
}

async function createActivePlatform(page: Page, csrfToken: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const name = `真实闭环平台-${suffix}`;
  const headers = { 'X-CSRF-Token': csrfToken };
  const platformType = await responseBody<PlatformType>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-types`,
    { data: { name: `真实闭环平台-${suffix}`, slug: `real-stack-${suffix}` }, headers },
  ));
  await responseBody<PlatformProfile>(await page.request.post(
    `${apiBaseUrl}/api/v1/platform-profiles`,
    {
      data: {
        name,
        slug: `real-stack-${suffix}`,
        allowed_domains: [`${suffix}.example.invalid`],
        platform_type_id: platformType.id,
        platform_prompt_id: null,
      },
      headers,
    },
  ));
  return name;
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
  const session = await login(page);
  const platformName = await createActivePlatform(page, session.csrf_token);
  const product = await createProduct(page, 'PF-A');
  const marker = `flow-a-${product.suffix}`;
  const markdown = `# Product Facts ${marker}\n\n- 数据来源：真实 V2 页面\n- 可见级别：PUBLIC`;
  const summary = `提交 ${marker} 审核`;

  await enterFactsAndSubmit(page, markdown, summary);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  const factReviewCard = page.locator('[data-workbench-count="fact_reviews"]');
  await expect(factReviewCard.locator('p').nth(1)).toHaveText(/^[1-9]\d*$/);
  await expect(factReviewCard.getByRole('link', { name: '查看事实审核' })).toHaveAttribute(
    'href',
    '/products?page=1&factStatus=PENDING_REVIEW&workflowStage=FACT_REVIEW_PENDING',
  );
  const factAttention = page.locator('.workbench-attention-link').filter({
    hasText: `PartSignal E2E ${product.partNumber}`,
  });
  await expect(factAttention).toHaveCount(1);
  await expect(factAttention).toHaveAttribute(
    'href',
    `/products/${product.productId}/facts/review`,
  );
  await factAttention.click();
  await expect(page).toHaveURL(`/products/${product.productId}/facts/review`);
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

  await createContentLink.click();
  await expect(page).toHaveURL(
    `/content/tasks/new?productId=${encodeURIComponent(product.productId)}`,
  );
  await expect(page.getByRole('combobox', { name: '产品' })).toContainText(product.partNumber);
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await page.getByRole('option', {
    name: `v${detail.approved_fact!.version} · 公开`,
  }).click();
  await page.getByRole('combobox', { name: '目标平台' }).click();
  await page.getByRole('option', { name: platformName }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+$/i);
  await expect(page.getByRole('heading', { name: /^CT-/ })).toBeVisible();
  await expect(page.getByRole('link', { name: `PartSignal E2E · ${product.partNumber}` }))
    .toHaveAttribute('href', `/products/${product.productId}`);
  await expect(page.getByRole('link', { name: `v${detail.approved_fact!.version} · 已批准` }))
    .toHaveAttribute(
      'href',
      `/products/${product.productId}/facts/versions/${detail.approved_fact!.id}`,
    );
  await expect(page.getByText(platformName, { exact: true })).toBeVisible();
  await expect(page.getByText('CREATE_FIRST_DRAFT', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '创建初稿' }))
    .toHaveAttribute('href', /\/content\/tasks\/[0-9a-f-]+\/editor$/);
  await expect(page).not.toHaveURL(/\/editor$/);

  await openProductsList(page);
  const createdProductRow = await productRow(page, product.partNumber);
  await createdProductRow.getByRole('link', { name: product.partNumber, exact: true }).click();
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

  await openProductsList(page);
  const approvedRow = await productRow(page, product.partNumber);
  await approvedRow.getByRole('link', { name: product.partNumber, exact: true }).click();
  await page.getByRole('link', { name: '查看完整事实版本历史' }).click();
  await expect(page).toHaveURL(
    `/products/${product.productId}/facts/versions?page=1&pageSize=20`,
  );
  const versionLinks = page.getByRole('region', { name: '事实版本历史列表' }).getByRole('link');
  await expect(versionLinks).toHaveCount(2);
  await expect(versionLinks.nth(0)).toHaveText('v2');
  await expect(versionLinks.nth(1)).toHaveText('v1');
  await versionLinks.nth(0).click();
  await expect(page).toHaveURL(
    `/products/${product.productId}/facts/versions/${secondVersionId}`,
  );
  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();
  await expect(page.getByLabel('事实版本 v2 Markdown 快照')).toContainText('修订稿');
  await expect(page.getByRole('textbox')).toHaveCount(0);

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

test('Flow D：过期 revision 真实返回 409，不重放并保留服务端最新状态', async ({ page }) => {
  const session = await login(page);
  const product = await createProduct(page, 'PF-D');
  const marker = `flow-d-${product.suffix}`;
  const markdown = `# Flow D ${marker}\n\n- 参数：冲突前快照`;
  const concurrentComment = `并发退回-${marker}`;

  await enterFactsAndSubmit(page, markdown, `提交 ${marker} 审核`);
  await openProductsList(page);
  const reviewRow = await productRow(page, product.partNumber);
  await reviewRow.getByRole('link', { name: '审核', exact: true }).click();
  await expect(page.getByLabel(/事实版本 v\d+ Markdown 快照/)).toContainText(marker);

  const initialTarget = await reviewContext(page, product.productId);
  expect(initialTarget.fact_version).toMatchObject({
    status: 'PENDING_REVIEW',
    revision: 0,
    body_markdown: markdown,
  });
  const approvePath = `/api/v1/fact-versions/${initialTarget.fact_version.id}/approve`;
  const approveRequests: Array<{ body: CommandRequest; csrfPresent: boolean }> = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== approvePath) return;
    approveRequests.push({
      body: request.postDataJSON() as CommandRequest,
      csrfPresent: Boolean(request.headers()['x-csrf-token']),
    });
  });

  const concurrentVersion = await responseBody<FactVersion>(await page.request.post(
    `${apiBaseUrl}/api/v1/fact-versions/${initialTarget.fact_version.id}/request-changes`,
    {
      data: { expected_revision: 0, comment: concurrentComment },
      headers: { 'X-CSRF-Token': session.csrf_token },
    },
  ));
  expect(concurrentVersion).toMatchObject({
    id: initialTarget.fact_version.id,
    status: 'CHANGES_REQUESTED',
    revision: 1,
    body_markdown: markdown,
  });

  await page.getByRole('button', { name: '批准事实' }).click();
  const dialog = page.getByRole('dialog', { name: /批准事实版本 v\d+？/ });
  const conflictResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === approvePath
  ));
  await dialog.getByRole('button', { name: '确认批准' }).click();
  const conflictResponse = await conflictResponsePromise;
  expect(conflictResponse.status()).toBe(409);
  const conflict = await conflictResponse.json() as ErrorEnvelope;
  expect(conflict.error.code).toBe('REVISION_CONFLICT');
  expect(conflict.error.request_id).toBeTruthy();
  await expect(page.getByText(`请求 ID：${conflict.error.request_id}`)).toBeVisible();
  expect(approveRequests).toEqual([{
    body: { expected_revision: 0, comment: '' },
    csrfPresent: true,
  }]);

  await expect(page.getByText('待修订', { exact: true }).first()).toBeVisible();
  const context = page.getByRole('region', { name: '审核上下文' });
  await expect(context.getByText('Revision', { exact: true }).locator('xpath=following-sibling::dd'))
    .toHaveText('1');
  await expect(page.getByRole('button', { name: /批准事实|退回修改/ })).toHaveCount(0);

  const finalTarget = await reviewContext(page, product.productId);
  expect(finalTarget.fact_version).toMatchObject({
    id: initialTarget.fact_version.id,
    status: 'CHANGES_REQUESTED',
    revision: 1,
    body_markdown: markdown,
  });
  expect(finalTarget.review_history.at(-1)).toMatchObject({
    action: 'request-changes',
    comment: concurrentComment,
  });
  expect(finalTarget.review_history.some((record) => record.action === 'approve')).toBe(false);
});

test('Flow C：独立 ContentTask 经人工首稿、保存后提交审核', async ({ page }) => {
  const session = await login(page);
  const platformName = await createActivePlatform(page, session.csrf_token);
  const product = await createProduct(page, 'CE-C');
  const factMarker = `content-editor-fact-${product.suffix}`;
  await enterFactsAndSubmit(
    page,
    `# Content Editor Fact ${factMarker}\n\n- 工作电压：3.3 V`,
    `批准 ${factMarker}`,
  );

  await openProductsList(page);
  const reviewRow = await productRow(page, product.partNumber);
  await reviewRow.getByRole('link', { name: '审核', exact: true }).click();
  await page.getByRole('button', { name: '批准事实' }).click();
  await page.getByRole('dialog', { name: /批准事实版本 v\d+？/ })
    .getByRole('button', { name: '确认批准' })
    .click();
  await expect(page.getByText(/事实版本 v\d+ 已批准/).first()).toBeVisible();

  await openProductsList(page);
  const approvedRow = await productRow(page, product.partNumber);
  await approvedRow.getByRole('link', { name: product.partNumber, exact: true }).click();
  const detail = await apiGet<ProductDetail>(page, `/api/v1/products/${product.productId}/detail`);
  if (!detail.approved_fact) throw new Error('Content Editor 真实闭环缺少已批准 FactVersion');
  await page.getByRole('link', { name: '创建内容', exact: true }).click();
  await page.getByRole('combobox', { name: '已批准事实版本' }).click();
  await page.getByRole('option', { name: `v${detail.approved_fact.version} · 公开` }).click();
  await page.getByRole('combobox', { name: '目标平台' }).click();
  await page.getByRole('option', { name: platformName }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+$/i);
  await page.getByRole('link', { name: '创建初稿' }).click();
  await expect(page).toHaveURL(/\/content\/tasks\/[0-9a-f-]+\/editor$/i);

  await page.getByRole('textbox', { name: '标题' }).fill(`人工首稿 ${product.suffix}`);
  await page.getByRole('textbox', { name: '摘要' }).fill('真实栈人工首稿摘要');
  await page.getByRole('textbox', { name: '标签' }).fill('真实栈\n工业,控制');
  await page.getByRole('textbox', { name: '变更说明' }).fill('创建真实栈人工首稿');
  await page.getByRole('textbox', { name: '内容 Markdown' })
    .fill(`# 人工首稿 ${product.suffix}\n\n基于已批准事实。`);
  await page.getByRole('button', { name: '创建人工首稿' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();

  const savedTitle = `已保存人工稿 ${product.suffix}`;
  await page.getByRole('textbox', { name: '标题' }).fill(savedTitle);
  await page.getByRole('textbox', { name: '内容 Markdown' })
    .fill(`# 已保存人工稿 ${product.suffix}\n\n工作电压为 3.3 V。`);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText(/已保存 · Revision \d+/)).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  const submit = page.getByRole('dialog', { name: '提交内容审核' });
  await submit.getByRole('textbox', { name: '备注（可选）' }).fill('真实栈提交审核');
  await submit.getByRole('button', { name: '确认提交审核' }).click();
  await expect(submit).toBeHidden();
  await expect(page.getByText('只读').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '提交审核' })).toHaveCount(0);

  const taskId = new URL(page.url()).pathname.split('/').at(-2);
  if (!taskId) throw new Error('Content Editor URL 缺少 taskId');
  const context = await apiGet<ContentEditorContext>(
    page,
    `/api/v1/content-tasks/${taskId}/editor-context`,
  );
  expect(context.task.id).toBe(taskId);
  expect(context.task.workflow_stage).toBe('REVIEW_PENDING');
  expect(context.current_content).toMatchObject({
    title: savedTitle,
    source_type: 'HUMAN',
    status: 'PENDING_REVIEW',
  });
});
