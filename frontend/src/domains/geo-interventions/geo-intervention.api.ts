import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type {
  GeoInterventionCancelRequest,
  GeoInterventionConcludeRequest,
  GeoInterventionCreate,
  GeoInterventionListPage,
  GeoInterventionOut,
  GeoInterventionUpdate,
} from './geo-intervention.model';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type GeoOpportunityListPage = components['schemas']['GeoOpportunityListPage'];
type GeoOpportunityComparisonRead = components['schemas']['GeoOpportunityComparisonRead'];
type ContentCampaignListPage = components['schemas']['ContentCampaignListPage'];
type WorkAssigneeOptionList = components['schemas']['WorkAssigneeOptionList'];

export class GeoInterventionRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'GeoInterventionRequestError';
  }
}

export function isGeoInterventionStaleConflict(error: unknown): boolean {
  if (!(error instanceof GeoInterventionRequestError)) return false;
  if (error.status !== 409) return false;
  return (
    error.code === 'REVISION_CONFLICT'
    || error.code === 'INVALID_STATE_TRANSITION'
    || error.code === undefined
  );
}

function requestError(
  label: string,
  result: { error?: ErrorEnvelope; response: Response },
): GeoInterventionRequestError {
  const detail = result.error?.error;
  const message = detail?.message
    ? (detail.request_id ? `${detail.message}（请求 ID：${detail.request_id}）` : detail.message)
    : `${label}失败（HTTP ${result.response.status}）`;
  return new GeoInterventionRequestError(
    message,
    result.response.status,
    detail?.code,
    detail?.request_id,
  );
}

function requireCsrf(csrfToken: string | null, label: string): string {
  if (!csrfToken) {
    throw new GeoInterventionRequestError(`${label}缺少会话 CSRF 令牌，请刷新页面后重试`);
  }
  return csrfToken;
}

export const geoInterventionKeys = {
  all: () => ['geo', 'interventions'] as const,
  lists: () => ['geo', 'interventions', 'list'] as const,
  byCampaign: (campaignId: string) =>
    ['geo', 'interventions', 'list', 'campaign', campaignId] as const,
  byOpportunity: (opportunityId: string) =>
    ['geo', 'interventions', 'list', 'opportunity', opportunityId] as const,
  detail: (interventionId: string) =>
    ['geo', 'interventions', 'detail', interventionId] as const,
  opportunityChoices: () => ['geo', 'interventions', 'choices', 'opportunities'] as const,
  campaignChoices: () => ['geo', 'interventions', 'choices', 'campaigns'] as const,
  assigneeChoices: () => ['geo', 'interventions', 'choices', 'assignees'] as const,
  evidenceChoices: (opportunityId: string) =>
    ['geo', 'interventions', 'choices', 'evidence', opportunityId] as const,
};

export function geoInterventionsListQueryOptions(
  scope:
    | { kind: 'campaign'; campaignId: string }
    | { kind: 'opportunity'; opportunityId: string },
) {
  const scopeId = scope.kind === 'campaign' ? scope.campaignId : scope.opportunityId;
  const queryKey: readonly ['geo', 'interventions', 'list', 'campaign' | 'opportunity', string] = [
    'geo',
    'interventions',
    'list',
    scope.kind,
    scopeId,
  ];
  return queryOptions({
    queryKey,
    retry: false,
    queryFn: async ({ signal }): Promise<GeoInterventionListPage> => {
      const result = await api.GET('/api/v1/geo/interventions', {
        params: {
          query: scope.kind === 'campaign'
            ? { campaign_id: scope.campaignId, page: 1, page_size: 20 }
            : { opportunity_id: scope.opportunityId, page: 1, page_size: 20 },
        },
        signal,
      });
      if (!result.data) {
        throw requestError(
          scope.kind === 'campaign' ? '加载关联 GEO 干预' : '加载机会 GEO 干预记录',
          result,
        );
      }
      return result.data;
    },
  });
}

export async function fetchGeoInterventionDetail(
  interventionId: string,
): Promise<GeoInterventionOut> {
  const result = await api.GET('/api/v1/geo/interventions/{intervention_id}', {
    params: { path: { intervention_id: interventionId } },
  });
  if (!result.data) throw requestError('读取最新 GEO 干预记录', result);
  return result.data;
}

export function geoInterventionOpportunityChoicesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: geoInterventionKeys.opportunityChoices(),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<GeoOpportunityListPage> => {
      const result = await api.GET('/api/v1/geo/opportunities', {
        params: { query: { page: 1, page_size: 50, sort: 'PRIORITY_DESC' } },
        signal,
      });
      if (!result.data) throw requestError('加载可选 GEO 机会', result);
      return result.data;
    },
  });
}

export function geoInterventionCampaignChoicesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: geoInterventionKeys.campaignChoices(),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<ContentCampaignListPage> => {
      const result = await api.GET('/api/v1/content-campaigns', {
        params: { query: { page: 1, page_size: 50 } },
        signal,
      });
      if (!result.data) throw requestError('加载可选内容活动', result);
      return result.data;
    },
  });
}

export function geoInterventionAssigneeChoicesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: geoInterventionKeys.assigneeChoices(),
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<WorkAssigneeOptionList> => {
      const result = await api.GET('/api/v1/workbench/assignees', { signal });
      if (!result.data) throw requestError('加载可选负责人', result);
      return result.data;
    },
  });
}

export function geoInterventionEvidenceChoicesQueryOptions(
  opportunityId: string,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: geoInterventionKeys.evidenceChoices(opportunityId),
    enabled: enabled && Boolean(opportunityId),
    retry: false,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<GeoOpportunityComparisonRead> => {
      const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}/comparison', {
        params: { path: { opportunity_id: opportunityId } },
        signal,
      });
      if (!result.data) throw requestError('加载复测基线与处理结论', result);
      return result.data as GeoOpportunityComparisonRead;
    },
  });
}

export async function createGeoIntervention(
  payload: GeoInterventionCreate,
  csrfToken: string | null,
): Promise<GeoInterventionOut> {
  const token = requireCsrf(csrfToken, '创建 GEO 干预');
  const result = await api.POST('/api/v1/geo/interventions', {
    params: { header: { 'X-CSRF-Token': token } },
    body: payload,
  });
  if (!result.data) throw requestError('创建 GEO 干预', result);
  return result.data;
}

export async function updateGeoIntervention(
  interventionId: string,
  payload: GeoInterventionUpdate,
  csrfToken: string | null,
): Promise<GeoInterventionOut> {
  const token = requireCsrf(csrfToken, '更新 GEO 干预');
  const result = await api.PATCH('/api/v1/geo/interventions/{intervention_id}', {
    params: {
      path: { intervention_id: interventionId },
      header: { 'X-CSRF-Token': token },
    },
    body: payload,
  });
  if (!result.data) throw requestError('更新 GEO 干预', result);
  return result.data;
}

export async function concludeGeoIntervention(
  interventionId: string,
  payload: GeoInterventionConcludeRequest,
  csrfToken: string | null,
): Promise<GeoInterventionOut> {
  const token = requireCsrf(csrfToken, '结案 GEO 干预');
  const result = await api.POST('/api/v1/geo/interventions/{intervention_id}/conclude', {
    params: {
      path: { intervention_id: interventionId },
      header: { 'X-CSRF-Token': token },
    },
    body: payload,
  });
  if (!result.data) throw requestError('结案 GEO 干预', result);
  return result.data;
}

export async function cancelGeoIntervention(
  interventionId: string,
  payload: GeoInterventionCancelRequest,
  csrfToken: string | null,
): Promise<GeoInterventionOut> {
  const token = requireCsrf(csrfToken, '取消 GEO 干预');
  const result = await api.POST('/api/v1/geo/interventions/{intervention_id}/cancel', {
    params: {
      path: { intervention_id: interventionId },
      header: { 'X-CSRF-Token': token },
    },
    body: payload,
  });
  if (!result.data) throw requestError('取消 GEO 干预', result);
  return result.data;
}

export async function invalidateGeoInterventionQueries(
  queryClient: QueryClient,
  context: {
    campaignIds?: Array<string | null | undefined>;
    opportunityId?: string | null;
    interventionId?: string | null;
  },
): Promise<void> {
  const tasks: Array<Promise<void>> = [
    queryClient.invalidateQueries({ queryKey: geoInterventionKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: ['operations', 'workbench-metrics'] }),
  ];
  if (context.interventionId) {
    tasks.push(
      queryClient.invalidateQueries({
        queryKey: geoInterventionKeys.detail(context.interventionId),
      }),
    );
  }
  const uniqueCampaignIds = new Set(
    (context.campaignIds ?? []).filter((id): id is string => Boolean(id)),
  );
  if (uniqueCampaignIds.size > 0) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['content', 'campaigns', 'list'] }),
    );
  }
  for (const cid of uniqueCampaignIds) {
    tasks.push(
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-attribution', cid],
      }),
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-cost-entries', cid],
      }),
      queryClient.invalidateQueries({
        queryKey: ['content', 'campaigns', 'detail', cid],
      }),
    );
  }
  await Promise.all(tasks);
}
