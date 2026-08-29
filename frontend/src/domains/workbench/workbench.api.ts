import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

function workbenchQueryOptions() {
  return queryOptions({
    queryKey: ['workbench', 'aggregate'] as const,
    queryFn: async () => {
      const result = await api.GET('/api/v1/workbench');
      if (!result.data) throw workbenchRequestError(result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function workbenchRequestError(result: { error?: unknown; response: Response }) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new Error(`${detail.message}（请求 ID：${detail.request_id}）`);
  }
  return new Error(`读取工作台失败（HTTP ${result.response.status}）`);
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

export { workbenchQueryOptions };
