import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  geoObservationSearchToApiParams,
  type GeoObservationListApiParams,
  type GeoObservationSearch,
} from './geo-observation-list.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type GeoObservationCreate = components['schemas']['GeoObservationCreate'];
type UploadIntentCreate = components['schemas']['UploadIntentCreate'];

class GeoRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'GeoRequestError';
  }
}

const geoKeys = {
  lists: () => ['geo', 'observations', 'list'] as const,
  list: (params: GeoObservationListApiParams) => (
    ['geo', 'observations', 'list', params] as const
  ),
  topics: () => ['geo', 'query-topics'] as const,
  publicationCandidates: (productId: string) => (
    ['geo', 'observation-publications', productId] as const
  ),
};

function geoObservationListQueryOptions(search: GeoObservationSearch) {
  const params = geoObservationSearchToApiParams(search);
  return queryOptions({
    queryKey: geoKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/geo-observations/list-items', {
        params: { query: params },
      });
      if (!result.data) throw geoRequestError('读取 GEO 观测列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function queryTopicsQueryOptions() {
  return queryOptions({
    queryKey: geoKeys.topics(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/query-topics');
      if (!result.data) throw geoRequestError('读取 GEO 问题主题', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function geoPublicationCandidatesQueryOptions(productId: string) {
  return queryOptions({
    queryKey: geoKeys.publicationCandidates(productId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/geo-observation-publications', {
        params: { query: { product_id: productId } },
      });
      if (!result.data) throw geoRequestError('读取产品 Published Article 候选', result);
      return result.data;
    },
    enabled: productId.length > 0,
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 0,
  });
}

async function createGeoObservation(body: GeoObservationCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo-observations', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '创建 GEO 观测') } },
  });
  if (result.data) return result.data;
  throw geoRequestError('创建 GEO 观测', result);
}

async function createGeoFileUploadIntent(
  body: UploadIntentCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/files/upload-intents', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '上传 GEO 证据') } },
  });
  if (result.data) return result.data;
  throw geoRequestError('创建 GEO 证据上传意图', result);
}

async function completeGeoFileUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/complete', {
    params: {
      path: { file_id: fileId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '确认 GEO 证据上传') },
    },
  });
  if (result.data) return result.data;
  throw geoRequestError('确认 GEO 证据上传', result);
}

async function abortGeoFileUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/abort', {
    params: {
      path: { file_id: fileId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '中止 GEO 证据上传') },
    },
  });
  if (result.data) return result.data;
  throw geoRequestError('中止 GEO 证据上传', result);
}

async function deleteGeoObservation(observationId: string, csrfToken: string | null) {
  if (!csrfToken) throw new GeoRequestError('缺少会话安全令牌，无法删除 GEO 观测');
  const result = await api.DELETE('/api/v1/geo-observations/{observation_id}', {
    params: {
      path: { observation_id: observationId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (!result.response.ok) throw geoRequestError('删除 GEO 观测', result);
}

function requireCsrfToken(csrfToken: string | null, action: string) {
  if (csrfToken) return csrfToken;
  throw new GeoRequestError(`缺少会话安全令牌，无法${action}`);
}

function geoRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new GeoRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new GeoRequestError(
    `${action}失败（HTTP ${result.response.status}）`,
    result.response.status,
  );
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const detail = value.error;
  return Boolean(
    detail
    && typeof detail === 'object'
    && 'code' in detail
    && typeof detail.code === 'string'
    && 'message' in detail
    && typeof detail.message === 'string'
    && 'request_id' in detail
    && typeof detail.request_id === 'string',
  );
}

export {
  abortGeoFileUpload,
  completeGeoFileUpload,
  createGeoFileUploadIntent,
  createGeoObservation,
  deleteGeoObservation,
  GeoRequestError,
  geoKeys,
  geoObservationListQueryOptions,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
};
