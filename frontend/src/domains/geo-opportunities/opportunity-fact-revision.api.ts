import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { PrincipalContinuation } from '@/app/auth/principal-epoch';
import { productsKeys } from '@/domains/product/product.api';
import { insightKeys } from '@/domains/geo-insights/insights.api';
import { reportKeys } from '@/domains/geo-reports/reports.api';
import { api } from '@/shared/api/client';
import { headers, opportunityKeys, OpportunityRequestError, requestError } from './opportunities.api';
import type { BusinessRequest, FactRevisionCommand } from './opportunity-business.model';

const optionKey = (id: string) => ['geo', 'opportunities', 'fact-revision-options', id] as const;
export function opportunityFactRevisionOptions(id: string, enabled: boolean) {
  return queryOptions({
    queryKey: optionKey(id), enabled, retry: false, retryOnMount: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}/fact-revision-options', {
        params: { path: { opportunity_id: id } }, signal, cache: 'no-store',
      });
      if (!result.data) throw requestError('读取事实修订产品选项', result);
      if (result.data.opportunity_id !== id) throw new OpportunityRequestError('事实修订选项与当前机会不一致');
      return result.data;
    },
  });
}

export async function startOpportunityFactRevision(
  id: string, request: BusinessRequest<FactRevisionCommand>, csrfToken: string | null, signal: AbortSignal,
) {
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/actions/fact-revision', {
    params: { path: { opportunity_id: id }, header: { ...headers(csrfToken), 'Idempotency-Key': request.key } },
    body: request.body, signal, cache: 'no-store',
  });
  if (!result.data) throw requestError('登记事实修订行动', result);
  const action = result.data.action; const source = action.source_snapshot;
  const expectedPath = `/products/${request.body.product_id}/facts?source_opportunity_id=${id}`;
  if (action.action_type !== 'FACT_REVISION' || action.target_type !== 'Product' || action.target_id !== request.body.product_id
    || result.data.opportunity_revision !== request.body.expected_revision + 1
    || !source || source.opportunity_id !== id || source.opportunity_revision !== request.body.expected_revision
    || source.product_id !== request.body.product_id || source.fact_version_id !== null
    || typeof action.target_available !== 'boolean'
    || (action.target_available && action.navigation_path !== expectedPath)
    || (!action.target_available && action.navigation_path !== null)) {
    throw new OpportunityRequestError('事实修订回执与原请求不一致，请保留原请求核对结果');
  }
  return result.data;
}

export async function invalidateFactRevision(client: QueryClient, id: string, productId: string, owner: PrincipalContinuation) {
  const keys = [opportunityKeys.lists(), opportunityKeys.details(id), opportunityKeys.comparisons(id), optionKey(id),
    productsKeys.fact(productId), productsKeys.detail(productId), [...insightKeys.root, 'overview'], reportKeys.root];
  // 先取消旧读取，再失效；无缓存的在途列表也不能迟到回填旧行动阶段。
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
