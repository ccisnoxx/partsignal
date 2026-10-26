/** CORE-02 展示、真实路由映射和打印布局；资格/数量由 PG 集成测试证明。 */
import { test, expect } from './fixtures/foundation.fixture';
import type { components } from '../../src/shared/api/generated/schema';

type Schema = components['schemas'];
const id = '11111111-1111-4111-8111-111111111111';
const filters: Schema['GeoOverviewFilters'] = {
  date_from: '2026-10-01T00:00:00Z', date_to: '2026-10-02T00:00:00Z',
  subject_ids: [id], product_ids: [], query_topic_ids: [], prompt_variant_ids: [],
  collection_profile_ids: [], engine_surface_ids: [], collection_modes: ['MANUAL'],
  language_codes: ['zh-hans'], region_codes: ['CN'], login_states: [], intent_types: [],
  mention_mode: null, review_policy: 'REVIEWED_ONLY',
};
const drilldown: Schema['GeoOpportunitySummaryDrilldown'] = { source_scope: filters, open_only: true, status: null, priority: null };
const summary: Schema['GeoOpportunitySummary'] = {
  as_of: filters.date_to, open_count: 3, drilldown,
  by_status: (['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const).map((status) => ({ status, count: 1, drilldown: { ...drilldown, status } })),
  by_priority: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((priority, index) => ({ priority, count: index === 0 ? 2 : index === 1 ? 1 : 0, drilldown: { ...drilldown, priority } })),
};
const quality: Schema['GeoOverviewDataQuality'] = { candidate_run_count: 1, eligible_run_count: 0, excluded_run_count: 1,
  exclusion_reason_counts: [{ code: 'CURRENT_REVIEW_REQUIRED', run_count: 1 }], status_counts: { COMPLETED: 1 }, dimension_count: 1, cards: [] };
const overview: Schema['GeoOverview'] = { as_of: filters.date_to, filters, cards: [], metric_cells: [], key_products: [], risks: [], recent_batches: [], data_quality: quality, open_opportunities: summary,
  unavailable_sections: ['TRENDS', 'COMPETITOR_SOV', 'INSIGHT_DETAILS'] };
const qualityDrilldown = (quality_code: Schema['GeoInsightQualityDrilldown']['quality_code']): Schema['GeoInsightQualityDrilldown'] => ({ operation_id: 'listGeoInsightQualityRuns', filters, quality_code, cohort: 'DENOMINATOR', exclusion_reason: null, version_key: null, currency: null });
const report: Schema['GeoReportPreview'] = {
  as_of: filters.date_to, generated_at: filters.date_to, source_mode: 'LIVE', filters,
  available: false, unavailable_reason: 'NO_ELIGIBLE_RUNS', open_opportunities: summary,
  formulas: [], method_notes: ['CORE-02 显式只读报告夹具'], exports: [{ kind: 'opportunities', available: false, unavailable_reason: 'NOT_IMPLEMENTED' }],
  insights: { as_of: filters.date_to, filters, current_window: { date_from: filters.date_from, date_to: filters.date_to }, previous_window: { date_from: '2026-09-30T00:00:00Z', date_to: filters.date_from },
    current_cells: [], previous_cells: [], trends: [], product_matrix_cell_keys: [], competitor_sov_cell_keys: [], question_coverage: [], platform_performance: [], citation_insights: [], fact_risks: [], unavailable_sections: ['OPPORTUNITIES'],
    data_quality: { overview: quality, shared_domain_run_count: 0, shared_domain_citation_count: 0, shared_domain_drilldown: qualityDrilldown('shared_domain'), excluded_drilldown: { ...qualityDrilldown('eligible_runs'), cohort: 'EXCLUDED' }, known_costs: [], collection_versions: [], analysis_versions: [], notes: ['REVIEW_BACKLOG'] },
  },
};
const search = new URLSearchParams({ date_from: filters.date_from, date_to: filters.date_to, subject_ids: id, collection_modes: 'MANUAL', language_codes: 'zh-hans', region_codes: 'CN', review_policy: 'REVIEWED_ONLY' });

test('机会分组导航保留来源筛选，报告无合格指标仍展示机会与打印摘要', async ({ page }, testInfo) => {
  const errors: string[] = []; const reads: URL[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/api/v1/geo/overview') return route.fulfill({ json: overview });
    if (url.pathname === '/api/v1/geo/reports/print') return route.fulfill({ json: report });
    if (url.pathname === '/api/v1/geo/opportunities') {
      reads.push(url);
      // 目标页明确依赖错误；本例只证明实际 router→API 及来源说明，数量另由 PG 核对。
      return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'CORE-02 显式目标页故障', request_id: 'core02-browser' } } });
    }
    return route.fallback();
  });
  await page.goto(`/geo/overview?${search}`);
  await expect(page.getByText('待处理机会：3', { exact: true })).toBeVisible();
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const link = page.getByRole('link', { name: '查看已确认机会 1 项' });
  await link.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '汇总来源范围' })).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  const request = reads.at(-1)!;
  expect(request.searchParams.get('open_only')).toBe('true');
  expect(request.searchParams.get('status')).toBe('ACKNOWLEDGED');
  expect(JSON.parse(request.searchParams.get('source_scope')!)).toMatchObject(filters);
  await page.goBack();
  await expect(page.getByText('待处理机会：3', { exact: true })).toBeVisible();
  await page.goto(`/geo/reports/print?${search}`);
  await expect(page.getByRole('article', { name: '回答级 GEO 报告内容' })).toBeVisible();
  await expect(page.getByText('待处理机会：3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打印', exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  await expect(page.getByRole('region', { name: '待处理机会状态分布' })).toBeVisible();
  await expect(page.getByRole('region', { name: '待处理机会优先级分布' })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.geo-answer-report')!.getBoundingClientRect().width)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
