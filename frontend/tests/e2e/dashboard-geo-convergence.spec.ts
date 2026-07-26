/** 通过真实登录和真实 API 验证 Dashboard、GEO 观测与洞察的视觉、响应式和可访问性边界。 */
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD ?? 'partsignal-admin-dev';
const themeStorageKey = 'partsignal.theme-mode';
const targetPages = [
  { key: 'dashboard', path: '/', apiPath: '/api/v1/dashboard/summary', heading: '总览' },
  { key: 'observations', path: '/observations', apiPath: '/api/v1/geo-observations', heading: 'GEO 观测' },
  { key: 'insights', path: '/observations/insights', apiPath: '/api/v1/geo-insights', heading: 'GEO 分析洞察' },
] as const;

test.setTimeout(120_000);

async function responseBody<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await responseBody<{ id: string }>(await page.request.get('/api/v1/auth/me'));
}

async function openTarget(page: Page, target: typeof targetPages[number]) {
  const loaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname === target.apiPath
    && response.request().method() === 'GET'
  ));
  const [, response] = await Promise.all([page.goto(target.path), loaded]);
  expect(response.ok(), `${target.heading} 数据请求`).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  return response;
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, new URL(page.url()).pathname)
    .toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectMetricIconClearance(page: Page, selector: string) {
  const clearances = await page.locator(selector).evaluateAll((cells) => cells.map((cell) => {
    const icon = cell.querySelector<HTMLElement>('.metric-icon');
    const label = cell.querySelector<HTMLElement>('.metric-label');
    if (!icon || !label) throw new Error('指标卡缺少图标或标签');
    return { iconBottom: icon.getBoundingClientRect().bottom, labelTop: label.getBoundingClientRect().top };
  }));
  expect(clearances.length).toBeGreaterThan(0);
  for (const clearance of clearances) expect(clearance.iconBottom).toBeLessThanOrEqual(clearance.labelTop);
}

test('三页在浅色和深色主题下统一使用 PageHeader、指标状态和真实 API', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  await login(page);
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [themeStorageKey, mode]);
    for (const target of targetPages) {
      const response = await openTarget(page, target);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expectNoDocumentOverflow(page);

      if (target.key === 'dashboard') {
        await expect(page.getByRole('region', { name: 'GEO 管理指标' }).locator('.metric-tile')).toHaveCount(4);
      } else if (target.key === 'observations') {
        await expect(page.getByRole('region', { name: 'GEO 观测统计' }).locator('.metric-tile')).toHaveCount(5);
        await expect(page.getByRole('region', { name: '观测记录列表' })).toBeVisible();
      } else {
        const data = await responseBody<{ data_quality: { eligible_observation_count: number } }>(response);
        if (data.data_quality.eligible_observation_count > 0) {
          await expect(page.getByRole('region', { name: 'GEO 指标趋势' })).toBeVisible();
        } else {
          await expect(page.getByText(/当前筛选范围没有完整人工观测/)).toBeVisible();
        }
      }

      await page.screenshot({
        path: testInfo.outputPath(`${target.key}-${mode}-1440x1000.png`),
        fullPage: true,
      });
    }
  }
  expect(runtimeErrors).toEqual([]);
});

