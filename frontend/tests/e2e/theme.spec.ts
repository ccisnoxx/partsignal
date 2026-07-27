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

test('匿名根路径经过无内容会话探测进入登录页且 CLS 达标', async ({ page }) => {
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  const csrfRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      runtimeErrors.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/csrf') csrfRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Object.defineProperty(globalThis, '__partsignalLayoutShifts', { configurable: true, value: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
        if (!entry.hadRecentInput) shifts.push(entry.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  let releaseSessionProbe!: () => void;
  const authBootPainted = new Promise<void>((resolve) => {
    releaseSessionProbe = resolve;
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await authBootPainted;
    await route.fulfill({ status: 204 });
  });

  const sessionProbe = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/auth/me',
  );
  await page.goto('/');
  await expect(page.locator('.auth-boot')).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));
  releaseSessionProbe();

  const sessionResponse = await sessionProbe;
  expect(sessionResponse.status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('账号')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: /登\s*录/ })).toBeEnabled();
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));
  const cls = await page.evaluate(() => (
    globalThis as typeof globalThis & { __partsignalLayoutShifts: number[] }
  ).__partsignalLayoutShifts.reduce((total, value) => total + value, 0));
  expect(cls).toBeLessThan(0.1);
  expect(csrfRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

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
  const animationName = await page.locator('.login-card').evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe('none');
});

test('登录页主题玻璃控件禁用模糊后仍可辨识和操作', async ({ page }) => {
  await page.goto('/login');
  const control = page.locator('.login-theme-control');
  await expect(control).toBeVisible();
  const glass = await control.evaluate((element) => {
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

  await page.addStyleTag({ content: '.login-theme-control { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
  const disabledBackdrop = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
  });
  expect(disabledBackdrop).toBe('none');
  await page.getByText('深色', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
