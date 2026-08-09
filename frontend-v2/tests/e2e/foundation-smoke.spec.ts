import { expect, test } from './fixtures/foundation.fixture';

test('production artifact 支持 App Shell 与响应式导航', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  const staticResourceTypes = new Set(['script', 'stylesheet', 'image', 'font']);

  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && staticResourceTypes.has(response.request().resourceType())) {
      runtimeErrors.push(`resource ${response.status()}: ${response.url()}`);
    }
  });

  const rootResponse = await page.goto('/');
  expect(rootResponse?.ok()).toBe(true);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

  if (testInfo.project.name === 'foundation-mobile') {
    await page.getByRole('button', { name: '打开主导航' }).click();
    const navigation = page.getByRole('dialog');
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link', { name: '产品' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
  } else {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '产品' })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();

  expect(runtimeErrors, '页面不得出现未捕获异常或失败静态资源').toEqual([]);
});
