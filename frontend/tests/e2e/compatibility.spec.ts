/** 用项目边界验证 Baseline CSS 降级、滚动、焦点和打印，不依赖生产服务。 */
import { expect, test, type Page, type Route } from '@playwright/test';

const user = {
  id: '30000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  available_actions: [],
  revision: 1,
  created_at: '2026-07-10T08:00:00+08:00',
};

async function mockApi(page: Page, authenticated: boolean) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill(authenticated ? { json: user } : { status: 204 });
      return;
    }
    if (path === '/api/v1/auth/csrf') {
      await route.fulfill({ json: { csrf_token: 'x'.repeat(32) } });
      return;
    }
    if (path === '/api/v1/products') {
      await route.fulfill({ json: {
        items: [{
          id: '10000000-0000-4000-8000-000000000001',
          part_number: 'COMPATIBILITY-LONG-PART-NUMBER-001',
          brand: 'PartSignal',
          category: '兼容性验证',
          status: 'ACTIVE',
          revision: 1,
          facts_revision: 1,
          available_actions: ['UPDATE'],
          created_at: '2026-07-16T00:00:00Z',
          updated_at: '2026-07-16T00:00:00Z',
        }],
        page: 1,
        page_size: 100,
        total: 1,
      } });
      return;
    }
    await route.fulfill({
      status: 503,
      json: { error: { code: 'COMPATIBILITY_AUDIT', message: '兼容性检查的预期隔离响应' } },
    });
  });
}

test('登录装饰、主题单选和 backdrop 在支持与降级路径均保持可用', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/login');

  const darkMode = page.getByRole('radio', { name: '深色' });
  await darkMode.focus();
  await expect(darkMode).toBeFocused();
  await darkMode.press('Space');
  await expect(darkMode).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const styles = await page.locator('.login-page').evaluate((element) => {
    const decoration = getComputedStyle(element, '::after');
    const card = getComputedStyle(document.querySelector('.login-card')!);
    const gradient = 'linear-gradient(black, transparent)';
    const supportsMask = CSS.supports('mask-image', gradient)
      || CSS.supports('-webkit-mask-image', gradient);
    const supportsBackdrop = CSS.supports('backdrop-filter', 'blur(1px)')
      || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
    return {
      supportsMask,
      supportsBackdrop,
      decorationDisplay: decoration.display,
      maskImage: decoration.maskImage || decoration.getPropertyValue('-webkit-mask-image'),
      cardBackground: card.backgroundColor,
    };
  });
  if (styles.supportsMask) expect(styles.maskImage).not.toBe('none');
  else expect(styles.decorationDisplay).toBe('none');
  if (!styles.supportsBackdrop) expect(styles.cardBackground).not.toBe('rgba(0, 0, 0, 0)');
});

test('显式组件类保留长标签、横向滚动和 Modal 焦点回收', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/products');
  await expect(page.getByRole('heading', { level: 1, name: '产品事实' })).toBeVisible();
  await expect(page.locator('.header-context-stacked')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 760 });
  const tableScroller = page.locator('.ant-table-body');
  expect(await tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await tableScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  expect(await tableScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const addProduct = page.getByRole('button', { name: '新增产品' });
  await addProduct.focus();
  await addProduct.press('Enter');
  const dialog = page.getByRole('dialog', { name: '新增产品' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.products-create-dialog').getByRole('dialog', { name: '新增产品' })).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const longLabel = dialog.locator('.ant-form-item-label > label').first();
  await longLabel.evaluate((element) => {
    element.textContent = '产品型号兼容性验证标签与跨浏览器普通换行 Compatibility fallback label without balanced text wrapping';
  });
  const labelLayout = await longLabel.evaluate((element) => {
    const label = element.getBoundingClientRect();
    const container = element.parentElement!.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      overflow: label.right - container.right,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(labelLayout.overflow, JSON.stringify(labelLayout)).toBeLessThanOrEqual(1);
  expect(labelLayout.scrollWidth, JSON.stringify(labelLayout)).toBeLessThanOrEqual(labelLayout.clientWidth);
  expect(labelLayout.scrollHeight, JSON.stringify(labelLayout)).toBeGreaterThan(labelLayout.lineHeight * 1.5);

  const submit = dialog.getByRole('button', { name: '创建事实工作区' });
  expect(await submit.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(addProduct).toBeFocused();

  const userMenu = page.getByRole('button', { name: '打开用户操作菜单' });
  await userMenu.focus();
  await userMenu.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(userMenu).toBeFocused();

  await page.setViewportSize({ width: 375, height: 760 });
  const navigationTrigger = page.getByRole('button', { name: '切换导航' });
  await navigationTrigger.focus();
  await navigationTrigger.press('Enter');
  const navigationDialog = page.getByRole('dialog', { name: '主导航' });
  await expect(navigationDialog).toBeVisible();
  await navigationDialog.getByRole('link', { name: '内容任务' }).focus();
  await page.keyboard.press('Escape');
  await expect(navigationDialog).not.toBeVisible();
  await expect(navigationTrigger).toBeFocused();
});

test('打印路由由显式壳层类控制且保持可读宽度', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/observations/insights/print');
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 分析洞察报告' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/app-shell-print/);

  await page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.app-sider')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    document.querySelector<HTMLElement>('.app-content')?.getBoundingClientRect().width ?? 0
  ))).toBeGreaterThan(0);
  const widths = await page.evaluate(() => ({
    content: document.querySelector<HTMLElement>('.app-content')?.getBoundingClientRect().width ?? 0,
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeGreaterThan(0);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
