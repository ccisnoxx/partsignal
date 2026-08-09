import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/products.fixture';

async function fillProductForm(page: Page) {
  await page.getByRole('textbox', { name: '产品型号' }).fill('  PS-NEW-001  ');
  await page.getByRole('textbox', { name: '品牌' }).fill('  PartSignal  ');
  await page.getByRole('textbox', { name: '类别' }).fill('  MCU  ');
}

test('Products 唯一 page Primary 进入可直达、刷新并保持导航上下文的新建页', async ({ page }) => {
  await page.goto('/products?page=1');
  const primary = page.getByRole('link', { name: '新建产品', exact: true });
  await expect(primary).toHaveCount(1);
  await primary.click();
  await expect(page).toHaveURL('/products/new');
  await expect(page.getByRole('heading', { level: 1, name: '新建产品' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL('/products/new');
  await expect(page.getByRole('heading', { level: 1, name: '新建产品' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '面包屑' })).toContainText('产品');
  await expect(page.getByRole('navigation', { name: '面包屑' }).getByText('新建产品')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('aside a[href="/products"]')).toHaveAttribute('aria-current', 'page');
});

test('客户端阻止必填和纯空白请求，并关联字段说明、错误与 ErrorSummary', async ({ page, productsApi }) => {
  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号' }).fill('   ');
  await page.getByRole('button', { name: '创建产品' }).click();

  const model = page.getByRole('textbox', { name: '产品型号' });
  await expect(model).toHaveAttribute('aria-invalid', 'true');
  await expect(model).toHaveAttribute(
    'aria-describedby',
    'new-product-part-number-description new-product-part-number-error',
  );
  await expect(page.getByRole('alert', { name: '请修正以下问题' })).toContainText('产品型号不能为空');
  expect(productsApi.createRequests).toEqual([]);
});

test('POST 使用 trim body 与 CSRF，pending 防重复，成功清除 DirtyGuard 并使列表重新获取', async ({ page, productsApi }) => {
  productsApi.setCreateMode('pending');
  await page.goto('/products/new');
  await fillProductForm(page);
  const submit = page.getByRole('button', { name: '创建产品' });
  await submit.dblclick();

  await expect.poll(() => productsApi.createRequests.length).toBe(1);
  expect(productsApi.createRequests[0]).toEqual({
    body: { part_number: 'PS-NEW-001', brand: 'PartSignal', category: 'MCU' },
    csrfToken: 'products-e2e-csrf',
  });
  await expect(page.getByRole('button', { name: '创建中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '产品型号' })).toBeDisabled();

  productsApi.releaseCreate();
  await expect(page).toHaveURL('/products/00000000-0000-4000-8000-999999999999');
  await expect(page.getByRole('dialog', { name: '要离开当前页面吗？' })).toHaveCount(0);

  const listRequestsBefore = productsApi.productRequests.length;
  await page.goto('/products?page=1');
  await expect(page.getByRole('link', { name: 'PS-NEW-001' })).toBeVisible();
  expect(productsApi.productRequests.length).toBeGreaterThan(listRequestsBefore);
});

test('duplicate、字段校验与 forbidden 使用结构化位置/form summary，修正后可重试', async ({ page, productsApi }) => {
  productsApi.setCreateMode('duplicate');
  await page.goto('/products/new');
  await fillProductForm(page);
  await page.getByRole('button', { name: '创建产品' }).click();

  let summary = page.getByRole('alert', { name: '请修正以下问题' });
  await expect(summary).toContainText('品牌与产品型号组合已存在');
  await expect(summary).toContainText('请求 ID：req-product-duplicate');
  await expect(page.getByRole('textbox', { name: '产品型号' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('textbox', { name: '品牌' })).toHaveAttribute('aria-invalid', 'true');

  productsApi.setCreateMode('validation');
  await page.getByRole('textbox', { name: '产品型号' }).fill('PS-NEW-002');
  await page.getByRole('button', { name: '创建产品' }).click();
  summary = page.getByRole('alert', { name: '请修正以下问题' });
  await expect(summary).toContainText('类别不受支持');
  await expect(summary).toContainText('请求 ID：req-product-validation');
  await expect(page.getByRole('textbox', { name: '类别' })).toHaveAttribute('aria-invalid', 'true');

  productsApi.setCreateMode('forbidden');
  await page.getByRole('textbox', { name: '类别' }).fill('处理器');
  await page.getByRole('button', { name: '创建产品' }).click();
  summary = page.getByRole('alert', { name: '请修正以下问题' });
  await expect(summary).toContainText('没有创建产品的权限');
  await expect(summary).toContainText('请求 ID：req-product-forbidden');

  productsApi.setCreateMode('success');
  await page.getByRole('button', { name: '创建产品' }).click();
  await expect(page).toHaveURL('/products/00000000-0000-4000-8000-999999999999');
});

test('dirty Cancel 与浏览器返回均支持留在页面或确认离开', async ({ page }) => {
  await page.goto('/products?page=1');
  await page.getByRole('link', { name: '新建产品', exact: true }).click();
  await page.getByRole('textbox', { name: '产品型号' }).fill('PS-DIRTY');
  await page.getByRole('button', { name: '取消' }).click();

  let dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL('/products/new');

  const blockedBack = page.goBack();
  dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await blockedBack;
  await expect(page).toHaveURL('/products/new');

  const confirmedBack = page.goBack();
  dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '放弃修改并离开' }).click();
  await confirmedBack;
  await expect(page).toHaveURL(/\/products\?page=1$/);
});

test('新建页在 375/1440 无页面级横向溢出，键盘可达且焦点可见', async ({ page }, testInfo) => {
  const width = testInfo.project.name === 'foundation-mobile' ? 375 : 1440;
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/products/new');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px 页面根不应横向溢出`).toBe(true);

  await page.keyboard.press('Tab');
  const model = page.getByRole('textbox', { name: '产品型号' });
  while (!(await model.evaluate((element) => element === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  await expect(model).toBeFocused();
  expect(await model.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none' || getComputedStyle(element).boxShadow !== 'none')).toBe(true);
});
