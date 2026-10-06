import type { components } from '@/shared/api/generated/schema';
import { baseParams, normalizeBase, type AnswerInsights, type Overview } from './insights.model';
type Schema = components['schemas'];
export const id = '11111111-1111-4111-8111-111111111111';
export const secondId = '22222222-2222-4222-8222-222222222222';
export const search = normalizeBase({ date_from: '2026-09-01T00:00:00Z', date_to: '2026-10-01T00:00:00Z', subject_ids: [id], collection_modes: ['MANUAL'], mention_mode: 'UNBRANDED' });
export const filters = baseParams(search) as Schema['GeoOverviewFilters'];
export function metric(code: Schema['GeoAnswerInsightMetric']['metric_code'] = 'natural_visibility', key = 'current', period: 'CURRENT' | 'PREVIOUS' = 'CURRENT'): Schema['GeoAnswerInsightMetric'] {
  return { metric_code: code, formula_version: 'server-metric-v1', value: 0.67, numerator: 1, denominator: 17, sample_level: 'OBSERVED', eligible_run_count: 3, excluded_run_count: 2, exclusion_reason_counts: [{ code: 'CURRENT_REVIEW_REQUIRED', run_count: 2 }], unjudgeable_claim_count: 1, unavailable_reason: null,
    drilldown: { operation_id: 'listGeoAnswerInsightRuns', filters, cell_key: key, metric_code: code, period, cohort: 'DENOMINATOR' } };
}
export function card(): Schema['GeoOverviewCard'] {
  return { ...metric(), metric_code: 'eligible_runs', drilldown: { operation_id: 'listGeoOverviewRuns', filters, metric_code: 'eligible_runs', cell_key: null, batch_id: null, cohort: 'DENOMINATOR' } };
}
export function cell(key = 'current', period: 'CURRENT' | 'PREVIOUS' = 'CURRENT'): Schema['GeoAnswerInsightCell'] {
  return { cell_key: key, subject_id: id, product_id: secondId, display_name: '虚构监测产品', selected_subject: true, sov_subject_ids: [id, secondId],
    dimensions: { query_topic_id: id, query_topic_revision: 1, prompt_variant_id: id, prompt_revision: 2, collection_profile_id: id, profile_revision: 3, engine_surface_id: id, surface_revision: 4, collection_mode: 'MANUAL', language_code: 'zh-CN', region_code: 'CN', login_state: 'ANONYMOUS', mention_mode: 'UNBRANDED', intent_type: 'PRODUCT', source_model: null, source_product: '虚构产品', model_version: null, product_version: 'v2', rule_set_version: 'server-v1', analysis_configuration_key: 'server-key', subject_versions: [[id, 1]], fact_version_bindings: [[id, secondId]], window_key: key },
    metrics: (['natural_visibility', 'recommendation_rate', 'accurate_claim_rate', 'mention_sov', 'recommendation_sov', 'owned_source_coverage', 'owned_citation_share', 'partial_claim_rate', 'incorrect_claim_rate', 'severe_error_run_rate'] as const).map((code) => metric(code, key, period)) };
}
export function answerInsights(): AnswerInsights {
  const quality = (code: Schema['GeoInsightQualityDrilldown']['quality_code']): Schema['GeoInsightQualityDrilldown'] => ({ operation_id: 'listGeoInsightQualityRuns', filters, quality_code: code, cohort: 'DENOMINATOR', exclusion_reason: null, version_key: null, currency: null });
  return { as_of: filters.date_to, filters, current_window: { date_from: filters.date_from, date_to: filters.date_to }, previous_window: { date_from: '2026-08-02T00:00:00Z', date_to: filters.date_from }, current_cells: [cell()], previous_cells: [cell('previous', 'PREVIOUS')],
    trends: [{ subject_id: id, prompt_variant_id: id, collection_profile_id: id, metric_code: 'natural_visibility', current_cell_keys: ['current'], previous_cell_keys: ['previous'], change_points: 0.02, relative_change: 0.05, minimum_run_count: 5, unavailable_reasons: [], changed_dimensions: [], version_warnings: ['MODEL_VERSION_UNKNOWN'] }],
    product_matrix_cell_keys: ['current'], competitor_sov_cell_keys: ['current'], platform_performance: [{ engine_surface_id: id, cell_keys: ['current'] }],
    question_coverage: [{ subject_id: id, stratum_key: 'server-stratum', variant_results: [{ cell_key: 'current', classification: 'OCCASIONAL', unavailable_reason: null, target_reached: false }], monitored_topic_ids: [id], eligible_topic_ids: [id], reached_topic_ids: [], target_topic_coverage: 0.45, positive_topic_coverage: null, numerator: 0, monitored_denominator: 8, eligible_denominator: 0, target_rate: 0.7, reportable_minimum: 3, stable_minimum: 5 }],
    citation_insights: [], fact_risks: [], unavailable_sections: ['OPPORTUNITIES'],
    data_quality: { overview: { candidate_run_count: 5, eligible_run_count: 3, excluded_run_count: 2, exclusion_reason_counts: [], status_counts: { COMPLETED: 3 }, dimension_count: 1, cards: [card()] }, shared_domain_run_count: 0, shared_domain_citation_count: 0, shared_domain_drilldown: quality('shared_domain'), excluded_drilldown: { ...quality('eligible_runs'), cohort: 'EXCLUDED' }, known_costs: [], collection_versions: [], analysis_versions: [], notes: ['MODEL_VERSION_UNKNOWN'] } };
}
export function overview(): Overview {
  const data = answerInsights(); const c = cell();
  const overviewCell = { cell_key: c.cell_key, subject_id: c.subject_id, product_id: c.product_id, display_name: c.display_name, dimensions: c.dimensions, cards: [{ ...card(), drilldown: { ...card().drilldown, cell_key: c.cell_key } }] };
  return { as_of: data.as_of, filters, cards: [card()], metric_cells: [overviewCell], key_products: [overviewCell], risks: [], recent_batches: [], data_quality: data.data_quality.overview,
    open_opportunities: { available: false, reason_code: 'NOT_IMPLEMENTED', open_count: null, numerator: null, denominator: null, filters }, unavailable_sections: ['OPPORTUNITIES', 'TRENDS', 'COMPETITOR_SOV', 'INSIGHT_DETAILS'] };
}
export function runSample(): Schema['GeoOverviewRunSample'] {
  return { run_id: id, batch_id: secondId, created_at: filters.date_from, status: 'COMPLETED', analysis_revision_id: secondId, review_id: null, numerator: 1, denominator: 1, exclusion_reasons: [] };
}
