/** CORE-03 显式API夹具：页面登记/导航；资格和写入语义由PG测试证明。 */
import { createProductFacts, createProducts, test, expect } from './fixtures/products.fixture';
import type { components } from '../../src/shared/api/generated/schema';

type Schema = components['schemas'];
const id = '30000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000002';
const actionId = '30000000-0000-4000-8000-000000000003';
const time = '2026-10-25T10:00:00Z';
const product = createProducts(1)[0];
const configuration: Schema['GeoRuleConfiguration'] = {
  "sample_policy": {
    "reportable_minimum": 3,
    "stable_minimum": 5
  },
  "visibility_drop_points": 0.1,
  "recommendation_drop_points": 0.1,
  "competitor_surge_points": 0.15,
  "own_citation_previous_count": 2,
  "repeated_error_minimum_runs": 3,
  "repeated_error_window_days": 30,
  "unstable_minimum_repeats": 3,
  "stability_minimum_rate": 0.67,
  "dedup_window_days": 30,
  "data_quality_minimum_success_rate": null,
  "data_quality_minimum_evidence_rate": null,
  "run_failure_consecutive_limit": null,
  "recovery": {
    "minimum_runs": 5,
    "visibility_drop_max_points": 0.0,
    "recommendation_drop_max_points": 0.0,
    "competitor_surge_max_points": 0.0,
    "topic_visibility_minimum_rate": 0.6,
    "owned_citation_minimum_count": 1,
    "stability_minimum_rate": 0.67,
    "fact_error_max_count": 0,
    "strict_comparability_required": true,
    "manual_confirmation_required": true
  }
};
const base: Schema['GeoOpportunityListItem'] = {
  id, revision: 2, rule_code: 'CRITICAL_FACT_ERROR', priority: 'HIGH', status: 'ACKNOWLEDGED',
  workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'],
  scope: { subject_id: null, query_topic_id: null, prompt_variant_id: null, collection_profile_id: null, engine_surface_id: null, batch_id: null, environment_key: 'a'.repeat(64) },
  title: 'CORE-03 需要修订的事实', description: '已保存的历史来源需要产品事实修订', subject_name: '来源对象', product_id: product.id,
  query_topic_name: null, prompt_variant_name: null, collection_profile_name: null, engine_surface_name: null,
  value: 1, threshold: 0, numerator: 1, denominator: 1, source_date_from: '2026-10-24T00:00:00Z', source_date_to: time,
  created_at: time, last_seen_at: time, acknowledged_at: time, acknowledged_by: id, resolved_at: null, resolved_by: null,
  resolution_code: null, resolution_comment: null, source_count: 1, action_count: 0,
};
const trigger: Schema['GeoOpportunityTriggerSnapshot'] = {
  schema_version: 1, rule_snapshot: { schema_version: 1, rule_set_revision: 1, configuration },
  rule_code: base.rule_code, priority: base.priority, scope: base.scope, source_date_from: base.source_date_from, source_date_to: time,
  triggered: true, value: 1, threshold: 0, numerator: 1, denominator: 1, unavailable_reasons: [],
  sources: [{ run_id: runId, analysis_revision_id: null, review_id: null, source_role: 'TRIGGER' }], details: {},
};

