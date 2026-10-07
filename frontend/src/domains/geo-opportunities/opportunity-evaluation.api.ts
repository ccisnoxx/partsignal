import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { headers, OpportunityRequestError, requestError } from './opportunities.api';

export async function evaluateOpportunities(body: components['schemas']['GeoOpportunityEvaluationRequest'], key: string, csrfToken: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/opportunities/evaluate', { body, signal, cache: 'no-store', params: { header: { ...headers(csrfToken), 'Idempotency-Key': key } } });
  if (!result.data) throw requestError('评估机会', result);
  if (result.data.rule_set_revision !== body.rule_set_revision || result.data.created + result.data.existing_reused + result.data.skipped !== result.data.evaluated_cells) throw new OpportunityRequestError('评估回执与提交合同不一致，请使用原请求核对结果');
  return result.data;
}
export type EvaluationOptionKind = 'subject_ids' | 'engine_surface_ids' | 'collection_profile_ids';
export function evaluationOptions(kind: EvaluationOptionKind, q: string, page: number) {
  return queryOptions({ queryKey: ['geo', 'opportunity-evaluation', 'options', kind, q, page], retry: false, staleTime: 30000,
    queryFn: async ({ signal }) => {
      const query = { q: q || undefined, page, page_size: 10 as const, sort: 'NAME_ASC' as const };
      if (kind === 'subject_ids') {
        const result = await api.GET('/api/v1/geo/subjects', { params: { query }, signal });
        if (!result.data) throw requestError('读取评估对象', result);
        return { total: result.data.total, items: result.data.items.map((item) => ({ id: item.id, label: item.display_name, description: `${item.subject_type} · 产品 ${item.subject_type === 'OWN_PRODUCT' ? item.product_id : '未关联'} · ${item.id}` })) };
      }
      if (kind === 'engine_surface_ids') {
        const result = await api.GET('/api/v1/geo/engine-surfaces', { params: { query }, signal });
        if (!result.data) throw requestError('读取评估观测面', result);
        return { total: result.data.total, items: result.data.items.map(({ summary }) => ({ id: summary.id, label: summary.name, description: summary.id })) };
      }
      const result = await api.GET('/api/v1/geo/collection-profiles', { params: { query }, signal });
      if (!result.data) throw requestError('读取评估采集配置', result);
      return { total: result.data.total, items: result.data.items.map(({ summary }) => ({ id: summary.id, label: summary.name, description: `${summary.collection_mode} · ${summary.engine_surface.name} · ${summary.id}` })) };
    },
  });
}
