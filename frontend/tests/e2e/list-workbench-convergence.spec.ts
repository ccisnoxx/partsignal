/** 验证首批数据列表工作台在真实浏览器中的层级、主题、窄屏与键盘边界。 */
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const themeStorageKey = 'partsignal.theme-mode';
const workbenches = [
  { key: 'users', path: '/users', apiPath: '/api/v1/users', heading: '用户管理', table: '用户列表', metrics: 5 },
  { key: 'platforms', path: '/configuration/platforms', apiPath: '/api/v1/platform-profiles', heading: '平台管理', table: '平台列表', metrics: 4 },
  { key: 'ai-channels', path: '/configuration/ai', apiPath: '/api/v1/ai-channels', heading: 'AI 渠道与模型', table: 'AI 渠道列表' },
  { key: 'audit', path: '/audit', apiPath: '/api/v1/audit-logs', heading: '审计日志', table: '审计日志' },
] as const;

test.setTimeout(120_000);

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await body<{ id: string }>(await page.request.get('/api/v1/auth/me'));
}

async function openWorkbench(page: Page, workbench: typeof workbenches[number]) {
  const dataLoaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname === workbench.apiPath
    && response.request().method() === 'GET'
  ));
  const [, response] = await Promise.all([page.goto(workbench.path), dataLoaded]);
  expect(response.ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: workbench.heading })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(page.getByRole('region', { name: workbench.table, exact: true })).toBeVisible();
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, new URL(page.url()).pathname)
    .toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectMetricContentClearance(page: Page, selector: string) {
  // 同时接受“左侧图标槽”和“上方图标槽”，只禁止图标覆盖标题或数值。
  const intersections = await page.locator(selector).evaluateAll((tiles) => tiles.map((tile) => {
    const icon = tile.querySelector<HTMLElement>('.metric-icon');
    const label = tile.querySelector<HTMLElement>('.metric-label');
    const value = tile.querySelector<HTMLElement>('.metric-value');
    if (!icon || !label || !value) throw new Error('指标卡缺少图标、标题或数值');
    const iconRect = icon.getBoundingClientRect();
    const intersects = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return iconRect.left < rect.right
        && iconRect.right > rect.left
        && iconRect.top < rect.bottom
        && iconRect.bottom > rect.top;
    };
    return { label: intersects(label), value: intersects(value) };
  }));
  expect(intersections.length).toBeGreaterThan(0);
  for (const intersection of intersections) {
    expect(intersection.label).toBe(false);
    expect(intersection.value).toBe(false);
  }
}

test('四个工作台统一使用真实 PageHeader、指标卡、筛选和表格入口', async ({ page }, testInfo) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [themeStorageKey, mode]);
    for (const workbench of workbenches) {
      await openWorkbench(page, workbench);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expectNoDocumentOverflow(page);

      if ('metrics' in workbench) {
        const regionName = workbench.key === 'users' ? '用户统计' : '平台实时统计';
        await expect(page.getByRole('region', { name: regionName }).locator('.metric-tile')).toHaveCount(workbench.metrics);
      }

      const tableRegion = page.getByRole('region', { name: workbench.table, exact: true });
      if (await tableRegion.count()) {
        await tableRegion.focus();
        await expect(tableRegion).toBeFocused();
      }

      const statusTag = page.locator('.status-tag').first();
      if (await statusTag.count()) {
        await expect(statusTag).not.toHaveText('');
        const colors = await statusTag.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor };
        });
        expect(colors.color).not.toBe(colors.background);
      }

      await page.screenshot({
        path: testInfo.outputPath(`${workbench.key}-${mode}-1440x1000.png`),
        fullPage: true,
      });
    }
  }
});

test('窄屏只允许 TableRegion 内横向滚动，并保留键盘操作', async ({ page }) => {
  await login(page);
  await page.evaluate((key) => localStorage.setItem(key, 'light'), themeStorageKey);

  for (const width of [1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const workbench of workbenches) {
      await openWorkbench(page, workbench);
      await expectNoDocumentOverflow(page);
      if (width <= 375 && workbench.key === 'users') {
        await expectMetricContentClearance(page, '.user-management-summary-grid .metric-tile');
      }
      if (width <= 375 && workbench.key === 'platforms') {
        await expectMetricContentClearance(page, '.platform-metric-grid .metric-tile');
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWorkbench(page, workbenches[0]);
  const addUser = page.getByRole('button', { name: '新增用户' });
  await addUser.focus();
  await addUser.press('Enter');
  const createDialog = page.getByRole('dialog', { name: '新增用户' });
  await expect(createDialog).toBeVisible();
  expect(await createDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(createDialog).not.toBeVisible();
  await expect(addUser).toBeFocused();

  const userSearch = page.getByRole('searchbox', { name: '搜索用户名或显示名称' });
  await userSearch.focus();
  await userSearch.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  const userTable = page.getByRole('region', { name: '用户列表' });
  await userTable.focus();
  await expect(userTable).toBeFocused();
  await userTable.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  const moreActions = page.getByRole('button', { name: /更多操作：/ }).first();
  await moreActions.focus();
  await moreActions.press('Enter');
  await expect(page.getByRole('menuitem', { name: '重置临时密码' })).toBeVisible();
  await page.keyboard.press('Escape');

  const pageSize = page.getByLabel('每页数量');
  await pageSize.focus();
  await pageSize.press('Enter');
  await page.keyboard.press('ArrowDown');
  const usersReloaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/users'
    && new URL(response.url()).searchParams.get('page_size') === '50'
  ));
  await page.keyboard.press('Enter');
  await usersReloaded;
  await expect(page).toHaveURL(/page_size=50/);

  await page.setViewportSize({ width: 768, height: 900 });
  await openWorkbench(page, workbenches[1]);
  const viewPlatform = page.getByRole('button', { name: /查看平台：/ }).first();
  await viewPlatform.focus();
  await viewPlatform.press('Enter');
  const platformDrawer = page.getByRole('dialog');
  await expect(platformDrawer).toBeVisible();
  await expect.poll(() => platformDrawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(platformDrawer).not.toBeVisible();
  await expect(viewPlatform).toBeFocused();

});

test('跟随系统主题与 reduced-motion 不改变工作台信息和操作入口', async ({ page }) => {
  await login(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate((key) => localStorage.setItem(key, 'system'), themeStorageKey);

  for (const workbench of workbenches) {
    await openWorkbench(page, workbench);
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const animatedSurface = page.locator('.page-stack, .ai-config-page').first();
    await expect(animatedSurface).toBeVisible();
    expect(await animatedSurface.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  }

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
