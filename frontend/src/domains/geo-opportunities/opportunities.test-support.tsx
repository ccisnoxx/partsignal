import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { AuthContextValue } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { analyzedDetail, reviewReceipt } from '@/domains/geo-runs/analysis.test-support';
import { configuration } from '@/domains/geo-rules/geo-rules.test-support';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import type { Opportunity, OpportunityComparisonRead, OpportunityDetail, OpportunityList } from './opportunities.model';

export const opportunityId = '30000000-0000-4000-8000-000000000001';
export const time = '2026-10-04T08:00:00Z';
export const retestId = '30000000-0000-4000-8000-000000000002';
const source = analyzedDetail();
export function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return { id: opportunityId, rule_code: 'CRITICAL_FACT_ERROR', priority: 'CRITICAL', status: 'OPEN', revision: 1,
    scope: { subject_id: source.run.id, query_topic_id: source.run.input_snapshot.prompt.query_topic_id, prompt_variant_id: source.run.prompt_variant_id, collection_profile_id: source.run.collection_profile_id, engine_surface_id: source.run.input_snapshot.profile.surface.id, batch_id: null, environment_key: 'fixture' },
    title: '严重电压事实错误', description: '原始回答与批准事实不一致', subject_name: '测试零件', product_id: source.run.id,
    query_topic_name: '冻结标准问题', prompt_variant_name: '冻结完整问题', collection_profile_name: '人工配置', engine_surface_name: '人工观测面',
    value: 1, threshold: 0, numerator: 1, denominator: 1, source_date_from: '2026-10-03T08:00:00Z', source_date_to: time,
    created_at: time, last_seen_at: time, acknowledged_at: null, acknowledged_by: null, resolved_at: null, resolved_by: null,
    resolution_code: null, resolution_comment: null, source_count: 1, action_count: 0,
    workflow_stage: 'OPEN', primary_task: 'ACKNOWLEDGE', available_actions: ['ACKNOWLEDGE', 'DISMISS'], ...overrides };
}
export function list(current = opportunity()): OpportunityList {
  const named = (name: string) => [{ id: source.run.id, name }];
  return { items: [current], total: 1, page: 1, page_size: 20, as_of: time, filter_options: { subjects: named('测试零件'), products: named('测试产品'), query_topics: named('冻结标准问题'), prompt_variants: named('冻结完整问题'), collection_profiles: named('人工配置'), engine_surfaces: named('人工观测面') } };
}
export function detail(current = opportunity()): OpportunityDetail {
  const machine = source.analysis.revisions[0]!; const review = reviewReceipt().review;
  const trigger: OpportunityDetail['trigger_snapshot'] = { schema_version: 1, rule_snapshot: { schema_version: 1, rule_set_revision: 1, configuration: configuration() }, rule_code: current.rule_code, scope: current.scope, source_date_from: current.source_date_from, source_date_to: current.source_date_to, triggered: true, priority: current.priority, value: current.value, threshold: current.threshold, numerator: current.numerator, denominator: current.denominator, unavailable_reasons: [], sources: [{ run_id: source.run.id, analysis_revision_id: machine.analysis.id, review_id: review.id, source_role: 'TRIGGER' }], details: { claim: '保存的触发依据' } };
  return { opportunity: current, trigger_snapshot: trigger, latest_evaluation: { id: source.run.id, rule_set_revision: 1, evaluated_as_of: time, created_at: time, disposition: 'CREATED', result_snapshot: trigger },
    sources: { items: [{ id: source.run.id, run_id: source.run.id, analysis_revision_id: machine.analysis.id, review_id: review.id, source_role: 'TRIGGER', created_at: time, run: source.run, answer: source.answer, citations: source.citations, evidence_files: source.evidence_files, analysis: machine, review, effective_results: source.analysis.effective_results }], total: 1, page: 1, page_size: 20 }, actions: [], available_action_types: [], as_of: time };
}
export function response(data: unknown) { return { data, response: Response.json(data) } as never; }
export function comparisonRead(current = opportunity(), withRetest = false): OpportunityComparisonRead {
  const baseline = detail(current).trigger_snapshot;
  const dimensions: components['schemas']['GeoOverviewDimensions'] = { query_topic_id: opportunityId, query_topic_revision: 1, prompt_variant_id: opportunityId, prompt_revision: 1, collection_profile_id: opportunityId, profile_revision: 1, engine_surface_id: opportunityId, surface_revision: 1, collection_mode: 'MANUAL', language_code: 'zh-CN', region_code: 'CN', login_state: 'ANONYMOUS', mention_mode: 'UNBRANDED', intent_type: 'PRODUCT', source_model: 'model-a', source_product: 'product-a', model_version: 'v1', product_version: 'v1', rule_set_version: 'frozen-v1', analysis_configuration_key: 'frozen-analysis-key', subject_versions: [[opportunityId, 1]], fact_version_bindings: [[opportunityId, opportunityId]], window_key: 'fixture-window' };
  const metric: components['schemas']['GeoRetestComparisonMetric'] = { metric_code: 'severe_error_run_rate', formula_version: 'GEO-601-v1', value: 1, numerator: 5, denominator: 5, candidate_run_count: 5, eligible_run_count: 5, excluded_run_count: 0, sample_level: 'STABLE', exclusion_reason_counts: [], unjudgeable_claim_count: 0, dimensions, unavailable_reasons: [] };
  const window: components['schemas']['GeoRetestComparisonWindow'] = { batch_id: opportunityId, date_from: baseline.source_date_from, date_to: baseline.source_date_to, candidate_run_count: 5, sources: baseline.sources, metrics: [metric], environments: [{ run_id: source.run.id, repeat_index: 1, input_snapshot: source.run.input_snapshot, source_product: 'product-a', source_model: 'model-a', source_version: 'v1', dimensions }] };
  return { opportunity_id: current.id, opportunity_revision: current.revision, opportunity: current, as_of: time,
    retests: withRetest ? [{ batch_id: retestId, baseline_id: opportunityId, baseline_batch_id: opportunityId, created_at: time, status: 'COMPLETED' }] : [], selected_retest_batch_id: withRetest ? retestId : null,
    comparison: withRetest ? { baseline_id: opportunityId, retest_batch_id: retestId, fingerprint: 'a'.repeat(64), baseline: window, retest: { ...window, batch_id: retestId, date_from: time, date_to: '2026-10-05T08:00:00Z', metrics: [{ ...metric, value: 0, numerator: 0 }] }, comparable: true, differences: [], recovery: { status: 'RECOVERED', rule_snapshot: baseline.rule_snapshot, recovery_configuration: configuration().recovery, required_run_count: 5, reference_kind: 'FROZEN_RECOVERY_THRESHOLD', reference_value: 0, observed_value: 0, threshold: 0, reasons: [], manual_confirmation_required: true }, causal_claim: 'NOT_ESTABLISHED' } : null, decisions: [] };
}
export function decisionResult(current: Opportunity, kind: components['schemas']['GeoOpportunityDecisionKind'], values: { resolution_code: string; resolution_comment: string }, evidence: OpportunityComparisonRead['comparison'] = null): components['schemas']['GeoOpportunityDecisionResult'] {
  return { opportunity: current, decision: { id: retestId, opportunity_id: current.id, decision: kind, reason_code: values.resolution_code, reason_comment: values.resolution_comment, revision_before: current.revision - 1, revision_after: current.revision, retest_batch_id: evidence?.retest_batch_id ?? null, comparison_fingerprint: evidence?.fingerprint ?? null, comparison_snapshot: evidence, created_by: opportunityId, created_at: time } };
}
export function failure(status = 409, code = 'REVISION_CONFLICT') { return { error: { error: { code, message: '服务端拒绝当前请求', details: {}, request_id: 'geo703-request' } }, response: Response.json({}, { status }) } as never; }
export function mockReads(current: () => Opportunity = opportunity, readDetail: () => OpportunityDetail = () => detail(current()), readList: () => OpportunityList = () => list(current()), readComparison: () => OpportunityComparisonRead = () => comparisonRead(current())) {
  const requests: { path: string; options: unknown }[] = [];
  const spy = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    requests.push({ path, options });
    if (path === '/api/v1/geo/opportunities') return response(readList());
    if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail());
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(readComparison());
    throw new Error(`测试收到未声明 GET：${path}`);
  });
  return Object.assign(spy, { requests });
}
export function renderOpportunities(entry = `/geo/opportunities?opportunity_id=${opportunityId}`) {
  const auth: AuthContextValue = { user: { id: '00000000-0000-4000-8000-000000000099', username: 'engineer', display_name: '测试工程师', account_type: 'ENGINEER', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: time }, csrfToken: 'geo703-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: false, refresh: vi.fn(), signOut: vi.fn(), reconcileUnknownPrincipalResult: async () => {}, runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }) };
  const client = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }), context: { queryClient: client, auth } });
  const view = render(<QueryClientProvider client={client}><TooltipProvider><RouterProvider router={router} context={{ queryClient: client, auth }} /></TooltipProvider></QueryClientProvider>);
  return { client, router, view };
}
