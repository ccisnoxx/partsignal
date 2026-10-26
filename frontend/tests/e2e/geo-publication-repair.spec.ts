/** CORE-04 显式API夹具验证实际页面/来源导航；领域持久化由PG用例验证。 */
import { createIssue, createRepairContext, expect, publicationIds, publishedArticle, repairTask, test } from './fixtures/publication.fixture';
import type { components, paths } from '../../src/shared/api/generated/schema';

type Schema = components['schemas'];
type Command = paths['/api/v1/geo/opportunities/{opportunity_id}/actions/publication-repair']['post']['requestBody']['content']['application/json'];
const id = '30000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000002';
const actionId = '30000000-0000-4000-8000-000000000003';
const time = '2026-10-25T10:00:00Z';
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
  id, revision: 2, rule_code: 'OWN_CITATION_LOST', priority: 'HIGH', status: 'ACKNOWLEDGED',
  workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'],
  scope: { subject_id: null, query_topic_id: null, prompt_variant_id: null, collection_profile_id: null, engine_surface_id: null, batch_id: null, environment_key: 'a'.repeat(64) },
  title: 'CORE-04 需要处理的发布页面', description: '已保存的历史来源需要产品事实修订', subject_name: '来源对象', product_id: publicationIds.product,
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


for (const mode of ['OPEN_ISSUE', 'CREATE_REPAIR'] as const) {
  test(`${mode}从机会到原目标页面，刷新与问题章节切换保留返回来源，不自动发布或解决`, async ({ page, publicationApi }, testInfo) => {
    if (mode === 'CREATE_REPAIR') publicationApi.seedIssue();
    const issue = createIssue(publishedArticle);
    let current = { ...base }; let action: Schema['GeoOpportunityActionRecord'] | undefined; let returning = false;
    const posts: { body: Command; csrf: string | null; key: string | null }[] = [];
    await page.route('**/api/v1/geo/opportunities**', async (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === 'GET') {
        if (url.pathname === '/api/v1/geo/opportunities') return route.fulfill({ json: { items: [current], total: 1, page: 1, page_size: 20, as_of: time, filter_options: { subjects: [], products: [], query_topics: [], prompt_variants: [], collection_profiles: [], engine_surfaces: [] } } satisfies Schema['GeoOpportunityListPage'] });
        if (url.pathname === `/api/v1/geo/opportunities/${id}/comparison`) return route.fulfill({ json: { opportunity_id: id, opportunity_revision: current.revision, opportunity: current, as_of: time, retests: [], selected_retest_batch_id: null, comparison: null, decisions: [] } satisfies Schema['GeoOpportunityComparisonRead'] });
        if (url.pathname === `/api/v1/geo/opportunities/${id}/publication-repair-options`) {
          const selectedMode = (url.searchParams.get('mode') ?? 'OPEN_ISSUE') as Schema['GeoOpportunityPublicationRepairMode'];
          return route.fulfill({ json: { opportunity_id: id, opportunity_revision: current.revision, available_action_types: ['PUBLICATION_REPAIR'], mode: selectedMode,
            candidates: [{ published_article_id: publishedArticle.id, published_content_issue_id: selectedMode === 'OPEN_ISSUE' ? null : issue.id, issue_revision: selectedMode === 'OPEN_ISSUE' ? null : issue.revision,
              actual_title: publishedArticle.actual_title, platform_profile_name: publishedArticle.platform_profile_name, final_url: publishedArticle.final_url, available: true, unavailable_reason: null }],
            page: 1, page_size: 20, total: 1, as_of: time, repair_context: selectedMode === 'CREATE_REPAIR' && url.searchParams.get('selected_issue_id') ? createRepairContext(issue, publishedArticle) : null,
          } satisfies Schema['GeoOpportunityPublicationRepairOptions'] });
        }
        if (url.pathname === `/api/v1/geo/opportunities/${id}`) {
          if (returning) return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: '返回机会的显式故障夹具', details: {}, request_id: 'core04-return' } } });
          return route.fulfill({ json: { opportunity: current, trigger_snapshot: trigger, latest_evaluation: null, sources: { items: [], total: 1, page: 2, page_size: 20 }, actions: action ? [action] : [], available_action_types: ['PUBLICATION_REPAIR'], as_of: time } satisfies Schema['GeoOpportunityDetail'] });
        }
      }
      if (request.method() === 'POST' && url.pathname === `/api/v1/geo/opportunities/${id}/actions/publication-repair`) {
        const body = request.postDataJSON() as Command;
        posts.push({ body, csrf: request.headers()['x-csrf-token'] ?? null, key: request.headers()['idempotency-key'] ?? null });
        if (body.mode === 'OPEN_ISSUE') publicationApi.seedIssue();
        const task = body.mode === 'CREATE_REPAIR'; const target = task ? publicationIds.repairTask : publicationIds.issue;
        action = { id: actionId, action_type: 'PUBLICATION_REPAIR', target_type: task ? 'ContentTask' : 'PublishedContentIssue', target_id: target, status_snapshot: 'OPEN', created_by: publicationIds.user, created_at: time, target_available: true,
          navigation_path: `${task ? '/content/tasks' : '/publishing/issues'}/${target}?source_opportunity_id=${id}`,
          source_snapshot: { schema_version: 1, opportunity_id: id, opportunity_revision: body.expected_revision, trigger_snapshot: trigger, sources: trigger.sources, product_id: publicationIds.product, query_topic_id: null,
            fact_version_id: publicationIds.factVersion, platform_profile_id: publicationIds.platform, published_article_id: publishedArticle.id, published_content_issue_id: publicationIds.issue, request_id: 'core04-browser' } };
        current = { ...current, revision: 3, status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS', action_count: 1 };
        return route.fulfill({ json: { action, opportunity_revision: 3, replayed: false } satisfies Schema['GeoOpportunityActionResult'] });
      }
      return route.fallback();
    });
    await page.route(`**/api/v1/content-tasks/${publicationIds.repairTask}/detail`, async (route) => {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json: {
        task: { id: repairTask.id, identifier: 'CT-CORE04', status: 'OPEN', workflow_stage: 'NO_DRAFT', primary_task: 'CREATE_FIRST_DRAFT', available_actions: ['CANCEL'], deletion: null, revision: 0, created_by: publicationIds.user, created_at: time, archived_at: null },
        product: { id: publicationIds.product, brand: 'PartSignal', part_number: 'PS-LNA-01', status: 'ACTIVE' },
        platform: { id: publicationIds.platform, name: publishedArticle.platform_profile_name, website_url: 'https://community.example.invalid', logo: null },
        fact: { id: publicationIds.factVersion, version: 2, status: 'APPROVED', classification: 'PUBLIC' },
        current_content: null, generation: null, review: null, publishing: null, source: null, activity: [],
      } satisfies Schema['ContentTaskDetail'] });
    });
    await page.goto(`/geo/opportunities?opportunity_id=${id}&source_page=2`);
    const sheet = page.getByRole('dialog', { name: '机会详情与历史证据' });
    const begin = sheet.getByRole('button', { name: '处理发布问题' });
    await begin.focus(); await page.keyboard.press('Enter');
    if (mode === 'CREATE_REPAIR') {
      const select = sheet.getByRole('combobox', { name: '处理方式' }); await expect(select).toBeEnabled(); await select.click();
      await page.getByRole('option', { name: '创建修复任务', exact: true }).click();
    }
    const target = sheet.getByRole('combobox', { name: mode === 'OPEN_ISSUE' ? '发布成果' : '开放发布问题' }); await expect(target).toBeEnabled(); await target.click();
    await page.getByRole('option', { name: new RegExp(publishedArticle.actual_title) }).click();
    if (mode === 'OPEN_ISSUE') await sheet.getByRole('textbox', { name: '发布问题描述' }).fill('公开页面内容发生变化，需要人工修复。');
    else {
      const fact = sheet.getByRole('combobox', { name: '修复已批准事实版本' }); await expect(fact).toBeEnabled(); await fact.click(); await page.getByRole('option', { name: /事实 v2/ }).click();
    }
    for (const width of testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    const confirm = sheet.getByRole('button', { name: mode === 'OPEN_ISSUE' ? '确认登记新发布问题' : '确认创建修复任务' }); await confirm.focus(); await page.keyboard.press('Enter');
    const link = sheet.getByRole('link', { name: mode === 'OPEN_ISSUE' ? '打开发布问题工作区' : '打开修复内容任务' }); await expect(link).toBeVisible();
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ body: { mode, expected_revision: 2 }, csrf: 'publication-e2e-csrf' }); expect(posts[0].key).toBeTruthy();
    if (mode === 'CREATE_REPAIR') expect(posts[0].body).toEqual({ mode, expected_revision: 2, expected_issue_revision: 0, published_content_issue_id: publicationIds.issue, fact_version_id: publicationIds.factVersion });
    await link.click();
    const targetPath = mode === 'OPEN_ISSUE' ? `/publishing/issues/${publicationIds.issue}` : `/content/tasks/${publicationIds.repairTask}`;
    await expect(page).toHaveURL((url) => url.pathname === targetPath && url.searchParams.get('source_opportunity_id') === id);
    const back = page.getByRole('link', { name: `返回机会 ${id}` }); await expect(back).toBeVisible();
    if (mode === 'OPEN_ISSUE') {
      await expect(page.getByRole('heading', {name: publishedArticle.actual_title})).toBeVisible();
      const tab = page.getByRole('tab', { name: '问题上下文', exact: true }); if (await tab.isVisible()) await tab.click();
      await page.getByRole('navigation', { name: '内容问题工作区章节' }).getByRole('link', { name: '发布成果', exact: true }).click();
      await expect(page).toHaveURL((url) => url.hash === '#article' && url.searchParams.get('source_opportunity_id') === id);
    } else await expect(page.getByRole('heading', { name: 'CT-CORE04' })).toBeVisible();
    await page.reload(); await expect(back).toBeVisible();
    expect(publicationApi.commandRequests).toHaveLength(0); expect(publicationApi.uploadRequests).toHaveLength(0);
    returning = true; await back.click();
    await expect(page).toHaveURL((url) => url.pathname === '/geo/opportunities' && url.searchParams.get('opportunity_id') === id);
    await expect(page.getByRole('dialog', { name: '机会详情与历史证据' })).toBeVisible(); expect(posts).toHaveLength(1);
  });
}