test('从机会显式登记事实修订，进入原事实工作区并保留来源导航，不自动保存或提交', async ({ page, productsApi }, testInfo) => {
  productsApi.setFactWorkspace(createProductFacts(product));
  let current = { ...base }; let action: Schema['GeoOpportunityActionRecord'] | undefined;
  const posts: { path: string; body: unknown; csrf: string | null; key: string | null }[] = [];
  const reads: string[] = []; let returning = false;
  await page.route('**/api/v1/geo/opportunities**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'GET') {
      reads.push(url.pathname);
      if (url.pathname === '/api/v1/geo/opportunities') return route.fulfill({ json: { items: [current], total: 1, page: 1, page_size: 20, as_of: time, filter_options: { subjects: [], products: [], query_topics: [], prompt_variants: [], collection_profiles: [], engine_surfaces: [] } } satisfies Schema['GeoOpportunityListPage'] });
      if (url.pathname === `/api/v1/geo/opportunities/${id}/comparison`) return route.fulfill({ json: { opportunity_id: id, opportunity_revision: current.revision, opportunity: current, as_of: time, retests: [], selected_retest_batch_id: null, comparison: null, decisions: [] } satisfies Schema['GeoOpportunityComparisonRead'] });
      if (url.pathname === `/api/v1/geo/opportunities/${id}/fact-revision-options`) return route.fulfill({ json: { opportunity_id: id, opportunity_revision: current.revision, available_action_types: ['FACT_REVISION'], products: [{ product_id: product.id, brand: product.brand, part_number: product.part_number }], as_of: time } satisfies Schema['GeoOpportunityFactRevisionOptions'] });
      if (url.pathname === `/api/v1/geo/opportunities/${id}`) {
        if (returning) return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: '返回目标的显式依赖故障夹具', details: {}, request_id: 'core03-return' } } });
        // 当前为来源第2页；产品资格由专用服务端选项提供，不从这张空页推断。
        return route.fulfill({ json: { opportunity: current, trigger_snapshot: trigger, latest_evaluation: null,
          sources: { items: [], total: 1, page: 2, page_size: 20 }, actions: action ? [action] : [], available_action_types: ['FACT_REVISION'], as_of: time,
        } satisfies Schema['GeoOpportunityDetail'] });
      }
    }
    if (request.method() === 'POST' && url.pathname === `/api/v1/geo/opportunities/${id}/actions/fact-revision`) {
      const body = request.postDataJSON() as Schema['GeoOpportunityFactRevisionRequest'];
      posts.push({ path: url.pathname, body, csrf: request.headers()['x-csrf-token'] ?? null, key: request.headers()['idempotency-key'] ?? null });
      action = { id: actionId, action_type: 'FACT_REVISION', target_type: 'Product', target_id: body.product_id,
        status_snapshot: 'FACTS_EDITING', created_by: id, created_at: time, target_available: true,
        navigation_path: `/products/${product.id}/facts?source_opportunity_id=${id}`,
        source_snapshot: { schema_version: 1, opportunity_id: id, opportunity_revision: body.expected_revision,
          trigger_snapshot: trigger, sources: trigger.sources, product_id: body.product_id, query_topic_id: null,
          fact_version_id: null, platform_profile_id: null, published_article_id: null, published_content_issue_id: null, request_id: 'core03-browser' },
      };
      current = { ...current, revision: 3, status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS', action_count: 1 };
      return route.fulfill({ json: { action, opportunity_revision: 3, replayed: false } satisfies Schema['GeoOpportunityActionResult'] });
    }
    return route.fallback();
  });
  await page.goto(`/geo/opportunities?opportunity_id=${id}&source_page=2`);
  const sheet = page.getByRole('dialog', { name: '机会详情与历史证据' });
  const begin = sheet.getByRole('button', { name: '发起事实修订' });
  await expect(begin).toBeVisible();
  expect(reads.some((path) => path.endsWith('/fact-revision-options'))).toBe(false);
  await begin.focus(); await page.keyboard.press('Enter');
  const select = sheet.getByRole('combobox', { name: '修订产品' });
  await expect(select).toBeEnabled(); await select.click();
  await page.getByRole('option', { name: `${product.brand} · ${product.part_number}`, exact: true }).click();
  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await sheet.getByRole('button', { name: '确认登记事实修订' }).focus(); await page.keyboard.press('Enter');
  const target = sheet.getByRole('link', { name: '打开产品事实工作区', exact: true });
  await expect(target).toBeVisible();
  await expect(sheet.getByRole('region', { name: '机会已有行动记录' })).toContainText('事实修订');
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ body: { expected_revision: 2, product_id: product.id }, csrf: 'products-e2e-csrf' }); expect(posts[0].key).toBeTruthy();
  await target.click();
  await expect(page).toHaveURL((url) => url.pathname === `/products/${product.id}/facts` && url.searchParams.get('source_opportunity_id') === id);
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toBeVisible();
  const back = page.getByRole('link', { name: `返回机会 ${id}` });
  await expect(back).toHaveAttribute('href', `/geo/opportunities?opportunity_id=${id}`);
  expect(productsApi.factSaveRequests).toHaveLength(0); expect(productsApi.factSubmitRequests).toHaveLength(0); expect(productsApi.factApproveRequests).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '事实 Markdown' })).toBeVisible();
  await expect(back).toBeVisible();
  returning = true; await back.click();
  await expect(page).toHaveURL((url) => url.pathname === '/geo/opportunities' && url.searchParams.get('opportunity_id') === id);
  await expect(page.getByRole('dialog', { name: '机会详情与历史证据' })).toBeVisible();
  expect(posts).toHaveLength(1);
});
