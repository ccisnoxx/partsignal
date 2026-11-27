import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

export type CampaignAttributionDashboard =
  components['schemas']['CampaignAttributionDashboardOut'];
export type OperationsMetrics = components['schemas']['OperationsMetricsOut'];
export type GeoInterventionListPage = components['schemas']['GeoInterventionListPage'];
export type OperatingCostEntryListPage = components['schemas']['OperatingCostEntryListPage'];
export type OperatingCostEntryOut = components['schemas']['OperatingCostEntryOut'];
export type OperatingCostEntryCreate = components['schemas']['OperatingCostEntryCreate'];
export type AIModelPricingOut = components['schemas']['AIModelPricingOut'];
export type AIModelPricingUpdate = components['schemas']['AIModelPricingUpdate'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

export class OperationsRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OperationsRequestError';
  }
}

export function isRevisionConflictError(error: unknown): boolean {
  return (
    error instanceof OperationsRequestError
    && (error.status === 409 || error.code === 'REVISION_CONFLICT')
  );
}

function requestError(
  label: string,
  result: { error?: ErrorEnvelope; response: Response },
): OperationsRequestError {
  const message = result.error?.error?.message;
  const code = result.error?.error?.code;
  return new OperationsRequestError(
    message || `${label}失败（HTTP ${result.response.status}）`,
    result.response.status,
    code,
  );
}

function requireCsrf(csrfToken: string | null, label: string): string {
  if (!csrfToken) throw new OperationsRequestError(`${label}缺少 CSRF 令牌`);
  return csrfToken;
}

export const operationsDashboardKeys = {
  campaignAttribution: (campaignId: string, windowDays: number) =>
    ['operations', 'campaign-attribution', campaignId, windowDays] as const,
  campaignCostEntries: (campaignId: string, includeVoided: boolean) =>
    ['operations', 'campaign-cost-entries', campaignId, includeVoided] as const,
  workbenchMetrics: (windowDays: number) =>
    ['operations', 'workbench-metrics', windowDays] as const,
  aiModelPricing: (modelId: string) => ['configuration', 'ai-model-pricing', modelId] as const,
};

export function campaignAttributionQueryOptions(campaignId: string, windowDays: number) {
  return queryOptions({
    queryKey: operationsDashboardKeys.campaignAttribution(campaignId, windowDays),
    retry: false,
    queryFn: async (): Promise<CampaignAttributionDashboard> => {
      const result = await api.GET('/api/v1/campaigns/{campaign_id}/attribution-dashboard', {
        params: { path: { campaign_id: campaignId }, query: { window_days: windowDays } },
      });
      if (!result.data) throw requestError('加载活动归因看板', result);
      return result.data;
    },
  });
}

export function campaignCostEntriesQueryOptions(campaignId: string, includeVoided: boolean) {
  return queryOptions({
    queryKey: operationsDashboardKeys.campaignCostEntries(campaignId, includeVoided),
    retry: false,
    queryFn: async (): Promise<OperatingCostEntryListPage> => {
      const result = await api.GET('/api/v1/cost-entries', {
        params: {
          query: {
            campaign_id: campaignId,
            include_voided: includeVoided,
            page: 1,
            page_size: 50,
          },
        },
      });
      if (!result.data) throw requestError('加载运营费用台账', result);
      return result.data;
    },
  });
}

export async function createOperatingCostEntry(
  payload: OperatingCostEntryCreate,
  csrfToken: string | null,
): Promise<OperatingCostEntryOut> {
  const token = requireCsrf(csrfToken, '登记运营费用');
  const result = await api.POST('/api/v1/cost-entries', {
    params: { header: { 'X-CSRF-Token': token } },
    body: payload,
  });
  if (!result.data) throw requestError('登记运营费用', result);
  return result.data;
}

export async function voidOperatingCostEntry(
  entryId: string,
  reason: string,
  csrfToken: string | null,
): Promise<OperatingCostEntryOut> {
  const token = requireCsrf(csrfToken, '作废运营费用');
  const result = await api.POST('/api/v1/cost-entries/{entry_id}/void', {
    params: { path: { entry_id: entryId }, header: { 'X-CSRF-Token': token } },
    body: { reason },
  });
  if (!result.data) throw requestError('作废运营费用', result);
  return result.data;
}

export function workbenchOperationsMetricsQueryOptions(windowDays: number) {
  return queryOptions({
    queryKey: operationsDashboardKeys.workbenchMetrics(windowDays),
    retry: false,
    queryFn: async (): Promise<OperationsMetrics> => {
      const result = await api.GET('/api/v1/workbench/operations-metrics', {
        params: { query: { window_days: windowDays } },
      });
      if (!result.data) throw requestError('加载经营指标与衰退预警', result);
      return result.data;
    },
  });
}

export function aiModelPricingQueryOptions(modelId: string) {
  return queryOptions({
    queryKey: operationsDashboardKeys.aiModelPricing(modelId),
    retry: false,
    queryFn: async (): Promise<AIModelPricingOut> => {
      const result = await api.GET('/api/v1/ai-models/{model_id}/pricing', {
        params: { path: { model_id: modelId } },
      });
      if (!result.data) throw requestError('加载模型定价', result);
      return result.data;
    },
  });
}

export async function updateAIModelPricing(
  modelId: string,
  payload: AIModelPricingUpdate,
  csrfToken: string | null,
): Promise<AIModelPricingOut> {
  const token = requireCsrf(csrfToken, '更新模型定价');
  const result = await api.PATCH('/api/v1/ai-models/{model_id}/pricing', {
    params: { path: { model_id: modelId }, header: { 'X-CSRF-Token': token } },
    body: payload,
  });
  if (!result.data) throw requestError('更新模型定价', result);
  return result.data;
}
