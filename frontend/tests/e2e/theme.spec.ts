/** 验证首屏主题边界、系统监听、减少动画与玻璃降级在真实浏览器中一致。 */
import { expect, test, type Page } from '@playwright/test';
import { projectThemes } from '../../src/app/theme';

async function expectBootTheme(page: Page, mode: keyof typeof projectThemes) {
  const tokens = projectThemes[mode];
  const expectedCanvas = await page.evaluate((color) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = color;
    return probe.style.backgroundColor;
  }, tokens.bgCanvas);
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode);
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  expect(await page.locator('html').evaluate((element) => element.style.colorScheme)).toBe(mode);
  expect(await page.locator('html').evaluate((element) => element.style.backgroundColor)).toBe(expectedCanvas);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', tokens.bgCanvas);
}

test('阻断 React 主模块后首屏脚本仍与主题画布一致', async ({ page }) => {
  await page.route('**/src/main.tsx*', (route) => route.abort());
  await page.addInitScript(() => {
    if (localStorage.getItem('partsignal.theme-mode') === null) localStorage.setItem('partsignal.theme-mode', 'dark');
  });
  await page.goto('/login');
  await expectBootTheme(page, 'dark');
  await expect(page.locator('#root')).toBeEmpty();

  await page.evaluate(() => localStorage.setItem('partsignal.theme-mode', 'light'));
  await page.reload();
  await expectBootTheme(page, 'light');
  await expect(page.locator('#root')).toBeEmpty();
});

test('跟随系统模式实时响应系统配色变化', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('partsignal.theme-mode', 'system'));
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('减少动态效果时取消页面与主题过渡', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  const animationName = await page.locator('.login-intro').evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe('none');
});

test('代表性玻璃下拉层禁用模糊后仍可辨识和操作', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /主题：/ }).click();
  const menu = page.locator('.ant-dropdown-menu').last();
  await expect(menu).toBeVisible();
  const glass = await menu.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backdrop: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
      background: style.backgroundColor,
      borderStyle: style.borderTopStyle,
      borderWidth: style.borderTopWidth,
    };
  });
  expect(glass.backdrop).toContain('blur(24px)');
  expect(glass.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(glass.borderStyle).toBe('solid');
  expect(glass.borderWidth).toBe('1px');

  await page.addStyleTag({ content: '.ant-dropdown-menu { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
  const disabledBackdrop = await menu.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
  });
  expect(disabledBackdrop).toBe('none');
  await page.getByRole('menuitem', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
