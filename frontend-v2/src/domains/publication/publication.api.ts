import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  publicationWorkSearchToApiParams,
  type PublicationWork,
  type PublicationWorkListApiParams,
  type PublicationWorkSearch,
} from './publication-work.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type PublicationWorkCreate = components['schemas']['PublicationWorkCreate'];

class PublicationRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'PublicationRequestError';
  }
}

const publicationKeys = {
  all: () => ['publication'] as const,
  summary: () => ['publication', 'summary'] as const,
  readyItems: () => ['publication', 'ready-items'] as const,
  workLists: () => ['publication', 'works', 'list'] as const,
  workList: (params: PublicationWorkListApiParams) => (
    ['publication', 'works', 'list', params] as const
  ),
};

const commonQueryOptions = {
  refetchOnWindowFocus: 'always' as const,
  retry: false as const,
  retryOnMount: false as const,
  staleTime: 30_000,
};

function publicationSummaryQueryOptions() {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.summary(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/publication-workbench-summary');
      if (!result.data) throw publicationRequestError('读取发布运营摘要', result);
      return result.data;
    },
  });
}

function publicationReadyItemsQueryOptions() {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.readyItems(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/publication-ready-items');
      if (!result.data) throw publicationRequestError('读取待开始内容', result);
      return result.data;
    },
  });
}

function publicationWorkListQueryOptions(search: PublicationWorkSearch) {
  const params = publicationWorkSearchToApiParams(search);
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.workList(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/publication-works', {
        params: { query: params },
      });
      if (!result.data) throw publicationRequestError('读取发布工作列表', result);
      return result.data;
    },
  });
}

async function createPublicationWork(
  body: PublicationWorkCreate,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<PublicationWork> {
  if (!csrfToken) throw new PublicationRequestError('缺少会话安全令牌，无法开始发布');
  const result = await api.POST('/api/v1/publication-works', {
    body,
    params: {
      header: {
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': idempotencyKey,
      },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('开始发布', result);
}

type PublicationStartErrorMapping = {
  message: string;
  requestId?: string;
  code?: string;
  status?: number;
};

function mapPublicationStartError(error: unknown): PublicationStartErrorMapping {
  if (error instanceof PublicationRequestError) {
    return {
      message: error.detail?.message ?? error.message,
      requestId: error.detail?.request_id,
      code: error.detail?.code,
      status: error.status,
    };
  }
  return { message: error instanceof Error ? error.message : '开始发布失败' };
}

function publicationRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new PublicationRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new PublicationRequestError(
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
  PublicationRequestError,
  createPublicationWork,
  mapPublicationStartError,
  publicationKeys,
  publicationReadyItemsQueryOptions,
  publicationSummaryQueryOptions,
  publicationWorkListQueryOptions,
};
export type { PublicationStartErrorMapping };
