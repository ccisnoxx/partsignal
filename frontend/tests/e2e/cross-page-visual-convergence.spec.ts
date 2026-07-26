/** 跨主要业务路由验证唯一壳层、代表视觉基线与响应式交互边界。 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type APIResponse, type Locator, type Page, type Worker } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const themeStorageKey = 'partsignal.theme-mode';
const zoomExtensionPath = fileURLToPath(new URL('./fixtures/browser-zoom-extension', import.meta.url));

type Target = { key: string; path: string; heading: string; redirect?: RegExp };
type VisualTargetKey = 'users' | 'prompts' | 'geo-insights' | 'dashboard' | 'content-review';

test.setTimeout(240_000);

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

async function resolveTargets(page: Page): Promise<Target[]> {
  const products = await body<{ items: Array<{ id: string; part_number: string }> }>(
    await page.request.get('/api/v1/products'),
  );
  if (!products.items[0]) throw new Error('真实测试库缺少产品，无法验证跨路由壳层');

  const tasks = await body<{ items: Array<{ id: string; product: { brand: string; part_number: string } }> }>(
    await page.request.get('/api/v1/content-tasks'),
  );
  if (!tasks.items[0]) throw new Error('真实测试库缺少内容任务，无法验证任务详情壳层');

  let content: { id: string; title: string } | undefined;
  for (const task of tasks.items) {
    const versions = await body<{ items: Array<{ id: string; title: string }> }>(
      await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`),
    );
    if (versions.items[0]) {
      content = versions.items[0];
      break;
    }
  }
  if (!content) throw new Error('真实测试库缺少内容版本，无法验证内容审核壳层');

  const profiles = await body<{ items: Array<{ id: string }> }>(
    await page.request.get('/api/v1/platform-profiles'),
  );
  if (!profiles.items[0]) throw new Error('真实测试库缺少平台，无法验证 Prompt 壳层');

  return [
    { key: 'dashboard', path: '/', heading: '总览' },
    { key: 'products', path: '/products', heading: '产品事实' },
    { key: 'tasks', path: '/tasks', heading: '内容任务台' },
    { key: 'publications', path: '/publications', heading: '发布管理' },
    { key: 'observations', path: '/observations', heading: 'GEO 观测' },
    { key: 'geo-insights', path: '/observations/insights', heading: 'GEO 分析洞察' },
    { key: 'settings', path: '/settings', heading: '发布账号' },
    { key: 'accounts', path: '/settings?tab=accounts', heading: '发布账号' },
    { key: 'users', path: '/users', heading: '用户管理' },
    { key: 'audit', path: '/audit', heading: '审计日志' },
    { key: 'configuration', path: '/configuration', heading: 'AI 渠道与模型', redirect: /\/configuration\/ai(?:\/channels\/[^/]+)?$/ },
    { key: 'ai', path: '/configuration/ai', heading: 'AI 渠道与模型' },
    { key: 'platform-types', path: '/configuration/platform-types', heading: '平台类型' },
    { key: 'platforms', path: '/configuration/platforms', heading: '平台管理' },
    { key: 'product-detail', path: `/products/${products.items[0].id}`, heading: products.items[0].part_number },
    { key: 'task-detail', path: `/tasks/${tasks.items[0].id}`, heading: `${tasks.items[0].product.brand} ${tasks.items[0].product.part_number}` },
    { key: 'content', path: `/content/${content.id}`, heading: content.title },
    {
      key: 'prompts',
      path: `/configuration/prompts?tab=platform&page=1&page_size=10&platform_profile_id=${profiles.items[0].id}`,
      heading: 'Prompt 管理',
    },
  ];
}

async function openTarget(page: Page, target: Target) {
  await page.goto(target.path);
  if (target.redirect) await expect(page).toHaveURL(target.redirect);
  await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('.route-loading')).toHaveCount(0);
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
}

async function setTheme(page: Page, mode: 'light' | 'dark' | 'system') {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [themeStorageKey, mode]);
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, new URL(page.url()).pathname).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectMinimumTouchTarget(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, label).not.toBeNull();
  expect(box!.width, `${label} 宽度`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} 高度`).toBeGreaterThanOrEqual(44);
}

async function expectMobileShellTouchTargets(page: Page) {
  const navigation = page.getByRole('button', { name: '切换导航' });
  await expectMinimumTouchTarget(navigation, '移动导航按钮');
  await expectMinimumTouchTarget(page.getByRole('button', { name: /主题：/ }), '移动主题按钮');
  await navigation.click();
  const drawer = page.locator('.ant-drawer-content-wrapper:visible');
  await expect(drawer).toBeVisible();
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(280);
  await expectMinimumTouchTarget(page.locator('.mobile-drawer .ant-drawer-close'), '默认 Drawer 关闭按钮');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(navigation).toBeFocused();
}

async function setBrowserZoom(worker: Worker, zoomFactor: number) {
  return worker.evaluate(async (factor) => {
    type TabsApi = {
      query: (query: { active: boolean; lastFocusedWindow: boolean }) => Promise<Array<{ id?: number }>>;
      setZoom: (tabId: number, factor: number) => Promise<void>;
      getZoom: (tabId: number) => Promise<number>;
    };
    const tabs = (globalThis as unknown as { chrome: { tabs: TabsApi } }).chrome.tabs;
    const [activeTab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id === undefined) throw new Error('浏览器缩放扩展找不到当前活动标签页');
    await tabs.setZoom(activeTab.id, factor);
    return tabs.getZoom(activeTab.id);
  }, zoomFactor);
}

async function shellSignature(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`缺少壳层节点：${selector}`);
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    };
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const content = document.querySelector<HTMLElement>('.app-content');
    const search = document.querySelector<HTMLElement>('.global-navigation-search');
    const user = document.querySelector<HTMLElement>('.user-trigger');
    if (!shell || !content || !search || !user) throw new Error('统一壳层节点不完整');
    const style = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!);
    return {
      routeClasses: [...shell.classList].filter((name) => name.startsWith('app-shell-')),
      sider: rect('.app-sider'),
      brand: rect('.brand-mark'),
      header: rect('.app-header'),
      search: rect('.global-navigation-search'),
      user: rect('.user-trigger'),
      contentPadding: style('.app-content').paddingTop,
      fontFamily: style('.app-shell').fontFamily,
      siderBackground: style('.app-sider').backgroundColor,
      headerBackground: style('.app-header').backgroundColor,
      contentBackground: style('.app-content').backgroundColor,
    };
  });
}

function visualMasks(page: Page, key: VisualTargetKey): Locator[] {
  const identity = page.locator('.user-trigger :is(.ant-avatar, .user-block)');
  if (key === 'dashboard') {
    return [
      identity,
      page.locator('.dashboard-page > .page-header p strong'),
      page.locator('.dashboard-kpi-grid :is(.metric-value strong, .metric-meta, .ant-progress-bg)'),
      page.locator('.dashboard-status-grid :is(.dashboard-status-icon, .ant-badge, .dashboard-status-copy > .ant-typography:last-child)'),
      page.locator('.dashboard-action-list :is(.dashboard-action-icon, .dashboard-action-copy small, .dashboard-action-count, .dashboard-action-state)'),
      page.locator('.dashboard-priority-list > a strong'),
    ];
  }
  if (key === 'content-review') {
    return [
      identity,
      page.locator('.review-queue-item :is(strong, .review-queue-platform, .review-queue-meta > *)'),
      page.locator('.review-document-workspace .page-header :is(.eyebrow, h1, .content-review-header-meta > *, .page-actions .status-tag)'),
      page.locator('.review-document-overview > div:first-child > :nth-child(2), .review-document-overview .ant-tag, .review-reading-surface > *'),
      page.locator('.review-quality-totals strong, .review-decision-card > .ant-card-body > .ant-alert .ant-alert-title'),
      page.locator('.quality-issue-group :is(.quality-issue-count, .quality-issue-copy)'),
    ];
  }
  if (key === 'users') {
    return [
      identity,
      page.locator('.user-management-summary-grid .metric-value strong, .user-management-total strong'),
      page.locator('.user-management-list-card .ant-table-tbody'),
    ];
  }
  if (key === 'prompts') {
    return [
      identity,
      page.locator('.prompt-platform-list'),
      page.locator('.prompt-editor-panel > .ant-card-head'),
      page.locator('.prompt-editor-lines, .prompt-editor-surface textarea'),
      page.locator('.prompt-preview-result'),
    ];
  }
  return [
    identity,
    page.locator('.geo-insights-page time'),
    page.locator([
      '.geo-insight-quality-chip',
      '.geo-insight-trend-heading strong',
      '.geo-insight-trend-current-badge',
      '.geo-insight-trend-meta',
      '.geo-insight-trend-card svg',
      '.geo-insight-funnel-stage strong',
      '.geo-insight-funnel-conversion',
      '.geo-insight-funnel-track span',
    ].join(', ')),
    page.locator('.geo-insights-page .ant-table-tbody'),
  ];
}

async function expectThemeContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const normalize = (color: string) => {
      const probe = document.createElement('span');
      probe.style.color = color;
      document.body.append(probe);
      const normalized = getComputedStyle(probe).color;
      probe.remove();
      return normalized;
    };
    const rgb = (color: string) => normalize(color).match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
    const luminance = (color: string) => {
      const [red, green, blue] = rgb(color).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const ratio = (first: string, second: string) => {
      const values = [luminance(first), luminance(second)];
      return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    };
    const root = getComputedStyle(document.documentElement);
    const surface = root.getPropertyValue('--ps-bg-surface');
    return {
      text: ratio(root.getPropertyValue('--ps-text-primary'), surface),
      border: ratio(root.getPropertyValue('--ps-border-strong'), surface),
    };
  });
  expect(ratios.text).toBeGreaterThanOrEqual(4.5);
  expect(ratios.border).toBeGreaterThanOrEqual(3);
}

test('主要静态与动态路由在明暗主题下共享唯一桌面壳层', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    let expectedSignature: Awaited<ReturnType<typeof shellSignature>> | undefined;
    for (const target of targets) {
      await openTarget(page, target);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expectNoDocumentOverflow(page);
      const signature = await shellSignature(page);
      expect(signature.routeClasses, target.path).toEqual([]);
      expect(signature.sider).toEqual({ x: 0, y: 0, width: 208, height: 1000 });
      expect(signature.brand.height).toBe(64);
      expect(signature.header).toEqual({ x: 208, y: 0, width: 1232, height: 64 });
      expect(signature.contentPadding).toBe('20px');
      if (!expectedSignature) {
        expectedSignature = signature;
        await expectThemeContrast(page);
      } else {
        expect(signature, target.path).toEqual(expectedSignature);
      }
    }
  }

  await page.getByRole('button', { name: '收起导航' }).click();
  await expect.poll(() => page.locator('.app-sider').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(72);
  await page.getByRole('button', { name: '展开导航' }).click();
  await expect.poll(() => page.locator('.app-sider').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(208);
});

test('三个页面类型在代表窄屏保持统一边距、280px Drawer 和无文档溢出', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  const representatives = ['users', 'prompts', 'geo-insights'].map((key) => targets.find((target) => target.key === key)!);
  await setTheme(page, 'light');

  for (const width of [1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of representatives) {
      await openTarget(page, target);
      await expectNoDocumentOverflow(page);
      const padding = await page.locator('.app-content').evaluate((element) => getComputedStyle(element).paddingTop);
      expect(padding, `${target.path} @ ${width}`).toBe(width >= 992 ? '20px' : width <= 419 ? '12px' : '16px');
      if (width >= 992) {
        await expect(page.locator('.app-sider')).toBeVisible();
      } else {
        await expect(page.locator('.app-sider')).toHaveCount(0);
        await expectMobileShellTouchTargets(page);
      }
    }
  }
});

test('九张代表页基线与 Dashboard、内容审核桌面锚点可重复', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  const representatives = [
    { key: 'users', target: { ...targets.find((target) => target.key === 'users')!, path: '/users?q=admin' } },
    { key: 'prompts', target: targets.find((target) => target.key === 'prompts')! },
    {
      key: 'geo-insights',
      target: {
        ...targets.find((target) => target.key === 'geo-insights')!,
        path: '/observations/insights?date_from=2000-01-01&date_to=2000-01-30',
      },
    },
  ] as const;

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const representative of representatives) {
      await openTarget(page, representative.target);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`${representative.key}-${mode}-1440x1000.png`, {
        animations: 'disabled',
        caret: 'hide',
        mask: visualMasks(page, representative.key),
        maxDiffPixelRatio: 0.02,
      });
    }
  }

  await page.setViewportSize({ width: 375, height: 900 });
  await setTheme(page, 'light');
  for (const representative of representatives) {
    await openTarget(page, representative.target);
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`${representative.key}-light-375x900.png`, {
      animations: 'disabled',
      caret: 'hide',
      mask: visualMasks(page, representative.key),
      // Prompt 与 GEO 窄屏的大块遮罩边界会随 Chromium 平台字体换行轻微位移。
      maxDiffPixelRatio: representative.key === 'users' ? 0.02 : 0.035,
    });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopAnchors = [
    { key: 'dashboard', target: targets.find((target) => target.key === 'dashboard')! },
    { key: 'content-review', target: targets.find((target) => target.key === 'content')! },
  ] as const;
  for (const anchor of desktopAnchors) {
    await openTarget(page, anchor.target);
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(`${anchor.key}-light-1440x1000.png`, {
      animations: 'disabled',
      caret: 'hide',
      mask: visualMasks(page, anchor.key),
      maxDiffPixelRatio: 0.02,
    });
  }
});

test('system、reduced-motion、键盘焦点和打印边界可用', async ({ page }) => {
  await login(page);
  const targets = await resolveTargets(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await setTheme(page, 'system');
  await openTarget(page, targets.find((target) => target.key === 'users')!);
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.user-management-page').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  const search = page.getByRole('combobox', { name: '全局页面搜索' });
  await page.keyboard.press('Control+K');
  await expect(search).toBeFocused();
  await search.fill('审计日志');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole('heading', { level: 1, name: '审计日志' })).toBeVisible();
  await expect(page.locator('.app-content')).toBeFocused();

  await page.keyboard.press('Control+K');
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  const themeButton = page.getByRole('button', { name: /主题：/ });
  await expect(themeButton).toBeFocused();
  const focusStyle = await themeButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ visible: true, outlineStyle: 'solid', outlineWidth: '3px' });
  await page.keyboard.press('Tab');
  const userMenuButton = page.getByRole('button', { name: '打开用户操作菜单' });
  await expect(userMenuButton).toBeFocused();
  await userMenuButton.press('Enter');
  await expect(page.getByRole('menuitem', { name: '修改密码' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(userMenuButton).toBeFocused();

  await page.goto('/observations/insights/print');
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 分析洞察报告' })).toBeVisible();
  await page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.app-sider')).toBeHidden();
  await expect(page.locator('.geo-insights-print')).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('三类页面在真实浏览器 200% tab zoom 下保持关键内容与响应式边界', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'partsignal-browser-zoom-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${zoomExtensionPath}`,
      `--load-extension=${zoomExtensionPath}`,
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const page = context.pages()[0] ?? await context.newPage();
    await login(page);
    const targets = await resolveTargets(page);
    expect(await setBrowserZoom(worker, 2)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1440);

    const representatives = ['users', 'prompts', 'geo-insights']
      .map((key) => targets.find((target) => target.key === key)!);
    for (const target of representatives) {
      await openTarget(page, target);
      await expectNoDocumentOverflow(page);
      await expect(page.getByRole('button', { name: '切换导航' })).toBeVisible();
      await expect(page.locator('.app-sider')).toHaveCount(0);
      if (target.key === 'users') await expectMobileShellTouchTargets(page);
    }
    await expect(page.getByRole('heading', { level: 1, name: 'GEO 分析洞察' })).toBeVisible();
    expect(await setBrowserZoom(worker, 1)).toBe(1);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
