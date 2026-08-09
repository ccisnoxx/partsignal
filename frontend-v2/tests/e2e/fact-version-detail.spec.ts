import {
  createFactVersion,
  createProductDetail,
  createProducts,
  expect,
  test,
  type FactVersion,
} from './fixtures/products.fixture';

const productId = '00000000-0000-4000-8000-000000000001';
const versionId = '10000000-0000-4000-8000-000000000002';
const productPath = `/products/${productId}`;
const detailPath = `${productPath}/facts/versions/${versionId}`;

function fixtureVersion(): FactVersion {
  return createFactVersion(createProducts(1)[0]);
}

test('从 Product Detail 以键盘进入只读详情，refresh 保持单一 FactVersion 数据边界并适配四档宽度', async ({ page, productsApi }, testInfo) => {
  const version = fixtureVersion();
  const detail = createProductDetail(createProducts(1)[0]);
  productsApi.setDetail({
    ...detail,
    approved_fact: {
      id: version.id,
      version: version.version,
      status: 'APPROVED',
      classification: version.classification,
      approved_at: version.approved_at ?? null,
    },
  });
  productsApi.setFactVersion(version);
  await page.goto(productPath);

  const versionLink = page.getByRole('link', { name: `v${version.version}` });
  await versionLink.focus();
  await versionLink.press('Enter');
  await expect(page).toHaveURL(detailPath);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();
  await expect(page.getByLabel('事实版本 v2 Markdown 快照')).toContainText('工作电压：5V');
  await expect(page.getByLabel('事实版本 v2 Markdown 快照')).not.toContainText('不得执行');
  await expect(page.getByText('只读 · 不可变快照')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.cm-editor, [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /批准|退回|停用|删除|保存/ })).toHaveCount(0);
  expect(productsApi.detailRequests).toHaveLength(1);
  expect(productsApi.factVersionRequests).toHaveLength(1);
  expect(productsApi.factRequests).toHaveLength(0);
  expect(productsApi.factReviewRequests).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();
  expect(productsApi.factVersionRequests).toHaveLength(2);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }
});

test('direct navigation 展示 approved、pending、changes requested，并保持返回导航与阅读焦点顺序', async ({ page, productsApi }) => {
  const approved = fixtureVersion();
  productsApi.setFactVersion(approved);
  await page.goto(detailPath);

  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();
  await expect(page.getByText('事实版本已批准')).toBeVisible();
  await expect(page.getByText('审批人', { exact: true })).toBeVisible();

  const productLink = page.getByRole('link', { name: '返回产品详情' });
  const factsLink = page.getByRole('link', { name: '返回事实工作台' });
  await productLink.focus();
  await page.keyboard.press('Tab');
  await expect(factsLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('事实版本 v2 Markdown 快照')).toBeFocused();

  productsApi.setFactVersion({
    ...approved,
    status: 'PENDING_REVIEW',
    primary_task: 'REVIEW_FACT',
    available_actions: ['APPROVE', 'REQUEST_CHANGES'],
    approved_by: null,
    approved_at: null,
  });
  await page.reload();
  await expect(page.getByText('待审核', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('审批人', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /批准|退回/ })).toHaveCount(0);

  productsApi.setFactVersion({
    ...approved,
    status: 'CHANGES_REQUESTED',
    primary_task: 'REVISE_FACT',
    available_actions: [],
    approved_by: null,
    approved_at: null,
  });
  await page.reload();
  await expect(page.getByText('待修订', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /修订|批准|退回/ })).toHaveCount(0);
});

test('productId 与 FactVersion.product_id 不一致时阻断全部 snapshot 内容', async ({ page, productsApi }) => {
  productsApi.setFactVersion({
    ...fixtureVersion(),
    product_id: '00000000-0000-4000-8000-000000000777',
    body_markdown: '# 不得泄漏的事实快照',
    change_summary: '不得泄漏的摘要',
  });
  await page.goto(detailPath);

  await expect(page.getByRole('heading', { name: '未找到该产品的事实版本' })).toBeVisible();
  await expect(page.getByText('该版本不存在或不属于当前产品，未展示任何快照内容。')).toBeVisible();
  await expect(page.getByText('不得泄漏的事实快照')).toHaveCount(0);
  await expect(page.getByText('不得泄漏的摘要')).toHaveCount(0);
  await expect(page.getByText('已批准', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);
  expect(productsApi.factVersionRequests).toHaveLength(1);
});

test('覆盖 loading、404、403、通用错误与 retry', async ({ page, productsApi }) => {
  productsApi.setFactVersion(fixtureVersion());
  productsApi.setFactVersionMode('loading');
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: '正在加载事实版本' })).toBeVisible();
  productsApi.releaseFactVersionLoading();
  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();

  productsApi.setFactVersionMode('not-found');
  await page.reload();
  await expect(page.getByRole('heading', { name: '未找到事实版本' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-version-not-found')).toBeVisible();

  productsApi.setFactVersionMode('forbidden');
  await page.reload();
  await expect(page.getByRole('heading', { name: '无法访问事实版本' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-version-forbidden')).toBeVisible();

  productsApi.setFactVersionMode('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '事实版本加载失败' })).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-version-error', { exact: true })).toBeVisible();

  productsApi.setFactVersionMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'FactVersion v2' })).toBeVisible();
});
