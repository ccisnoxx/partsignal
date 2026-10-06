import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { baseFromFilters, cleanRecord, metricLabels, normalizeBase, type BaseSearch, type Drilldown } from './insights.model';

type Schema = components['schemas'];
type Query<Op extends keyof operations> = operations[Op] extends { parameters: { query: infer Q } } ? Q : never;
export type OverviewParams = Query<'listGeoOverviewRuns'>;
export type MetricParams = Query<'listGeoAnswerInsightRuns'>;
export type CitationParams = Query<'listGeoInsightCitations'>;
export type ClaimParams = Query<'listGeoInsightClaims'>;
export type QualityParams = Query<'listGeoInsightQualityRuns'>;

const overviewMetrics = ['answer_coverage', 'natural_visibility', 'product_mention', 'recommendation_rate', 'top_recommendation_rate', 'owned_source_coverage', 'accurate_claim_rate', 'severe_error_run_rate', 'eligible_runs', 'run_success_rate', 'analysis_run_coverage', 'review_backlog', 'evidence_completeness', 'cost_coverage', 'model_version_coverage'] as const satisfies readonly OverviewParams['metric_code'][];
const answerMetrics = ['natural_visibility', 'recommendation_rate', 'accurate_claim_rate', 'mention_sov', 'recommendation_sov', 'owned_source_coverage', 'owned_citation_share', 'partial_claim_rate', 'incorrect_claim_rate', 'severe_error_run_rate'] as const satisfies readonly MetricParams['metric_code'][];
const qualityCodes = ['eligible_runs', 'run_success_rate', 'analysis_run_coverage', 'review_backlog', 'evidence_completeness', 'cost_coverage', 'model_version_coverage', 'shared_domain', 'collection_version', 'analysis_version'] as const satisfies readonly Schema['GeoInsightQualityDrilldown']['quality_code'][];

