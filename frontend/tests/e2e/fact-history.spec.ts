import {
  createFactVersion,
  createProducts,
  expect,
  test,
} from './fixtures/products.fixture';

const product = createProducts(6)[5];
const historyPath = `/products/${product.id}/facts/versions?page=1&pageSize=20`;

test('VIEW_FACT_HISTORY 进入 canonical 列表，保持服务端顺序、URL 历史与只读详情导航', async ({ page, productsApi }) => {
  productsApi.setFactVersion({
    ...createFactVersion(product),
    id: '10000000-0000-4000-8000-000000000025',
    version: 25,
  });
  await page.goto('/products?page=1');

  const action = page.getByRole('row', { name: /PS-0006/ }).getByRole('link', { name: '查看事实历史' });
  await expect(action).toHaveAttribute('href', historyPath);
  await action.focus();
  await action.press('Enter');
  await expect(page).toHaveURL(historyPath);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'PS-0006 事实版本历史' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveText([
    '版本', '状态', '数据级别', '变更摘要', '提交人', '提交时间',
  ]);
  const versionLinks = page.getByRole('region', { name: '事实版本历史列表' }).getByRole('link');
  await expect(versionLinks.nth(0)).toHaveText('v25');
  await expect(versionLinks.nth(1)).toHaveText('v24');
  await expect(page.getByRole('columnheader', { name: '操作' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /批准|退回|停用|删除|编辑|保存/ })).toHaveCount(0);
  expect(productsApi.factHistoryRequests).toHaveLength(1);
  expect(productsApi.detailRequests).toHaveLength(0);

  const version25 = page.getByRole('link', { name: '查看事实版本 v25（只读）' });
  await version25.focus();
  await version25.press('Enter');
  await expect(page).toHaveURL(`/products/${product.id}/facts/versions/10000000-0000-4000-8000-000000000025`);
  await expect(page.getByRole('heading', { name: 'FactVersion v25' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(historyPath);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'PS-0006 事实版本历史' })).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(`/products/${product.id}/facts/versions?page=2&pageSize=20`);
  expect(productsApi.factHistoryRequests.at(-1)?.searchParams.get('page')).toBe('2');
  expect(productsApi.factHistoryRequests.at(-1)?.searchParams.get('page_size')).toBe('20');
  await page.goBack();
  await expect(page).toHaveURL(historyPath);
  await page.goForward();
  await expect(page).toHaveURL(`/products/${product.id}/facts/versions?page=2&pageSize=20`);
});

test('direct navigation 覆盖 loading、empty、404、403、通用错误与 retry', async ({ page, productsApi }) => {
  productsApi.setFactHistoryMode('loading');
  const navigation = page.goto(historyPath);
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  productsApi.releaseFactHistoryLoading();
  await navigation;
  await expect(page.getByRole('heading', { name: 'PS-0006 事实版本历史' })).toBeVisible();

  productsApi.setFactHistoryMode('empty');
  await page.reload();
  await expect(page.getByText('暂无事实版本历史')).toBeVisible();

  productsApi.setFactHistoryMode('not-found');
  await page.reload();
  await expect(page.getByText('未找到产品事实历史')).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-history-not-found')).toBeVisible();

  productsApi.setFactHistoryMode('forbidden');
  await page.reload();
  await expect(page.getByText('无法访问产品事实历史')).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-history-forbidden')).toBeVisible();

  productsApi.setFactHistoryMode('error');
  await page.reload();
  await expect(page.getByText('事实版本历史加载失败')).toBeVisible();
  await expect(page.getByText('请求 ID：req-fact-history-error')).toBeVisible();
  productsApi.setFactHistoryMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: 'PS-0006 事实版本历史' })).toBeVisible();
});

test('事实历史在四档宽度无页面级横向溢出，表格区和版本链接可获得焦点', async ({ page }, testInfo) => {
  await page.goto(historyPath);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'PS-0006 事实版本历史' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
  }

  const tableRegion = page.getByRole('region', { name: '事实版本历史列表' });
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  const link = page.getByRole('link', { name: '查看事实版本 v25（只读）' });
  await link.focus();
  await expect(link).toBeFocused();
});
