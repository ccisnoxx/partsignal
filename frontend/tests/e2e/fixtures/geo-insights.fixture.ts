/** GEO Insights production artifact 的 generated-type 严格 fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type InsightsMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode = 'success' | 'stale';
type OptimizationCreate = components['schemas']['GeoOptimizationContentTaskCreate'];
type InsightsController = {
  insightRequests: URL[];
  optionRequests: URL[];
  createRequests: Array<{ body: OptimizationCreate; csrf: string | null; key: string | null }>;
  setInsightsMode: (mode: InsightsMode) => void;
  setCreateMode: (mode: CreateMode) => void;
  setReadOnly: (readOnly: boolean) => void;
  releaseLoading: () => void;
};

const ids = {
  user: '10000000-0000-4000-8000-000000000001',
  article: '20000000-0000-4000-8000-000000000001',
  product: '30000000-0000-4000-8000-000000000001',
  platform: '40000000-0000-4000-8000-000000000001',
  topic: '50000000-0000-4000-8000-000000000001',
  fact: '60000000-0000-4000-8000-000000000001',
  task: '70000000-0000-4000-8000-000000000001',
} as const;
const rate = { numerator: 1, denominator: 2, value: 0.5 };
const trend = {
  current: rate,
  previous: { numerator: 1, denominator: 4, value: 0.25 },
  change: 1,
  points: [
    { date: '2026-08-12', numerator: 0, denominator: 0, value: null },
    { date: '2026-08-13', ...rate },
  ],
};
const optimizationAction = {
  rule_code: 'CONTENT_DECLINE', date_from: '2026-07-15', date_to: '2026-08-13',
  published_article_id: ids.article, query_topic_id: null, geo_platform: null,
} as const;
const content = {
  published_article_id: ids.article, product_id: ids.product,
  content_platform_id: ids.platform, title: 'PS-LNA 优化指南', content_platform: '官网',
  observation_count: 2, discovery_rate: rate, mention_rate: rate, accuracy_rate: rate,
  primary_task: 'CREATE_OPTIMIZATION_TASK', optimization_action: optimizationAction,
} as const;
const insights = {
  generated_at: '2026-08-13T00:00:00Z',
  analysis_unit: 'MANUAL_OBSERVATION_PUBLICATION_RELATION',
  period: { current: { date_from: '2026-07-15', date_to: '2026-08-13' }, previous: { date_from: '2026-06-15', date_to: '2026-07-14' } },
  filter_options: {
    products: [{ id: ids.product, label: 'PartSignal PS-LNA' }],
    content_platforms: [{ id: ids.platform, label: '官网' }],
    geo_platforms: ['DeepSeek'],
    publications: [{ id: ids.article, label: content.title, platform_name: '官网' }],
    query_topics: [{ id: ids.topic, label: '如何选择 LNA？' }],
  },
  trends: { discovery_rate: trend, mention_rate: trend, accuracy_rate: trend },
  platform_performance: [{ geo_platform: 'DeepSeek', observation_count: 2, discovery_rate: rate, mention_rate: rate, accuracy_rate: rate, primary_task: 'VIEW_OBSERVATION_DETAILS' }],
  content_rankings: { best: [], declining: [{ ...content, basis: [{ metric: 'mention_rate', current_value: 0.5, previous_value: 0.8, decline: 0.3 }] }], long_unmentioned: [] },
  question_coverage: {
    by_status: { stable: 0, occasional: 0, uncovered: 1, insufficient_data: 0 },
    matrix: [{ query_topic_id: ids.topic, canonical_question: '如何选择 LNA？', geo_platform: 'DeepSeek', status: 'UNCOVERED', observation_count: 1, mentioned_observation_count: 0, coverage_rate: { numerator: 0, denominator: 1, value: 0 }, primary_task: 'ADD_OBSERVATION', optimization_action: null }],
  },
  recommendations: [{ rule_code: 'CONTENT_PERFORMANCE_DECLINE', priority: 'HIGH', title: '优先优化内容', basis_text: '提及率下降', basis_values: [], impact_relationship_count: 2, published_article_ids: [ids.article], geo_platforms: [], query_topic_ids: [], detail_path: '/publications/legacy' }],
  data_quality: { eligible_observation_count: 2, excluded_incomplete_observation_count: 1, excluded_incomplete_relation_count: 1, unavailable_sections: [{ code: 'NO_COMPLETE_PREVIOUS_OBSERVATIONS', message: '上一周期没有完整观测' }] },
} satisfies components['schemas']['GeoInsights'];
const emptyRate = { numerator: 0, denominator: 0, value: null };
const emptyTrend = { current: emptyRate, previous: emptyRate, change: null, points: [] };
const emptyInsights = {
  ...insights,
  trends: { discovery_rate: emptyTrend, mention_rate: emptyTrend, accuracy_rate: emptyTrend },
  platform_performance: [],
  content_rankings: { best: [], declining: [], long_unmentioned: [] },
  question_coverage: {
    by_status: { stable: 0, occasional: 0, uncovered: 0, insufficient_data: 0 },
    matrix: [],
  },
  recommendations: [],
  data_quality: {
    eligible_observation_count: 0,
    excluded_incomplete_observation_count: 0,
    excluded_incomplete_relation_count: 0,
    unavailable_sections: [{ code: 'NO_COMPLETE_OBSERVATIONS', message: '当前范围没有完整观测' }],
  },
} satisfies components['schemas']['GeoInsights'];
const creationOptions = {
  products: [{ id: ids.product, brand: 'PartSignal', part_number: 'PS-LNA', approved_fact_versions: [{ id: ids.fact, version: 3, classification: 'PUBLIC' }] }],
  platforms: [{ id: ids.platform, name: '官网' }],
  requested_product: { product_id: ids.product, brand: 'PartSignal', part_number: 'PS-LNA', eligibility: 'ELIGIBLE' },
} satisfies components['schemas']['ContentTaskCreationOptions'];
const user = {
  id: ids.user, username: 'admin', display_name: '管理员', account_type: 'ADMIN',
  is_active: true, must_change_password: false, workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1,
  created_at: '2026-08-13T00:00:00Z',
} satisfies components['schemas']['User'];

function errorEnvelope(code: string, message: string, requestId: string) {
  return { error: { code, message, details: {}, request_id: requestId } } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<{ insightsApi: InsightsController }>({
  insightsApi: [async ({ page }, use) => {
    let insightsMode: InsightsMode = 'success';
    let createMode: CreateMode = 'success';
    let readOnly = false;
    let releaseInsights: (() => void) | undefined;
    const insightRequests: URL[] = [];
    const optionRequests: URL[] = [];
    const createRequests: InsightsController['createRequests'] = [];
    const unexpected: string[] = [];
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) runtimeErrors.push(message.text());
    });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(); const url = new URL(request.url()); const method = request.method();
      if (method === 'GET' && url.pathname === '/api/v1/auth/me') return route.fulfill({ status: 200, json: user });
      if (method === 'GET' && url.pathname === '/api/v1/auth/csrf') return route.fulfill({ status: 200, json: { csrf_token: 'geo-insights-csrf' } satisfies components['schemas']['CsrfToken'] });
      if (method === 'GET' && url.pathname === '/api/v1/geo-insights') {
        insightRequests.push(url);
        if (insightsMode === 'loading') await new Promise<void>((resolve) => { releaseInsights = resolve; });
        if (insightsMode === 'error') return route.fulfill({ status: 409, json: errorEnvelope('GEO_INSIGHT_CONTEXT_INCOMPLETE', '洞察上下文变化', 'req-insights') });
        return route.fulfill({ status: 200, json: insightsMode === 'empty' ? emptyInsights : insights });
      }
      if (readOnly) {
        unexpected.push(`${method} ${url.pathname}`);
        return route.fulfill({ status: 501, json: errorEnvelope('UNEXPECTED_API', '打印页只能读取 GEO Insights', 'req-unexpected') });
      }
      if (method === 'GET' && url.pathname === '/api/v1/content-tasks/creation-options') {
        optionRequests.push(url); return route.fulfill({ status: 200, json: creationOptions });
      }
      if (method === 'POST' && url.pathname === '/api/v1/geo-insights/optimization-content-tasks') {
        createRequests.push({ body: request.postDataJSON() as OptimizationCreate, csrf: request.headers()['x-csrf-token'] ?? null, key: request.headers()['idempotency-key'] ?? null });
        if (createMode === 'stale') return route.fulfill({ status: 409, json: errorEnvelope('GEO_INSIGHT_STALE', '洞察已经变化', 'req-stale') });
        const body = createRequests.at(-1)!.body;
        return route.fulfill({ status: 201, json: {
          id: ids.task, product_id: body.product_id, fact_version_id: body.fact_version_id,
          platform_profile_id: body.platform_profile_id, query_topic_id: null,
          source_published_content_issue_id: null, current_content_version_id: null,
          workflow_stage: 'NO_DRAFT', primary_task: 'CREATE_FIRST_DRAFT',
          available_actions: ['CANCEL', 'DELETE', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
          deletion: null, status: 'OPEN', revision: 1, created_by: ids.user,
          created_at: '2026-08-13T00:00:00Z', archived_at: null,
        } satisfies components['schemas']['ContentTask'] });
      }
      if (method === 'GET' && url.pathname === `/api/v1/content-tasks/${ids.task}/detail`) {
        return route.fulfill({ status: 409, json: errorEnvelope('FIXTURE_DETAIL_STOP', '导航已验证', 'req-detail') });
      }
      unexpected.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 501, json: errorEnvelope('UNEXPECTED_API', '未声明请求', 'req-unexpected') });
    });
    await use({
      insightRequests, optionRequests, createRequests,
      releaseLoading: () => { insightsMode = 'success'; releaseInsights?.(); },
      setInsightsMode: (mode) => { insightsMode = mode; },
      setCreateMode: (mode) => { createMode = mode; },
      setReadOnly: (value) => { readOnly = value; },
    });
    expect(unexpected, 'Insights 页面不得请求未声明 API').toEqual([]);
    expect(runtimeErrors, 'Insights 页面不得产生运行时错误').toEqual([]);
  }, { auto: true }],
});

export { creationOptions, expect, ids, insights, test };
