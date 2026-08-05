/** 跨主要业务路由验证唯一壳层、代表视觉基线与响应式交互边界。 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type APIResponse, type Locator, type Page, type Worker } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const themeStorageKey = 'partsignal.theme-mode';
const zoomExtensionPath = fileURLToPath(new URL('./fixtures/browser-zoom-extension', import.meta.url));

type Target = { key: string; path: string; heading: string; redirect?: RegExp };
type VisualTargetKey = 'users' | 'prompts' | 'geo-insights' | 'dashboard' | 'content-review';
type TableInventoryItem = { label: string; source: string; marker: string; surface: string; regionLabel: string; mobileRegionLabel?: string; dialogName?: string; hasRowAction?: boolean };

const sitewideTableInventory: TableInventoryItem[] = [
  { label: '内容任务列表', source: '../../src/features/content-tasks/ContentTasksPage.tsx', marker: 'label="内容任务列表"', surface: 'tasks', regionLabel: '内容任务列表' },
  { label: 'AI 作业列表', source: '../../src/features/content-tasks/ContentTasksPage.tsx', marker: 'label="AI 作业列表"', surface: 'task-detail', regionLabel: 'AI 作业列表' },
  { label: '内容版本列表', source: '../../src/features/content-tasks/ContentTasksPage.tsx', marker: 'label="内容版本列表"', surface: 'task-detail', regionLabel: '内容版本列表' },
  { label: '产品事实列表', source: '../../src/features/product-facts/ProductsPage.tsx', marker: 'label="产品事实列表"', surface: 'products', regionLabel: '产品事实列表' },
  { label: '事实版本列表', source: '../../src/features/product-facts/ProductFactsPage.tsx', marker: 'label="事实版本列表"', surface: 'product-versions', regionLabel: '事实版本列表' },
  { label: '待开始发布', source: '../../src/features/publications/PublicationsPage.tsx', marker: 'label="待开始发布列表"', surface: 'publication-ready', regionLabel: '待开始发布列表', mobileRegionLabel: '待开始发布移动列表' },
  { label: '发布工作', source: '../../src/features/publications/PublicationsPage.tsx', marker: "'发布管理列表'", surface: 'publication-works', regionLabel: '发布管理列表', mobileRegionLabel: '发布工作移动列表' },
  { label: '发布成果', source: '../../src/features/publications/PublicationsPage.tsx', marker: 'label="发布成果列表"', surface: 'publication-articles', regionLabel: '发布成果列表', mobileRegionLabel: '发布成果移动列表' },
  { label: '内容问题', source: '../../src/features/publications/PublicationsPage.tsx', marker: "'已解决内容问题列表'", surface: 'publication-issues', regionLabel: '已解决内容问题列表', mobileRegionLabel: '已解决内容问题移动列表' },
  { label: 'GEO 观测记录', source: '../../src/features/geo-observations/GeoObservationsPage.tsx', marker: 'label="观测记录列表"', surface: 'observations', regionLabel: '观测记录列表' },
  { label: 'GEO 文章观测结果', source: '../../src/features/geo-observations/GeoObservationForm.tsx', marker: 'label="产品文章观测结果"', surface: 'observation-form', regionLabel: '产品文章观测结果', dialogName: '登记人工观测', hasRowAction: false },
  { label: 'GEO 问题库', source: '../../src/features/geo-observations/GeoTopicsPage.tsx', marker: 'label="GEO 问题库列表"', surface: 'geo-topics', regionLabel: 'GEO 问题库列表' },
  { label: 'GEO 平台表现', source: '../../src/features/geo-observations/GeoInsightsPage.tsx', marker: 'label="GEO 平台表现"', surface: 'geo-insights', regionLabel: 'GEO 平台表现' },
  { label: 'GEO 内容排行', source: '../../src/features/geo-observations/GeoInsightsPage.tsx', marker: 'title="表现最佳内容 Top 5"', surface: 'geo-insights', regionLabel: '表现最佳内容 Top 5' },
  { label: 'GEO 问题覆盖明细', source: '../../src/features/geo-observations/GeoInsightsPage.tsx', marker: 'label="问题主题与 GEO 平台覆盖明细"', surface: 'geo-insights', regionLabel: '问题主题与 GEO 平台覆盖明细' },
  { label: 'AI 渠道列表', source: '../../src/features/configuration/AIChannelsPage.tsx', marker: 'label="AI 渠道列表"', surface: 'ai', regionLabel: 'AI 渠道列表' },
  { label: 'AI 请求 Header', source: '../../src/features/configuration/AIChannelDetailPage.tsx', marker: 'label="请求 Header 列表"', surface: 'ai-request', regionLabel: '请求 Header 列表' },
  { label: 'AI 模型列表', source: '../../src/features/configuration/AIChannelDetailPage.tsx', marker: 'label="模型列表"', surface: 'ai-models', regionLabel: '模型列表' },
  { label: 'AI 渠道操作日志', source: '../../src/features/configuration/AIChannelDetailPage.tsx', marker: 'label="渠道操作日志"', surface: 'ai-logs', regionLabel: '渠道操作日志' },
  { label: '全局审计日志', source: '../../src/features/configuration/AuditLogPage.tsx', marker: 'label="审计日志"', surface: 'audit', regionLabel: '审计日志' },
  { label: '模型发现弹窗', source: '../../src/features/configuration/ModelDiscoveryModal.tsx', marker: 'label="远端模型列表"', surface: 'ai-model-discovery', regionLabel: '远端模型列表', dialogName: '获取模型' },
  { label: '平台列表', source: '../../src/features/configuration/PlatformsPage.tsx', marker: 'label="平台列表"', surface: 'platforms', regionLabel: '平台列表' },
  { label: '平台类型列表', source: '../../src/features/configuration/PlatformTypesPage.tsx', marker: 'label="平台类型列表"', surface: 'platform-types', regionLabel: '平台类型列表' },
  { label: '发布账号列表', source: '../../src/features/settings/SettingsPage.tsx', marker: 'label="发布账号列表"', surface: 'accounts', regionLabel: '发布账号列表' },
  { label: '用户列表', source: '../../src/features/users/UserManagementPage.tsx', marker: 'label="用户列表"', surface: 'users', regionLabel: '用户列表' },
];

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
  const tasks = await body<{ items: Array<{
    id: string;
    product_id: string;
    product: { brand: string; part_number: string };
    platform: { id: string };
  }> }>(
    await page.request.get('/api/v1/content-tasks'),
  );
  let content: { id: string; title: string } | undefined;
  let taskWithContent: (typeof tasks.items)[number] | undefined;
  for (const task of tasks.items.filter((item) => item.product.part_number.startsWith('VISUAL-'))) {
    const [versions, jobs] = await Promise.all([
      body<{ items: Array<{ id: string; title: string }> }>(await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`)),
      body<{ items: unknown[] }>(await page.request.get(`/api/v1/content-tasks/${task.id}/generation-jobs`)),
    ]);
    if (versions.items[0] && jobs.items.length) {
      content = versions.items[0];
      taskWithContent = task;
      break;
    }
  }
  if (!content || !taskWithContent) throw new Error('共享视觉验收图缺少同时包含内容版本和 AI 作业的任务');

  const suffix = taskWithContent.product.part_number.slice('VISUAL-'.length);
  const channelName = `共享视觉渠道 ${suffix}`;
  const channels = await body<{ items: Array<{ id: string; name: string }> }>(
    await page.request.get(`/api/v1/ai-channels?q=${encodeURIComponent(channelName)}&page=1&page_size=50`),
  );
  const channel = channels.items.find((item) => item.name === channelName);
  if (!channel) throw new Error(`共享视觉验收图缺少 AI 渠道：${channelName}`);
  const channelDetailPath = `/configuration/ai/channels/${channel.id}`;

  return [
    { key: 'dashboard', path: '/', heading: '总览' },
    { key: 'products', path: '/products', heading: '产品事实' },
    { key: 'tasks', path: '/tasks', heading: '内容任务台' },
    { key: 'publications', path: '/publications', heading: '发布管理' },
    { key: 'publication-ready', path: '/publications?tab=works', heading: '发布管理' },
    { key: 'publication-works', path: '/publications?tab=works&status=ACTION_REQUIRED', heading: '发布管理' },
    { key: 'publication-articles', path: '/publications?tab=articles', heading: '发布管理' },
    { key: 'publication-issues', path: '/publications?tab=history&status=RESOLVED', heading: '发布管理' },
    { key: 'observations', path: '/observations', heading: 'GEO 观测' },
    { key: 'geo-insights', path: '/observations/insights', heading: 'GEO 分析洞察' },
    { key: 'geo-topics', path: '/observations/topics', heading: 'GEO 问题库' },
    { key: 'settings', path: '/settings', heading: '发布账号' },
    { key: 'accounts', path: '/settings?tab=accounts', heading: '发布账号' },
    { key: 'users', path: '/users', heading: '用户管理' },
    { key: 'audit', path: '/audit', heading: '审计日志' },
    { key: 'configuration', path: '/configuration', heading: 'AI 渠道与模型', redirect: /\/configuration\/ai(?:\/channels\/[^/]+)?$/ },
    { key: 'ai', path: '/configuration/ai', heading: 'AI 渠道与模型' },
    { key: 'ai-request', path: `${channelDetailPath}?tab=request`, heading: 'AI 渠道与模型' },
    { key: 'ai-models', path: `${channelDetailPath}?tab=models`, heading: 'AI 渠道与模型' },
    { key: 'ai-logs', path: `${channelDetailPath}?tab=logs`, heading: 'AI 渠道与模型' },
    { key: 'platform-types', path: '/configuration/platform-types', heading: '平台类型' },
    { key: 'platforms', path: '/configuration/platforms', heading: '平台管理' },
    { key: 'product-detail', path: `/products/${taskWithContent.product_id}`, heading: taskWithContent.product.part_number },
    { key: 'task-detail', path: `/tasks/${taskWithContent.id}`, heading: `${taskWithContent.product.brand} ${taskWithContent.product.part_number}` },
    { key: 'content', path: `/content/${content.id}`, heading: content.title },
    {
      key: 'prompts',
      path: `/configuration/prompts?tab=platform&page=1&page_size=10&platform_profile_id=${taskWithContent.platform.id}`,
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

async function expectTableRegionBounded(page: Page, region: Locator, context: string) {
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const box = await region.boundingBox();
  expect(box, `${context} 表格区域不存在`).not.toBeNull();
  expect(box!.x, `${context} 左侧越出视口`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${context} 右侧越出视口`).toBeLessThanOrEqual(viewportWidth + 1);
  const ellipsisStyles = await region.locator('.table-cell-ellipsis:visible').evaluateAll((elements) => (
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { overflow: style.overflow, whiteSpace: style.whiteSpace };
    })
  ));
  for (const style of ellipsisStyles) {
    expect(style).toEqual({ overflow: 'hidden', whiteSpace: 'nowrap' });
  }
  const pressuredCells = await region.locator(':is(td, th) .table-cell-ellipsis:visible').evaluateAll((elements) => (
    elements.map((element) => {
      const cell = element.closest<HTMLElement>('td, th');
      const row = element.closest<HTMLElement>('tr');
      if (!cell || !row) throw new Error('省略文本缺少表格单元格或数据行');
      const originalRowHeight = row.getBoundingClientRect().height;
      const keyboardReachable = element.closest('a, button, [tabindex]') !== null;
      const probe = element.cloneNode(true) as HTMLElement;
      probe.textContent = `长文本边界压力-${'连续内容'.repeat(80)}`;
      element.replaceWith(probe);
      const elementRect = probe.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const result = {
        contained: elementRect.left >= cellRect.left - 1 && elementRect.right <= cellRect.right + 1,
        overflowed: probe.scrollWidth > probe.clientWidth,
        keyboardReachable,
        rowHeight: row.getBoundingClientRect().height,
        originalRowHeight,
      };
      probe.replaceWith(element);
      return result;
    })
  ));
  for (const cell of pressuredCells) {
    expect(cell.contained, `${context} 省略文本越出单元格`).toBe(true);
    expect(cell.overflowed, `${context} 长文本未形成省略边界`).toBe(true);
    expect(cell.keyboardReachable, `${context} 省略文本无法通过键盘访问`).toBe(true);
    expect(cell.rowHeight, `${context} 长文本改变了行高`).toBeLessThanOrEqual(cell.originalRowHeight + 1);
  }
  const compactControls = await region.locator([
    '.ant-table-tbody > tr:visible:not(.ant-table-placeholder):not(.ant-table-measure-row) > td .ant-btn:visible',
    '.ant-table-tbody > tr:visible:not(.ant-table-placeholder):not(.ant-table-measure-row) > td .ant-tag:visible',
    '.ant-table-tbody > tr:visible:not(.ant-table-placeholder):not(.ant-table-measure-row) > td .ant-checkbox-wrapper:visible',
    '.ant-table-tbody > tr:visible:not(.ant-table-placeholder):not(.ant-table-measure-row) > td .ant-select:visible',
    '.ant-table-tbody > tr:visible:not(.ant-table-placeholder):not(.ant-table-measure-row) > td time:visible',
  ].join(', ')).evaluateAll((elements) => elements.map((element) => {
    const cell = element.closest<HTMLElement>('td');
    if (!cell) throw new Error('紧凑控件缺少表格单元格');
    const elementRect = element.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textRects: DOMRect[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textRects.push(...range.getClientRects());
    }
    return {
      label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      contained: elementRect.left >= cellRect.left - 1 && elementRect.right <= cellRect.right + 1,
      clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
      wrapped: textRects.length > 1 && new Set(textRects.map((rect) => Math.round(rect.top))).size > 1,
    };
  }));
  for (const control of compactControls) {
    expect(control.contained, `${context} 紧凑控件越出单元格：${control.label}`).toBe(true);
    expect(control.clipped, `${context} 紧凑控件内容被裁切：${control.label}`).toBe(false);
    expect(control.wrapped, `${context} 紧凑控件文字换行：${control.label}`).toBe(false);
  }
  const fixedCellBackgrounds = await region.locator('.ant-table-cell-fix-right:visible, .ant-table-cell-fix-end:visible').evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  for (const background of fixedCellBackgrounds) {
    expect(background, `${context} 固定列背景不得透明`).not.toBe('transparent');
    expect(background, `${context} 固定列背景不得透明`).not.toBe('rgba(0, 0, 0, 0)');
  }
  const firstDataRow = region
    .locator('.ant-table-tbody > tr:visible:not(.ant-table-placeholder)')
    .first();
  if (await firstDataRow.count()) {
    await firstDataRow.hover();
    await page.waitForTimeout(250);
    const hoveredFixedCellBackgrounds = await firstDataRow.locator('.ant-table-cell-fix-right, .ant-table-cell-fix-end').evaluateAll(
      (elements) => elements.map((element) => getComputedStyle(element).backgroundColor),
    );
    for (const background of hoveredFixedCellBackgrounds) {
      expect(background, `${context} 悬停固定列背景不得透明`).not.toBe('transparent');
      expect(background, `${context} 悬停固定列背景不得透明`).not.toBe('rgba(0, 0, 0, 0)');
    }
  }
}

async function expectVisibleTableRegionsBounded(page: Page) {
  const regions = page.locator('.table-region:visible');
  await expect(regions).not.toHaveCount(0);
  for (const [index, region] of (await regions.all()).entries()) {
    await expectTableRegionBounded(page, region, `${new URL(page.url()).pathname} @ 可见表 ${index + 1}`);
  }
}

async function expectInventoryTableBounded(page: Page, item: TableInventoryItem, viewportWidth: number) {
  const scope = item.dialogName
    ? page.getByRole('dialog', { name: item.dialogName, exact: true })
    : page;
  const context = `${item.label} / ${item.surface} / ${item.regionLabel} @ ${viewportWidth}px`;
  if (item.dialogName) await expect(scope, `${context} 弹窗缺失`).toBeVisible();
  if (viewportWidth < 768 && item.mobileRegionLabel) {
    const mobileRegion = scope.getByRole('list', { name: item.mobileRegionLabel, exact: true });
    await expect(mobileRegion, `${context} 移动替代区域必须唯一命中`).toHaveCount(1);
    await expect(mobileRegion, `${context} 移动替代区域不可见`).toBeVisible();
    await expect(scope.getByRole('region', { name: item.regionLabel, exact: true })).toHaveCount(0);
    const viewport = await page.evaluate(() => document.documentElement.clientWidth);
    const box = await mobileRegion.boundingBox();
    expect(box, `${context} 移动替代区域不存在`).not.toBeNull();
    expect(box!.x, `${context} 移动替代区域左侧越界`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${context} 移动替代区域右侧越界`).toBeLessThanOrEqual(viewport + 1);
    return;
  }
  const region = scope.locator('.table-region').and(
    scope.getByRole('region', { name: item.regionLabel, exact: true }),
  );
  await expect(region, `${context} 必须唯一命中`).toHaveCount(1);
  await expect(region, `${context} 目标不可见`).toBeVisible();
  await expectTableRegionBounded(page, region, context);
  if (viewportWidth >= 768) {
    const actionHeader = region.getByRole('columnheader', { name: '操作', exact: true });
    if (item.hasRowAction === false) await expect(actionHeader, `${context} 输入矩阵不应设置操作列`).toHaveCount(0);
    else await expect(actionHeader, `${context} 业务资源缺少主操作列`).toHaveCount(1);
  }
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
      maxDiffPixelRatio: 0.02,
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

test('全站 25 张业务表的源码清单与桌面、移动页面边界保持一致', async ({ page }) => {
  test.setTimeout(360_000);
  expect(sitewideTableInventory).toHaveLength(25);
  for (const item of sitewideTableInventory) {
    const source = await readFile(fileURLToPath(new URL(item.source, import.meta.url)), 'utf8');
    expect(source, `${item.label} 未命中登记的源码标记`).toContain(item.marker);
  }

  await login(page);
  const targets = await resolveTargets(page);
  const targetByKey = new Map(targets.map((target) => [target.key, target]));
  const surfaces = [...new Set(sitewideTableInventory.map((item) => item.surface))];

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
    for (const surface of surfaces) {
      const inventoryItems = sitewideTableInventory.filter((item) => item.surface === surface);
      if (surface === 'product-versions') {
        await openTarget(page, targetByKey.get('product-detail')!);
        const tab = page.getByRole('tab', { name: /事实版本/ });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      } else if (surface === 'observation-form') {
        await openTarget(page, targetByKey.get('observations')!);
        await page.getByRole('button', { name: '新建观测' }).click();
        const dialog = page.getByRole('dialog', { name: '登记人工观测', exact: true });
        await expect(dialog).toBeVisible();
        const partNumber = targetByKey.get('product-detail')!.heading;
        const productLoaded = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.ok() && url.pathname === '/api/v1/products' && url.searchParams.get('search') === partNumber;
        });
        await dialog.getByRole('combobox', { name: '产品' }).fill(partNumber);
        await productLoaded;
        await page.locator('.ant-select-dropdown:visible').getByText(targetByKey.get('task-detail')!.heading, { exact: true }).click();
      } else if (surface === 'ai-model-discovery') {
        await openTarget(page, targetByKey.get('ai-models')!);
        await page.getByRole('button', { name: '获取模型' }).click();
        await expect(page.getByRole('dialog', { name: '获取模型' })).toBeVisible();
      } else {
        await openTarget(page, targetByKey.get(surface)!);
      }
      await expectNoDocumentOverflow(page);
      for (const item of inventoryItems) await expectInventoryTableBounded(page, item, width);
      if (surface === 'observation-form' || surface === 'ai-model-discovery') {
        const dialog = page.getByRole('dialog', {
          name: surface === 'observation-form' ? '登记人工观测' : '获取模型',
        });
        await dialog.locator('.ant-modal-close').click();
        await expect(dialog).toBeHidden();
      }
      await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0);
    }
  }
});

test('五类业务表在真实浏览器 200% tab zoom 下保持关键内容与响应式边界', async () => {
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

    const representatives = ['tasks', 'publications', 'observations', 'users', 'ai']
      .map((key) => targets.find((target) => target.key === key)!);
    for (const target of representatives) {
      await openTarget(page, target);
      await expectNoDocumentOverflow(page);
      if (target.key === 'publications') {
        const mobileWorkList = page.getByRole('list', { name: '发布工作移动列表' });
        await expect(mobileWorkList).toBeVisible();
        await expect(page.locator('.publication-panel table')).toHaveCount(0);
        const box = await mobileWorkList.boundingBox();
        const viewport = await page.evaluate(() => document.documentElement.clientWidth);
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport + 1);
      } else {
        await expectVisibleTableRegionsBounded(page);
      }
      await expect(page.getByRole('button', { name: '切换导航' })).toBeVisible();
      await expect(page.locator('.app-sider')).toHaveCount(0);
      if (target.key === 'users') await expectMobileShellTouchTargets(page);
    }
    await expect(page.getByRole('heading', { level: 1, name: 'AI 渠道与模型' })).toBeVisible();
    expect(await setBrowserZoom(worker, 1)).toBe(1);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