test('1024 至 320px 与 200% 缩放不产生页面横向溢出或指标图标重叠', async ({ page }, testInfo) => {
  await login(page);
  await page.evaluate((key) => localStorage.setItem(key, 'light'), themeStorageKey);

  for (const width of [1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of targetPages) {
      await openTarget(page, target);
      await expectNoDocumentOverflow(page);
      if (width <= 375 && target.key === 'dashboard') {
        await expectMetricIconClearance(page, '.dashboard-kpi-grid .metric-tile');
      }
      if (width <= 375 && target.key === 'observations') {
        await expectMetricIconClearance(page, '.geo-metric-grid .metric-tile');
      }
      if (width === 375) {
        await page.screenshot({
          path: testInfo.outputPath(`${target.key}-light-375x900.png`),
          fullPage: true,
        });
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTarget(page, targetPages[2]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(2);
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 分析洞察' })).toBeVisible();
  await expect(page.getByRole('link', { name: /导出洞察报告/ })).toBeVisible();
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
});

test('真实洞察图表提供坐标、Token、单停靠点键盘导航与可聚焦 Tooltip', async ({ page }) => {
  await login(page);
  const response = await openTarget(page, targetPages[2]);
  const data = await responseBody<{
    data_quality: { eligible_observation_count: number };
    platform_performance: unknown[];
  }>(response);
  if (data.data_quality.eligible_observation_count === 0) {
    await expect(page.getByText(/当前筛选范围没有完整人工观测/)).toBeVisible();
    await expect(page.locator('.geo-insight-trend-card svg[role="img"]')).toHaveCount(0);
    return;
  }

  const charts = page.locator('.geo-insight-trend-card svg[role="img"]');
  await expect(charts).toHaveCount(5);
  await expect(charts.first()).toHaveAttribute('aria-label', /趋势：\d{4}-\d{2}-\d{2} 至 \d{4}-\d{2}-\d{2}.*使用左右方向键/);
  await expect(charts.first()).toHaveAttribute('tabindex', '0');
  await expect(charts.first().locator('circle[tabindex]')).toHaveCount(0);
  await expect(charts.first().locator('.geo-insight-chart-grid')).toHaveCount(3);
  await expect(page.locator('.geo-insight-chart-y-axis').first()).toBeVisible();
  await expect(page.locator('.geo-insight-chart-x-axis').first()).toBeVisible();

  const chartStyle = await charts.first().evaluate((chart) => {
    const line = chart.querySelector<SVGLineElement>('.geo-insight-chart-line');
    const grid = chart.querySelector<SVGLineElement>('.geo-insight-chart-grid');
    if (!grid) throw new Error('趋势图缺少网格线');
    const gridToken = getComputedStyle(document.documentElement).getPropertyValue('--ps-chart-grid').trim();
    const probe = document.createElement('span');
    probe.style.color = gridToken;
    document.body.append(probe);
    const normalizedGridToken = getComputedStyle(probe).color;
    probe.remove();
    return {
      lineWidth: line ? getComputedStyle(line).strokeWidth : null,
      gridStroke: getComputedStyle(grid).stroke,
      gridToken: normalizedGridToken,
    };
  });
  if (chartStyle.lineWidth !== null) expect(chartStyle.lineWidth).toBe('2px');
  expect(chartStyle.gridStroke).toBe(chartStyle.gridToken);

  await charts.first().focus();
  await expect(charts.first()).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await charts.first().press('End');
  await expect(page.getByRole('tooltip')).toContainText(/\d{4}-\d{2}-\d{2}/);
  await charts.first().press('Home');
  await expect(page.getByRole('tooltip')).toBeVisible();

  const quality = page.getByRole('status', { name: /数据质量/ });
  await quality.focus();
  await expect(quality).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await quality.blur();

  if (data.platform_performance.length > 0) {
    const rate = page.locator('.geo-insight-rate-bar').first();
    await rate.focus();
    await expect(rate).toBeFocused();
    await expect(page.getByRole('tooltip', { name: /^\d+ \/ \d+ 条关系$|^无完整关系样本$/ })).toBeVisible();
  }
});

test('跟随系统、reduced-motion 与打印视图保留信息且移除非必要界面', async ({ page }, testInfo) => {
  await login(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate((key) => localStorage.setItem(key, 'system'), themeStorageKey);
  await openTarget(page, targetPages[2]);
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.geo-insights-page').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  const printLoaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/geo-insights'
    && response.request().method() === 'GET'
  ));
  await Promise.all([page.goto('/observations/insights/print'), printLoaded]);
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 分析洞察报告' })).toBeVisible();
  await expect(page.getByText('报告范围')).toBeVisible();
  await page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('.geo-insights-print')).toBeVisible();
  const printLayout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.app-content');
    const report = document.querySelector<HTMLElement>('.geo-insights-print');
    return {
      bodyHeight: document.body.scrollHeight,
      contentWidth: content?.getBoundingClientRect().width ?? 0,
      reportWidth: report?.getBoundingClientRect().width ?? 0,
      recommendationCount: report?.querySelectorAll('.geo-insight-recommendation-list article').length ?? 0,
    };
  });
  expect(printLayout.contentWidth).toBeGreaterThan(0);
  expect(printLayout.reportWidth).toBeGreaterThan(0);
  expect(printLayout.bodyHeight).toBeLessThan(5_000 + printLayout.recommendationCount * 80);
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.app-sider')).toBeHidden();
  await expect(page.locator('.geo-insight-filter-card')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('geo-insights-print-preview.png') });
  await page.pdf({
    path: testInfo.outputPath('geo-insights-report.pdf'),
    format: 'A4',
    landscape: true,
    printBackground: true,
  });
});
