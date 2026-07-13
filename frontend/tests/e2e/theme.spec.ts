/** 验证首屏脚本、系统主题监听和持久化主题在真实浏览器中一致。 */
import { expect, test } from '@playwright/test';

test('React 挂载前已应用持久化深色主题', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partsignal.theme-mode', 'dark'));
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme)).toBe('dark');
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
