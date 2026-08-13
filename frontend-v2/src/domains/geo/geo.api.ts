import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  geoObservationSearchToApiParams,
  type GeoObservationListApiParams,
  type GeoObservationSearch,
} from './geo-observation-list.model';
import {
  queryTopicSearchToApiParams,
  type QueryTopicCreate,
  type QueryTopicSearch,
  type QueryTopicUpdate,
} from './query-topic-list.model';
import {
  assertGeoObservationCorrectionContext,
  assertGeoObservationDetail,
} from './geo-observation-detail.model';

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
  details: () => ['geo', 'observations', 'detail'] as const,
  detail: (observationId: string) => (
    ['geo', 'observations', 'detail', observationId] as const
  ),
  correctionContexts: () => ['geo', 'observations', 'correction-context'] as const,
  correctionContext: (observationId: string) => (
    ['geo', 'observations', 'correction-context', observationId] as const
  ),
  topics: () => ['geo', 'query-topics'] as const,
  topicOptions: () => ['geo', 'query-topics', 'options'] as const,
  topicLists: () => ['geo', 'query-topics', 'list'] as const,
  topicList: (params: ReturnType<typeof queryTopicSearchToApiParams>) => (
    ['geo', 'query-topics', 'list', params] as const
  ),
  publicationCandidates: (productId: string) => (
    ['geo', 'observation-publications', productId] as const
  ),
};

function geoObservationCorrectionContextQueryOptions(observationId: string) {
  return queryOptions({
    queryKey: geoKeys.correctionContext(observationId),
    queryFn: async () => {
      const result = await api.GET(
        '/api/v1/geo-observations/{observation_id}/correction-context',
        { params: { path: { observation_id: observationId } } },
      );
      if (!result.data) throw geoRequestError('读取 GEO 更正上下文', result);
      return assertGeoObservationCorrectionContext(result.data, observationId);
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 0,
  });
}

function geoObservationDetailQueryOptions(observationId: string) {
  return queryOptions({
    queryKey: geoKeys.detail(observationId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/geo-observations/{observation_id}/detail', {
        params: { path: { observation_id: observationId } },
      });
      if (!result.data) throw geoRequestError('读取 GEO 观测详情', result);
      return assertGeoObservationDetail(result.data, observationId);
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

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
    queryKey: geoKeys.topicOptions(),
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

function queryTopicListQueryOptions(search: QueryTopicSearch) {
  const params = queryTopicSearchToApiParams(search);
  return queryOptions({
    queryKey: geoKeys.topicList(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/query-topics/list-items', {
        params: { query: params },
      });
      if (!result.data) throw geoRequestError('读取 Query Topic 列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function createQueryTopic(body: QueryTopicCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/query-topics', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '创建 Query Topic') } },
  });
  if (result.data) return result.data;
  throw geoRequestError('创建 Query Topic', result);
}

async function updateQueryTopic(
  topicId: string,
  body: QueryTopicUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/query-topics/{query_topic_id}', {
    body,
    params: {
      path: { query_topic_id: topicId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '更新 Query Topic') },
    },
  });
  if (result.data) return result.data;
  throw geoRequestError('更新 Query Topic', result);
}

async function deleteQueryTopic(
  topicId: string,
  expectedRevision: number,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/query-topics/{query_topic_id}', {
    params: {
      path: { query_topic_id: topicId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken, '删除 Query Topic') },
    },
  });
  if (result.response.ok) return;
  throw geoRequestError('删除 Query Topic', result);
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
  createQueryTopic,
  deleteQueryTopic,
  deleteGeoObservation,
  GeoRequestError,
  geoKeys,
  geoObservationCorrectionContextQueryOptions,
  geoObservationDetailQueryOptions,
  geoObservationListQueryOptions,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
  queryTopicListQueryOptions,
  updateQueryTopic,
};
