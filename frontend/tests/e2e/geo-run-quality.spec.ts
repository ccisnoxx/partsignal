/** CORE-01 的 production artifact 展示/导航；统计和关系由真实 PG 测试覆盖。 */
import { test, expect } from './fixtures/foundation.fixture';
import { detail, runId, batchId } from '../../src/domains/geo-runs/runs.test-support';
import type { components } from '../../src/shared/api/generated/schema';

test('运行质量、键盘与后续 URL 保留服务端范围和复测身份', async ({ page }, testInfo) => {
  const value = detail();
  const filters: components['schemas']['GeoOverviewFilters'] = {
    date_from: '2026-10-02T00:00:00Z', date_to: '2026-10-03T00:00:00Z',
    prompt_variant_ids: [runId], collection_profile_ids: [batchId], subject_ids: [], product_ids: [],
    query_topic_ids: [], engine_surface_ids: [], collection_modes: [], language_codes: [],
    region_codes: [], login_states: [], intent_types: [], mention_mode: null, review_policy: 'EFFECTIVE',
  };
  value.evidence_files = []; // 不加载另一测试环境的限时文件 URL。
  value.data_quality.subjects = [{ subject_id: runId, display_name: '冻结测试对象', metrics: [
    { metric_code: 'answer_coverage', eligible: false, exclusion_reasons: ['CURRENT_ANALYSIS_UNAVAILABLE'] },
    { metric_code: 'accurate_claim_rate', eligible: false, exclusion_reasons: ['ASSESSABLE_CLAIM_UNAVAILABLE'] },
  ] }];
  value.navigation = { insights: filters, insights_unavailable_reason: null,
    opportunities: [{ opportunity_id: runId, source_roles: ['TRIGGER'] }],
    retests: [{ opportunity_id: runId, baseline_id: batchId, retest_batch_id: batchId }],
  };
  const runtimeErrors: string[] = [];
  const reads: URL[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/api/v1/geo/observation-runs') return route.fulfill({ json: { items: [value.run], total: 1, page: 1, page_size: 20, as_of: value.as_of } satisfies components['schemas']['GeoRunListPage'] });
    if (url.pathname === `/api/v1/geo/observation-runs/${runId}`) return route.fulfill({ json: value });
    // 故意的依赖故障使目标页展示既有错误；只断言真实 router/API 参数映射，不伪造洞察或比较结果。
    if (url.pathname === '/api/v1/geo/insights' || url.pathname.startsWith('/api/v1/geo/opportunities')) {
      reads.push(url);
      return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'CORE-01 目标页依赖暂不可用', request_id: 'core01-browser' } } });
    }
    return route.fallback();
  });
  const source = `/geo/runs?view=runs&run_id=${runId}`;
  await page.goto(source);
  const quality = page.getByRole('region', { name: '数据质量与后续导航' });
  await expect(quality.getByText('通用资格：已排除')).toBeVisible();
  const summary = quality.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(quality.getByRole('region', { name: '冻结测试对象指标资格' })).toBeVisible();
  await expect(quality.getByText('无可判断声明')).toBeVisible();
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const insight = quality.getByRole('link', { name: /查看同问题与配置的回答洞察/ });
  await insight.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/geo\/insights\/answers\?/);
  await expect.poll(() => reads.some((url) => url.pathname === '/api/v1/geo/insights')).toBe(true);
  const insightRead = reads.find((url) => url.pathname === '/api/v1/geo/insights')!;
  expect(insightRead.searchParams.get('date_from')).toBe('2026-10-02T00:00:00.000Z');
  expect(insightRead.searchParams.get('prompt_variant_ids')).toBe(runId);
  expect(insightRead.searchParams.get('collection_profile_ids')).toBe(batchId);
  await page.goBack();
  await expect(quality).toBeVisible();
  await quality.getByRole('link', { name: /查看关联复测/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('retest_batch_id')).toBe(batchId);
  await expect.poll(() => reads.some((url) => url.pathname === `/api/v1/geo/opportunities/${runId}`)).toBe(true);
  expect(new URL(page.url()).searchParams.get('opportunity_id')).toBe(runId);
  expect(runtimeErrors).toEqual([]);
});
