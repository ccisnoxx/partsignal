import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { opportunitySearchToParams, sourceSearchToParams, type OpportunityParams, type OpportunitySearch, type SourceParams } from './opportunities.model';

export class OpportunityRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: components['schemas']['ErrorDetail']) { super(message); this.name = 'OpportunityRequestError'; }
}
export const opportunityKeys = {
  root: () => ['geo', 'opportunities'] as const,
  lists: () => ['geo', 'opportunities', 'list'] as const,
  list: (params: OpportunityParams) => ['geo', 'opportunities', 'list', params] as const,
  details: (id: string) => ['geo', 'opportunities', 'detail', id] as const,
  detail: (id: string, params: SourceParams) => ['geo', 'opportunities', 'detail', id, params] as const,
  comparisons: (id: string) => ['geo', 'opportunities', 'comparison', id] as const,
  comparison: (id: string, batchId?: string) => ['geo', 'opportunities', 'comparison', id, batchId ?? null] as const,
};
const readDefaults = { retry: false, retryOnMount: false, staleTime: 10_000 } as const;
export function opportunityListOptions(search: OpportunitySearch) {
  const params = opportunitySearchToParams(search);
  return queryOptions({ ...readDefaults, queryKey: opportunityKeys.list(params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/opportunities', { params: { query: params }, signal, cache: 'no-store' });
    if (!result.data) throw requestError('读取机会列表', result);
    return result.data as components['schemas']['GeoOpportunityListPage'];
  } });
}
export function opportunityComparisonOptions(search: OpportunitySearch) {
  const id = search.opportunity_id ?? ''; const batchId = search.retest_batch_id;
  return queryOptions({ ...readDefaults, gcTime: 0, enabled: Boolean(id), queryKey: opportunityKeys.comparison(id, batchId), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}/comparison', { params: { path: { opportunity_id: id }, query: { retest_batch_id: batchId } }, signal, cache: 'no-store' });
    if (!result.data) throw requestError('读取干预前后比较', result);
    if (result.data.opportunity_id !== id || result.data.opportunity.id !== id || result.data.opportunity_revision !== result.data.opportunity.revision || (batchId && result.data.selected_retest_batch_id !== batchId) || (result.data.comparison && result.data.comparison.retest_batch_id !== result.data.selected_retest_batch_id)) throw new OpportunityRequestError('比较快照身份或修订号与请求不一致');
    return result.data as components['schemas']['GeoOpportunityComparisonRead'];
  } });
}
export function opportunityDetailOptions(search: OpportunitySearch) {
  const id = search.opportunity_id ?? ''; const params = sourceSearchToParams(search);
  return queryOptions({ ...readDefaults, gcTime: 0, enabled: Boolean(id), queryKey: opportunityKeys.detail(id, params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}', { params: { path: { opportunity_id: id }, query: params }, signal, cache: 'no-store' });
    if (!result.data) throw requestError('读取机会证据', result);
    if (result.data.opportunity.id !== id) throw new OpportunityRequestError('机会详情身份与请求不一致');
    return result.data as components['schemas']['GeoOpportunityDetail'];
  } });
}
export function headers(csrfToken: string | null) {
  if (!csrfToken) throw new OpportunityRequestError('缺少会话安全令牌，无法执行操作');
  return { 'X-CSRF-Token': csrfToken };
}
export async function acknowledgeOpportunity(id: string, expectedRevision: number, csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/acknowledge', { params: { path: { opportunity_id: id }, header: headers(csrfToken) }, body: { expected_revision: expectedRevision }, signal, cache: 'no-store' });
  if (!result.data) throw requestError('确认机会', result);
  if (result.data.id !== id || result.data.revision !== expectedRevision + 1) throw new OpportunityRequestError('确认回执身份或修订号不一致，请读取机会核对结果');
  return result.data;
}
export async function dismissOpportunity(id: string, body: components['schemas']['GeoOpportunityDismissRequest'], csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/dismiss', { params: { path: { opportunity_id: id }, header: headers(csrfToken) }, body, signal, cache: 'no-store' });
  if (!result.data) throw requestError('忽略机会', result);
  if (result.data.id !== id || result.data.revision !== body.expected_revision + 1) throw new OpportunityRequestError('忽略回执身份或修订号不一致，请读取机会核对结果');
  return result.data;
}
export async function resolveOpportunity(id: string, body: components['schemas']['GeoOpportunityResolveRequest'], csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/resolve', { params: { path: { opportunity_id: id }, header: headers(csrfToken) }, body, signal, cache: 'no-store' });
  if (!result.data) throw requestError('解决机会', result);
  return decisionReceipt(id, body.expected_revision, result.data as components['schemas']['GeoOpportunityDecisionResult']);
}
export async function continueOpportunity(id: string, body: components['schemas']['GeoOpportunityContinueRequest'], csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/continue', { params: { path: { opportunity_id: id }, header: headers(csrfToken) }, body, signal, cache: 'no-store' });
  if (!result.data) throw requestError('继续跟进', result);
  return decisionReceipt(id, body.expected_revision, result.data as components['schemas']['GeoOpportunityDecisionResult']);
}
function decisionReceipt(id: string, revision: number, result: components['schemas']['GeoOpportunityDecisionResult']) {
  if (result.opportunity.id !== id || result.opportunity.revision !== revision + 1 || result.decision.opportunity_id !== id || result.decision.revision_before !== revision || result.decision.revision_after !== revision + 1) throw new OpportunityRequestError('处理回执身份或修订号不一致，请重新读取核对结果');
  return result;
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
export function requestError(action: string, result: { error?: unknown; response: Response }) {
  if (record(result.error) && record(result.error.error)) {
    const detail = result.error.error;
    if (typeof detail.code === 'string' && typeof detail.message === 'string' && typeof detail.request_id === 'string' && record(detail.details))
      return new OpportunityRequestError(`${detail.message}（请求 ID：${detail.request_id}）`, result.response.status, detail as components['schemas']['ErrorDetail']);
  }
  return new OpportunityRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
