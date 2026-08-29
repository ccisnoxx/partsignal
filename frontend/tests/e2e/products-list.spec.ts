import { createProducts, expect, test } from './fixtures/products.fixture';

test('Products 列表仅以 GET projection 驱动 URL 搜索、筛选、排序和分页', async ({ page, productsApi }) => {
  await page.goto('/products?page=3');
  await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(6);
  await expect(page.getByRole('link', { name: 'PS-0041' })).toBeVisible();
  expect(productsApi.productRequests).toHaveLength(1);
  expect(productsApi.productRequests[0].searchParams.get('page')).toBe('3');

  const search = page.getByRole('searchbox', { name: '搜索产品' });
  await search.fill('PS-0001');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=PS-0001.*page=1|page=1.*q=PS-0001/);
  await expect(page.getByRole('link', { name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();
  await expect(page.getByText('PartSignal Extremely Long Browser Fixture Brand Name')).toBeVisible();
  await expect(page.getByText('High Reliability Microcontroller and Embedded Control Category')).toHaveCount(1);
  expect(productsApi.productRequests.at(-1)?.searchParams.get('search')).toBe('PS-0001');

  await page.getByRole('combobox', { name: '事实状态' }).click();
  await page.getByRole('option', { name: '已批准' }).click();
  await expect(page).toHaveURL(/factStatus=APPROVED/);
  expect(productsApi.productRequests.at(-1)?.searchParams.get('fact_status')).toBe('APPROVED');

  await page.getByRole('combobox', { name: '工作流阶段' }).click();
  await page.getByRole('option', { name: '事实已批准' }).click();
  await expect(page).toHaveURL(/workflowStage=FACT_APPROVED/);
  expect(productsApi.productRequests.at(-1)?.searchParams.get('workflow_stage')).toBe('FACT_APPROVED');

  await page.getByRole('button', { name: '产品' }).click();
  await expect(page).toHaveURL(/sort=MODEL_ASC/);
  expect(productsApi.productRequests.at(-1)?.searchParams.get('sort')).toBe('MODEL_ASC');

  await page.getByRole('button', { name: '重置' }).click();
  await page.getByRole('combobox', { name: '每页条数' }).click();
  await page.getByRole('option', { name: '10 条/页' }).click();
  await expect(page).toHaveURL(/pageSize=10/);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(productsApi.productRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
  expect(productsApi.productRequests.at(-1)?.searchParams.get('page')).toBe('2');
});

test('Products URL 可刷新和历史恢复，非法参数由 route schema 规范化', async ({ page, productsApi }) => {
  await page.goto('/products?q=PS-0002&page=2&pageSize=10&sort=MODEL_DESC');
  await expect(page.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('PS-0002');
  await page.reload();
  await expect(page).toHaveURL(/q=PS-0002/);
  await expect(page.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('PS-0002');

  await page.getByRole('searchbox', { name: '搜索产品' }).fill('PS-0003');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByRole('link', { name: 'PS-0003' })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索产品' }).fill('PS-0004');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByRole('link', { name: 'PS-0004' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/q=PS-0003/);
  await expect(page.getByRole('link', { name: 'PS-0003' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('PS-0003');
  await page.goForward();
  await expect(page).toHaveURL(/q=PS-0004/);
  await expect(page.getByRole('link', { name: 'PS-0004' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('PS-0004');

  await page.goto('/products?q=%20&page=0&pageSize=999&sort=BAD&factStatus=BAD&workflowStage=BAD&extra=1');
  await expect(page).toHaveURL('/products?page=1');
  const request = productsApi.productRequests.at(-1);
  expect(request?.searchParams.get('page')).toBe('1');
  expect(request?.searchParams.get('page_size')).toBe('20');
  expect(request?.searchParams.get('search')).toBeNull();
  expect(request?.searchParams.get('fact_status')).toBeNull();
  expect(request?.searchParams.get('workflow_stage')).toBeNull();
});

test('Products 行只呈现服务端 primary、overflow 与删除条件', async ({ page }) => {
  await page.goto('/products?page=1');
  const first = page.getByRole('link', { name: 'PS-0001-VERY-LONG-MODEL-NUMBER' });
  await expect(first).toHaveAttribute('href', '/products/00000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('row', { name: /PS-0001/ }).getByRole('link', { name: '录入事实' }))
    .toHaveAttribute('href', '/products/00000000-0000-4000-8000-000000000001/facts');
  await expect(page.getByRole('row', { name: /PS-0002/ }).getByRole('link', { name: '提交审核' }))
    .toHaveAttribute('href', '/products/00000000-0000-4000-8000-000000000002/facts');

  await page.getByRole('button', { name: '更多操作：PS-0002' }).click();
  await expect(page.getByRole('menuitem', { name: '编辑产品' }))
    .toHaveAttribute('href', '/products/00000000-0000-4000-8000-000000000002');
  await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  const dialog = page.getByRole('dialog', { name: '产品“PS-0002”暂时不能删除' });
  await expect(dialog).toContainText('内容任务');
  await expect(dialog).toContainText('2');
});

test('Products 明确呈现 loading、empty、filtered empty、error 与 retry', async ({ page, productsApi }) => {
  productsApi.setMode('loading');
  const navigation = page.goto('/products?page=1');
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  productsApi.releaseLoading();
  await navigation;
  await expect(page.getByRole('link', { name: 'PS-0001-VERY-LONG-MODEL-NUMBER' })).toBeVisible();

  productsApi.setMode('empty');
  await page.goto('/products?page=2');
  await expect(page.getByText('暂无产品')).toBeVisible();
  await page.goto('/products?q=missing&page=1');
  await expect(page.getByText('未找到匹配产品')).toBeVisible();

  productsApi.setMode('error');
  await page.goto('/products?q=error&page=1');
  await expect(page.getByRole('alert')).toContainText('产品服务暂不可用');
  productsApi.setItems([{ ...createProducts(1)[0], brand: 'Error recovery brand' }]);
  productsApi.setMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('table')).toContainText('PS-');
});

test('Products 在目标宽度无页面级横向溢出且键盘焦点可操作', async ({ page }, testInfo) => {
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  await page.goto('/products?page=1');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);
  }

  const search = page.getByRole('searchbox', { name: '搜索产品' });
  await search.focus();
  await expect(search).toBeFocused();
  await search.fill('PS-0004');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=PS-0004/);
  const more = page.getByRole('button', { name: '更多操作：PS-0004' });
  await expect(more).toBeVisible();
  await more.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '编辑产品' })).toHaveAttribute('data-highlighted');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
