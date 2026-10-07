import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { baseParams, type BaseSearch } from './insights.model';
import { metricSelector, overviewSelector, sampleParams, type CitationParams, type ClaimParams, type InsightSearch, type QualityParams } from './drilldown.model';

export class InsightRequestError extends Error {
  constructor(readonly status: number | undefined, readonly detail?: components['schemas']['ErrorDetail']) {
    super('读取 GEO 洞察失败'); this.name = 'InsightRequestError';
  }
}
function resultError(result: { response: Response; error?: components['schemas']['ErrorEnvelope'] }) {
  return new InsightRequestError(result.response.status, result.error?.error);
}
const defaults = { retry: false, retryOnMount: false, staleTime: 30_000, refetchOnWindowFocus: 'always' } as const;
export const insightKeys = { root: ['geo', 'answer-insights'] as const };
export function overviewOptions(search: BaseSearch) {
  const params = baseParams(search);
  return queryOptions({ ...defaults, queryKey: [...insightKeys.root, 'overview', params], queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/overview', { params: { query: params }, signal, cache: 'no-store' });
    if (!result.data) throw resultError(result);
    return result.data as components['schemas']['GeoOverview'];
  } });
}
export function answerInsightOptions(search: BaseSearch) {
  const params = baseParams(search);
  return queryOptions({ ...defaults, queryKey: [...insightKeys.root, 'answers', params], queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/insights', { params: { query: params }, signal, cache: 'no-store' });
    if (!result.data) throw resultError(result);
    return result.data as components['schemas']['GeoAnswerInsights'];
  } });
}

// 每个明细 query 的判别标签与数据同时返回，避免由当前 UI 选择解读迟到响应。
export function insightDetailOptions(search: InsightSearch) {
  const params = baseParams(search);
  const pagination = sampleParams(search);
  const query = (() => {
    switch (search.detail) {
      case 'overview': return { ...params, ...overviewSelector(search) };
      case 'metric': return { ...params, ...metricSelector(search) };
      case 'citations': return { ...params, ...pagination, cell_key: search.cell_key!, hostname: search.hostname, normalized_url: search.normalized_url, source_category: search.source_category } satisfies CitationParams;
      case 'claims': return { ...params, ...pagination, cell_key: search.cell_key!, verdict: search.verdict, severity: search.severity, claim_kind: search.claim_kind } satisfies ClaimParams;
      case 'quality': return { ...params, ...pagination, quality_code: search.quality_code!, cohort: search.cohort ?? 'DENOMINATOR', exclusion_reason: search.exclusion_reason, version_key: search.version_key, currency: search.currency } satisfies QualityParams;
      default: return params;
    }
  })();
  return queryOptions({ ...defaults, gcTime: 0, enabled: !!search.detail,
    queryKey: [...insightKeys.root, 'detail', search.detail, query],
    queryFn: async ({ signal }) => {
      const options = { signal, cache: 'no-store' as const };
      switch (search.detail) {
        case 'overview': {
          const result = await api.GET('/api/v1/geo/overview/runs', { ...options, params: { query: { ...params, ...overviewSelector(search) } } });
          if (!result.data) throw resultError(result);
          return { kind: 'overview' as const, page: result.data };
        }
        case 'metric': {
          const result = await api.GET('/api/v1/geo/insights/runs', { ...options, params: { query: { ...params, ...metricSelector(search) } } });
          if (!result.data) throw resultError(result);
          return { kind: 'metric' as const, page: result.data };
        }
        case 'citations': {
          const result = await api.GET('/api/v1/geo/insights/citations', { ...options, params: { query: query as CitationParams } });
          if (!result.data) throw resultError(result);
          return { kind: 'citations' as const, page: result.data };
        }
        case 'claims': {
          const result = await api.GET('/api/v1/geo/insights/claims', { ...options, params: { query: query as ClaimParams } });
          if (!result.data) throw resultError(result);
          return { kind: 'claims' as const, page: result.data };
        }
        case 'quality': {
          const result = await api.GET('/api/v1/geo/insights/quality/runs', { ...options, params: { query: query as QualityParams } });
          if (!result.data) throw resultError(result);
          return { kind: 'quality' as const, page: result.data };
        }
        default: throw new Error('未选择洞察明细');
      }
    },
  });
}
export type InsightDetail =
  | { kind: 'overview'; page: components['schemas']['GeoOverviewRunPage'] }
  | { kind: 'metric'; page: components['schemas']['GeoAnswerInsightRunPage'] }
  | { kind: 'citations'; page: components['schemas']['GeoInsightCitationPage'] }
  | { kind: 'claims'; page: components['schemas']['GeoInsightClaimPage'] }
  | { kind: 'quality'; page: components['schemas']['GeoInsightQualityPage'] };
