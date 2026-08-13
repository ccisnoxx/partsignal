import { expect, ids, insights, test } from './fixtures/geo-insights.fixture';

const canonical = '/geo/insights?from=2026-07-15&to=2026-08-13';

test('direct URL 映射筛选并完整呈现 read model、替代数据和精确 drill-down', async ({ page, insightsApi }, testInfo) => {
  await page.goto(`${canonical}&geoPlatform=DeepSeek`);
  await expect(page.getByRole('heading', { name: 'GEO 洞察' })).toBeVisible();
  expect(insightsApi.insightRequests.at(-1)?.searchParams.get('date_from')).toBe('2026-07-15');
  expect(insightsApi.insightRequests.at(-1)?.searchParams.get('date_to')).toBe('2026-08-13');
  expect(insightsApi.insightRequests.at(-1)?.searchParams.get('geo_platform')).toBe('DeepSeek');
  await expect(page.getByRole('region', { name: 'GEO 平台表现' })).toBeVisible();
  await expect(page.getByText('上一周期没有完整观测')).toBeVisible();
  await page.getByText('查看精确数据').first().click();
  await expect(page.getByRole('region', { name: '发现率每日精确数据' })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看观测' })).toHaveAttribute('href', '/geo/observations?from=2026-07-15&to=2026-08-13&page=1&pageSize=20&geoPlatform=DeepSeek');
  await expect(page.getByRole('link', { name: '补充观测' })).toHaveAttribute('href', `/geo/observations/new?queryTopicId=${ids.topic}&geoPlatform=DeepSeek`);
  await expect(page.getByText('提及率下降')).toBeVisible();
  await expect(page.getByRole('link', { name: '优先优化内容' })).toHaveCount(0);
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('筛选写回 canonical URL，reset 与浏览器历史恢复', async ({ page, insightsApi }) => {
  await page.goto(canonical);
  await page.getByRole('combobox', { name: 'GEO 平台', exact: true }).selectOption('DeepSeek');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page).toHaveURL(`${canonical}&geoPlatform=DeepSeek`);
  expect(insightsApi.insightRequests.at(-1)?.searchParams.get('geo_platform')).toBe('DeepSeek');
  await page.goBack(); await expect(page).toHaveURL(canonical);
  await page.goForward(); await expect(page).toHaveURL(`${canonical}&geoPlatform=DeepSeek`);
  await page.getByRole('button', { name: '重置' }).click();
  await expect(page).toHaveURL(canonical);
});

test('loading、首次错误重试与 empty/unavailable 状态彼此区分', async ({ page, insightsApi }) => {
  insightsApi.setInsightsMode('loading');
  await page.goto(canonical);
  await expect(page.getByText('正在读取 GEO 洞察…')).toBeVisible();
  insightsApi.releaseLoading();
  await expect(page.getByRole('heading', { name: 'GEO 洞察' })).toBeVisible();

  insightsApi.setInsightsMode('error');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('洞察上下文变化');
  insightsApi.setInsightsMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: 'GEO 洞察' })).toBeVisible();

  insightsApi.setInsightsMode('empty');
  await page.reload();
  await expect(page.getByText('当前范围没有完整观测')).toBeVisible();
  await expect(page.getByText('当前没有服务端建议。')).toBeVisible();
  await expect(page.getByText('暂无数据')).toHaveCount(6);
});

test('优化 Dialog 按需读取 options，以响应 ID 导航并携带稳定命令头', async ({ page, insightsApi }) => {
  await page.goto(canonical);
  expect(insightsApi.optionRequests).toHaveLength(0);
  await page.getByRole('button', { name: '创建优化任务' }).click();
  await expect(page.getByRole('dialog', { name: '创建 GEO 优化任务' })).toBeVisible();
  expect(insightsApi.optionRequests).toHaveLength(1);
  await page.getByLabel('已批准事实版本').selectOption(ids.fact);
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page).toHaveURL(`/content/tasks/${ids.task}`);
  expect(insightsApi.createRequests).toHaveLength(1);
  expect(insightsApi.createRequests[0]).toMatchObject({
    csrf: 'geo-insights-csrf',
    body: { ...insights.content_rankings.declining[0]!.optimization_action, product_id: ids.product, platform_profile_id: ids.platform, fact_version_id: ids.fact },
  });
  expect(insightsApi.createRequests[0]!.key).toBeTruthy();
});

test('stale/409 不自动重放，保留选择并要求显式刷新', async ({ page, insightsApi }) => {
  insightsApi.setCreateMode('stale');
  await page.goto(canonical);
  await page.getByRole('button', { name: '创建优化任务' }).click();
  await page.getByLabel('已批准事实版本').selectOption(ids.fact);
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByText('洞察已经变化', { exact: true })).toBeVisible();
  await expect(page.getByText('请求 ID：req-stale')).toBeVisible();
  await expect(page.getByLabel('已批准事实版本')).toHaveValue(ids.fact);
  await expect(page.getByRole('button', { name: '创建任务' })).toBeDisabled();
  expect(insightsApi.createRequests).toHaveLength(1);
  await page.getByRole('button', { name: '重新加载洞察' }).click();
  await expect(page.getByRole('dialog', { name: '创建 GEO 优化任务' })).toBeVisible();
  await expect(page.getByLabel('已批准事实版本')).toHaveValue(ids.fact);
  await expect(page.getByRole('button', { name: '创建任务' })).toBeEnabled();
  expect(insightsApi.createRequests).toHaveLength(1);
});
