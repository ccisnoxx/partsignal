import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { contentKeys } from '@/domains/content/content.api';
import { runKeys } from '@/domains/geo-runs/runs.api';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { headers, opportunityKeys, OpportunityRequestError, requestError } from './opportunities.api';
import type { BusinessRequest, ContentCommand, RetestCommand } from './opportunity-business.model';

export function opportunityContentOptions(productId?: string, enabled = true) {
  return queryOptions({ queryKey: contentKeys.creationOptions(productId), enabled, retry: false, retryOnMount: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/content-tasks/creation-options', { params: { query: { requested_product_id: productId } }, signal, cache: 'no-store' });
      if (!result.data) throw requestError('读取 Content Task 创建选项', result);
      if (productId && result.data.requested_product?.product_id !== productId) throw new OpportunityRequestError('创建选项的产品身份与请求不一致');
      return result.data;
    },
  });
}
export function opportunityRetestPreviewOptions(id: string, baselineId?: string, enabled = true) {
  return queryOptions({ queryKey: ['geo', 'opportunities', 'retest-preview', id, baselineId ?? null] as const, enabled: enabled && Boolean(baselineId), retry: false, retryOnMount: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!baselineId) throw new OpportunityRequestError('复测预览缺少明确基线');
      const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}/retest-preview', { params: { path: { opportunity_id: id }, query: { baseline_batch_id: baselineId } }, signal, cache: 'no-store' });
      if (!result.data) throw requestError('读取 Retest 预览', result);
      if (result.data.opportunity_id !== id || result.data.baseline_batch_id !== baselineId || result.data.snapshot.opportunity_id !== id || result.data.snapshot.baseline_batch_id !== baselineId) throw new OpportunityRequestError('复测预览身份与请求不一致');
      return result.data as components['schemas']['GeoRetestPreview'];
    },
  });
}
export async function createOpportunityContentTask(id: string, request: BusinessRequest<ContentCommand>, csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/actions/content-task', { params: { path: { opportunity_id: id }, header: { ...headers(csrfToken), 'Idempotency-Key': request.key } }, body: request.body, signal, cache: 'no-store' });
  if (!result.data) throw requestError('从机会创建 Content Task', result);
  const source = result.data.action.source_snapshot;
  if (result.data.action.action_type !== 'CONTENT_TASK' || result.data.opportunity_revision !== request.body.expected_revision + 1 || !source || source.opportunity_id !== id || source.opportunity_revision !== request.body.expected_revision || source.product_id !== request.body.product_id || source.fact_version_id !== request.body.fact_version_id || source.platform_profile_id !== request.body.platform_profile_id) throw new OpportunityRequestError('Content Task 回执与原请求不一致，请使用原请求核对结果');
  return result.data;
}
export async function createOpportunityRetest(id: string, request: BusinessRequest<RetestCommand>, csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/retest', { params: { path: { opportunity_id: id }, header: { ...headers(csrfToken), 'Idempotency-Key': request.key } }, body: request.body, signal, cache: 'no-store' });
  if (!result.data) throw requestError('从机会创建 Retest', result);
  if (result.data.opportunity_revision !== request.body.expected_revision + 1) throw new OpportunityRequestError('Retest 回执修订号与原请求不一致，请使用原请求核对结果');
  return result.data;
}
export async function invalidateOpportunityBusiness(client: QueryClient, id: string, kind: 'content' | 'retest') {
  await Promise.all([
    client.invalidateQueries({ queryKey: opportunityKeys.lists() }),
    client.invalidateQueries({ queryKey: opportunityKeys.details(id) }),
    client.invalidateQueries({ queryKey: opportunityKeys.comparisons(id) }),
    kind === 'content' ? client.invalidateQueries({ queryKey: contentKeys.lists() }) : client.invalidateQueries({ queryKey: runKeys.batches() }),
  ]);
}
