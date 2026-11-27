import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  campaignsSearchToApiParams,
  type CampaignsSearch,
  type ContentCampaignCreate,
  type ContentCampaignDetail,
  type ContentCampaignListApiParams,
  type ContentCampaignOptions,
  type ContentCampaignUpdate,
} from './campaign.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

class CampaignRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'CampaignRequestError';
  }
}

const campaignKeys = {
  all: () => ['content', 'campaigns'] as const,
  lists: () => ['content', 'campaigns', 'list'] as const,
  list: (params: ContentCampaignListApiParams) => ['content', 'campaigns', 'list', params] as const,
  details: () => ['content', 'campaigns', 'detail'] as const,
  detail: (campaignId: string) => ['content', 'campaigns', 'detail', campaignId] as const,
  options: () => ['content', 'campaigns', 'options'] as const,
};

function requireCsrf(csrfToken: string | null, label: string) {
  if (!csrfToken) throw new CampaignRequestError(`${label}缺少 CSRF 令牌`);
  return csrfToken;
}

function campaignRequestError(
  label: string,
  result: { error?: ErrorEnvelope; response: Response },
) {
  const detail = result.error?.error;
  return new CampaignRequestError(
    detail?.message ?? `${label}失败（HTTP ${result.response.status}）`,
    result.response.status,
    detail,
  );
}

function campaignListQueryOptions(search: CampaignsSearch) {
  const params = campaignsSearchToApiParams(search);
  return queryOptions({
    queryKey: campaignKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/content-campaigns', { params: { query: params } });
      if (!result.data) throw campaignRequestError('读取内容活动列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    staleTime: 30_000,
  });
}

function campaignDetailQueryOptions(campaignId: string) {
  return queryOptions({
    queryKey: campaignKeys.detail(campaignId),
    queryFn: async (): Promise<ContentCampaignDetail> => {
      const result = await api.GET('/api/v1/content-campaigns/{campaign_id}', {
        params: { path: { campaign_id: campaignId } },
      });
      if (!result.data) throw campaignRequestError('读取内容活动详情', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    staleTime: 10_000,
  });
}

function campaignOptionsQueryOptions() {
  return queryOptions({
    queryKey: campaignKeys.options(),
    queryFn: async (): Promise<ContentCampaignOptions> => {
      const result = await api.GET('/api/v1/content-campaigns/options');
      if (!result.data) throw campaignRequestError('读取内容活动配置选项', result);
      return result.data;
    },
    retry: false,
    staleTime: 30_000,
  });
}

async function createContentCampaign(
  body: ContentCampaignCreate,
  csrfToken: string | null,
): Promise<ContentCampaignDetail> {
  const result = await api.POST('/api/v1/content-campaigns', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrf(csrfToken, '创建内容活动') } },
  });
  if (result.data) return result.data;
  throw campaignRequestError('创建内容活动', result);
}

async function updateContentCampaign(
  campaignId: string,
  body: ContentCampaignUpdate,
  csrfToken: string | null,
): Promise<ContentCampaignDetail> {
  const result = await api.PATCH('/api/v1/content-campaigns/{campaign_id}', {
    body,
    params: {
      path: { campaign_id: campaignId },
      header: { 'X-CSRF-Token': requireCsrf(csrfToken, '更新内容活动') },
    },
  });
  if (result.data) return result.data;
  throw campaignRequestError('更新内容活动', result);
}

type CampaignTransition = 'activate' | 'pause' | 'resume' | 'complete' | 'archive';

async function transitionContentCampaign(
  campaignId: string,
  operation: CampaignTransition,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<ContentCampaignDetail> {
  const header = { 'X-CSRF-Token': requireCsrf(csrfToken, '变更活动状态') };
  const body = { expected_revision: expectedRevision };
  const path = { campaign_id: campaignId };
  const result = await (
    operation === 'activate'
      ? api.POST('/api/v1/content-campaigns/{campaign_id}/activate', { body, params: { path, header } })
      : operation === 'pause'
        ? api.POST('/api/v1/content-campaigns/{campaign_id}/pause', { body, params: { path, header } })
        : operation === 'resume'
          ? api.POST('/api/v1/content-campaigns/{campaign_id}/resume', { body, params: { path, header } })
          : operation === 'complete'
            ? api.POST('/api/v1/content-campaigns/{campaign_id}/complete', { body, params: { path, header } })
            : api.POST('/api/v1/content-campaigns/{campaign_id}/archive', { body, params: { path, header } })
  );
  if (result.data) return result.data;
  throw campaignRequestError('变更活动状态', result);
}

async function deleteContentCampaign(
  campaignId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<void> {
  const result = await api.DELETE('/api/v1/content-campaigns/{campaign_id}', {
    params: {
      path: { campaign_id: campaignId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrf(csrfToken, '删除内容活动') },
    },
  });
  if (result.response.ok) return;
  throw campaignRequestError('删除内容活动', result);
}

export {
  CampaignRequestError,
  campaignDetailQueryOptions,
  campaignKeys,
  campaignListQueryOptions,
  campaignOptionsQueryOptions,
  createContentCampaign,
  deleteContentCampaign,
  transitionContentCampaign,
  updateContentCampaign,
};
export type { CampaignTransition };