const detailShape = z.object({
  detail: z.enum(['overview', 'metric', 'citations', 'claims', 'quality']).optional(),
  cell_key: z.string().min(1).max(256).optional(),
  metric_code: z.enum(Object.keys(metricLabels) as [keyof typeof metricLabels, ...Array<keyof typeof metricLabels>]).optional(),
  quality_code: z.enum(qualityCodes).optional(), batch_id: canonicalUuidSchema.optional(),
  cohort: z.enum(['CANDIDATE', 'NUMERATOR', 'EXCLUDED']).optional(), period: z.literal('PREVIOUS').optional(),
  hostname: z.string().min(1).max(253).optional(), normalized_url: z.string().min(1).max(4096).optional(),
  source_category: z.enum(['OWNED', 'COMPETITOR', 'INDUSTRY_MEDIA', 'DISTRIBUTOR', 'COMMUNITY', 'SOCIAL', 'SEARCH_ENGINE', 'ACADEMIC_OR_INSTITUTIONAL', 'OTHER', 'UNKNOWN'] as const satisfies readonly Schema['GeoSourceCategory'][]).optional(),
  verdict: z.enum(['ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  claim_kind: z.enum(['IDENTITY', 'PARAMETER', 'PACKAGE', 'TEMPERATURE_GRADE', 'CERTIFICATION', 'LIFECYCLE_STATUS', 'APPLICATION', 'REPLACEMENT_RELATION', 'COMPATIBILITY_CONDITION', 'OTHER'] as const satisfies readonly Schema['GeoClaimKind'][]).optional(),
  exclusion_reason: z.enum(['RUN_NOT_COMPLETED', 'ANSWER_MISSING_OR_EMPTY', 'CURRENT_ANALYSIS_UNAVAILABLE', 'CURRENT_REVIEW_REQUIRED', 'INTEGRITY_ERROR', 'ADMINISTRATOR_EXCLUDED', 'SUPERSEDED_ATTEMPT', 'DIMENSION_MISMATCH', 'SUBJECT_NOT_APPLICABLE', 'MENTION_MODE_NOT_APPLICABLE', 'INTENT_NOT_APPLICABLE', 'RELIABLE_ORDER_UNAVAILABLE', 'TARGET_RANK_UNAVAILABLE', 'CITATION_OBSERVATION_UNAVAILABLE', 'CITATION_CLASSIFICATION_INCOMPLETE', 'ASSESSABLE_CLAIM_UNAVAILABLE', 'INSUFFICIENT_REPEATS']).optional(),
  version_key: z.string().min(1).max(256).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  page: z.coerce.number().int().min(1).optional(), page_size: z.union([z.literal(10), z.literal(50)]).optional(),
});
export type InsightSearch = BaseSearch & z.output<typeof detailShape>;

export function normalizeSearch(raw: Record<string, unknown>): InsightSearch {
  const base = normalizeBase(raw);
  const parsed = Object.fromEntries(Object.entries(detailShape.shape).flatMap(([key, schema]) => {
    const result = schema.safeParse(raw[key]);
    return result.success && result.data !== undefined ? [[key, result.data]] : [];
  }));
  const d = detailShape.parse(parsed);
  const pagination = { page: d.page === 1 ? undefined : d.page, page_size: d.page_size };
  if (d.detail === 'overview' && d.metric_code && z.enum(overviewMetrics).safeParse(d.metric_code).success) {
    return cleanRecord({ ...base, ...pagination, detail: d.detail, metric_code: d.metric_code, cell_key: d.cell_key, batch_id: d.batch_id, cohort: d.cohort });
  }
  if (d.detail === 'metric' && d.cell_key && d.metric_code && z.enum(answerMetrics).safeParse(d.metric_code).success) {
    return cleanRecord({ ...base, ...pagination, detail: d.detail, cell_key: d.cell_key, metric_code: d.metric_code, cohort: d.cohort, period: d.period });
  }
  if (d.detail === 'citations' && d.cell_key) return cleanRecord({ ...base, ...pagination, detail: d.detail, cell_key: d.cell_key, hostname: d.hostname, normalized_url: d.normalized_url, source_category: d.source_category });
  if (d.detail === 'claims' && d.cell_key) return cleanRecord({ ...base, ...pagination, detail: d.detail, cell_key: d.cell_key, verdict: d.verdict, severity: d.severity, claim_kind: d.claim_kind });
  if (d.detail === 'quality' && d.quality_code) return cleanRecord({ ...base, ...pagination, detail: d.detail, quality_code: d.quality_code, cohort: d.cohort,
    exclusion_reason: d.quality_code === 'eligible_runs' && d.cohort === 'EXCLUDED' ? d.exclusion_reason : undefined,
    version_key: d.quality_code === 'collection_version' || d.quality_code === 'analysis_version' ? d.version_key : undefined,
    currency: d.quality_code === 'cost_coverage' ? d.currency : undefined });
  return base;
}
export const insightSearchSchema = z.record(z.string(), z.unknown()).transform(normalizeSearch);
export function isCanonicalInsightSearch(raw: Record<string, unknown>, canonical: InsightSearch) {
  const keys = Object.keys(raw).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(canonical).sort()) && keys.every((key) => JSON.stringify(raw[key]) === JSON.stringify(canonical[key as keyof InsightSearch]));
}

// 选择器来自服务端回钻描述符；新筛选只保留 base，从而清除旧 cell 和页码。
export function openDrilldown(descriptor: Drilldown): InsightSearch {
  const base = baseFromFilters(descriptor.filters);
  switch (descriptor.operation_id) {
    case 'listGeoOverviewRuns': return normalizeSearch({ ...base, detail: 'overview', metric_code: descriptor.metric_code, cell_key: descriptor.cell_key ?? undefined, batch_id: descriptor.batch_id ?? undefined, cohort: descriptor.cohort });
    case 'listGeoAnswerInsightRuns': return normalizeSearch({ ...base, detail: 'metric', metric_code: descriptor.metric_code, cell_key: descriptor.cell_key, period: descriptor.period, cohort: descriptor.cohort });
    case 'listGeoInsightCitations': return normalizeSearch({ ...base, detail: 'citations', cell_key: descriptor.cell_key, hostname: descriptor.hostname ?? undefined, normalized_url: descriptor.normalized_url ?? undefined, source_category: descriptor.source_category ?? undefined });
    case 'listGeoInsightClaims': return normalizeSearch({ ...base, detail: 'claims', cell_key: descriptor.cell_key, verdict: descriptor.verdict ?? undefined, severity: descriptor.severity ?? undefined, claim_kind: descriptor.claim_kind ?? undefined });
    case 'listGeoInsightQualityRuns': return normalizeSearch({ ...base, detail: 'quality', quality_code: descriptor.quality_code, cohort: descriptor.cohort, exclusion_reason: descriptor.exclusion_reason ?? undefined, version_key: descriptor.version_key ?? undefined, currency: descriptor.currency ?? undefined });
  }
}

export function sampleParams(search: InsightSearch) {
  return { page: search.page ?? 1, page_size: search.page_size ?? 20 } as const;
}
export function overviewSelector(search: InsightSearch): Omit<OverviewParams, keyof BaseSearch> {
  return cleanRecord({ ...sampleParams(search), metric_code: z.enum(overviewMetrics).parse(search.metric_code), cell_key: search.cell_key, batch_id: search.batch_id, cohort: search.cohort ?? 'DENOMINATOR' });
}
export function metricSelector(search: InsightSearch): Omit<MetricParams, keyof BaseSearch> {
  return { ...sampleParams(search), metric_code: z.enum(answerMetrics).parse(search.metric_code), cell_key: z.string().min(1).parse(search.cell_key), cohort: search.cohort ?? 'DENOMINATOR', period: search.period ?? 'CURRENT' };
}
