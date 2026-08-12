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
  deleteGeoObservation,
  GeoRequestError,
  geoKeys,
  geoObservationListQueryOptions,
};
