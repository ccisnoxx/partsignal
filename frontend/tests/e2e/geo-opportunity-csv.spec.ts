/** CORE-05 原生CSV下载与真实路由；完整集合/安全列由PG测试证明。 */
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
  as_of: filters.date_to, open_count: 2, drilldown,
  by_status: (['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const).map((status) => ({ status, count: status === 'OPEN' ? 2 : 0, drilldown: { ...drilldown, status } })),
  by_priority: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((priority, index) => ({ priority, count: index === 0 ? 2 : 0, drilldown: { ...drilldown, priority } })),
};
const quality: Schema['GeoOverviewDataQuality'] = { candidate_run_count: 1, eligible_run_count: 0, excluded_run_count: 1,
  exclusion_reason_counts: [{ code: 'CURRENT_REVIEW_REQUIRED', run_count: 1 }], status_counts: { COMPLETED: 1 }, dimension_count: 1, cards: [] };
const qualityDrilldown = (quality_code: Schema['GeoInsightQualityDrilldown']['quality_code']): Schema['GeoInsightQualityDrilldown'] => ({ operation_id: 'listGeoInsightQualityRuns', filters, quality_code, cohort: 'DENOMINATOR', exclusion_reason: null, version_key: null, currency: null });
const report: Schema['GeoReportPreview'] = {
  as_of: filters.date_to, generated_at: filters.date_to, source_mode: 'LIVE', filters,
  available: false, unavailable_reason: 'NO_ELIGIBLE_RUNS', open_opportunities: summary,
  formulas: [], method_notes: ['CORE-05 显式CSV报告夹具'], exports: [{ kind: 'opportunities', available: true, unavailable_reason: null }],
  insights: { as_of: filters.date_to, filters, current_window: { date_from: filters.date_from, date_to: filters.date_to }, previous_window: { date_from: '2026-09-30T00:00:00Z', date_to: filters.date_from },
    current_cells: [], previous_cells: [], trends: [], product_matrix_cell_keys: [], competitor_sov_cell_keys: [], question_coverage: [], platform_performance: [], citation_insights: [], fact_risks: [], unavailable_sections: ['OPPORTUNITIES'],
    data_quality: { overview: quality, shared_domain_run_count: 0, shared_domain_citation_count: 0, shared_domain_drilldown: qualityDrilldown('shared_domain'), excluded_drilldown: { ...qualityDrilldown('eligible_runs'), cohort: 'EXCLUDED' }, known_costs: [], collection_versions: [], analysis_versions: [], notes: ['REVIEW_BACKLOG'] },
  },
};
const search = new URLSearchParams({ date_from: filters.date_from, date_to: filters.date_to, subject_ids: id, collection_modes: 'MANUAL', language_codes: 'zh-hans', region_codes: 'CN', review_policy: 'REVIEWED_ONLY' });


const opportunity: Schema['GeoOpportunityListItem'] = {
  id, revision: 2, rule_code: 'CRITICAL_FACT_ERROR', priority: 'CRITICAL', status: 'DISMISSED', workflow_stage: 'CLOSED', primary_task: 'VIEW_EVIDENCE', available_actions: [],
  scope: { subject_id: id, query_topic_id: null, prompt_variant_id: null, collection_profile_id: null, engine_surface_id: null, batch_id: null, environment_key: 'a'.repeat(64) },
  title: '待导出的电压机会', description: '关闭的机会也可按工作台筛选导出', subject_name: '示例产品', product_id: null, query_topic_name: null, prompt_variant_name: null, collection_profile_name: null, engine_surface_name: null,
  value: 1, threshold: 0, numerator: 1, denominator: 1, source_date_from: filters.date_from, source_date_to: filters.date_to,
  created_at: filters.date_from, last_seen_at: filters.date_to, acknowledged_at: null, acknowledged_by: null, resolved_at: filters.date_to, resolved_by: id,
  resolution_code: 'OTHER', resolution_comment: '此说明不会导出', source_count: 1, action_count: 0,
};

test('工作台CSV忽略分页且保留当前筛选，报告无合格指标仍能原生下载机会CSV', async ({ page }, testInfo) => {
  const requests: URL[] = []; const listReads: URL[] = []; const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = { ...filters, date_from: '2026-10-01T00:00:00.000001+08:00' };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/api/v1/geo/opportunities') {
      listReads.push(url);
      return route.fulfill({ json: { items: [opportunity], total: 21, page: 3, page_size: 10, as_of: filters.date_to, filter_options: { subjects: [], products: [], query_topics: [], prompt_variants: [], collection_profiles: [], engine_surfaces: [] } } satisfies Schema['GeoOpportunityListPage'] });
    }
    if (url.pathname === '/api/v1/geo/reports/preview') return route.fulfill({ json: report });
    return route.fallback();
  });
  // 新标签的首次导航必须在Context层拦截，Page.route无法拥有该请求。
  await page.context().route('**/api/v1/geo/**', async (route) => {
    const url = new URL(route.request().url());
    if (['/api/v1/geo/opportunities/export.csv', '/api/v1/geo/reports/opportunities.csv'].includes(url.pathname)) {
      requests.push(url); const count = url.pathname.includes('/reports/') ? 2 : 21;
      const data = '\ufeffopportunity_id,status\r\n' + Array.from({ length: count }, (_, index) => `${index + 1},${count === 2 ? 'OPEN' : 'DISMISSED'}\r\n`).join('');
      return route.fulfill({ contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="geo-opportunities-20261025-100000Z.csv"', 'X-Report-As-Of': filters.date_to, 'Cache-Control': 'no-store' }, body: data });
    }
    return route.fallback();
  });
  const params = new URLSearchParams({ q: '电压', status: 'DISMISSED', sort: 'LAST_SEEN_DESC', source_scope: JSON.stringify(source), page: '3', page_size: '10' });
  await page.goto(`/geo/opportunities?${params}`);
  const link = page.getByRole('link', { name: '导出机会 CSV' }); await expect(link).toBeVisible();
  for (const width of testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await link.focus(); const downloading = page.waitForEvent('download'); await page.keyboard.press('Enter'); const download = await downloading;
  expect(download.suggestedFilename()).toBe('geo-opportunities-20261025-100000Z.csv');
  const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8'); expect(text.startsWith('\ufeff')).toBe(true); expect(text.trim().split('\r\n')).toHaveLength(22);
  const request = requests[0]!; expect(request.searchParams.get('q')).toBe('电压'); expect(request.searchParams.get('status')).toBe('DISMISSED'); expect(request.searchParams.get('sort')).toBe('LAST_SEEN_DESC');
  expect(JSON.parse(request.searchParams.get('source_scope')!)).toEqual(source); expect(request.searchParams.has('page')).toBe(false); expect(request.searchParams.has('page_size')).toBe(false); expect(listReads).toHaveLength(1);
  await page.goto(`/geo/reports?${search}`); const reportLink = page.getByRole('link', { name: '机会 CSV', exact: true }); await expect(reportLink).toBeVisible();
  await expect(page.getByRole('link', { name: '打开打印报告' })).toHaveCount(0);
  const reportDownloading = page.waitForEvent('download'); await reportLink.click(); const reportDownload = await reportDownloading;
  expect(await reportDownload.failure()).toBeNull(); const last = requests.at(-1)!;
  expect(last.pathname).toBe('/api/v1/geo/reports/opportunities.csv'); expect(last.searchParams.get('date_from')).toBe(new Date(filters.date_from).toISOString()); expect(last.searchParams.get('review_policy')).toBe('REVIEWED_ONLY');
  expect(errors).toEqual([]);
});
