import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  platformSearchToApiParams,
  type PlatformCommand,
  type PlatformProfile,
  type PlatformSearch,
} from './platform-list.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

class PlatformRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'PlatformRequestError';
  }
}

const platformKeys = {
  lists: () => ['configuration', 'platforms', 'list'] as const,
  list: (params: ReturnType<typeof platformSearchToApiParams>) => (
    ['configuration', 'platforms', 'list', params] as const
  ),
};

function platformListQueryOptions(search: PlatformSearch) {
  const params = platformSearchToApiParams(search);
  return queryOptions({
    queryKey: platformKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-profiles', {
        params: { query: params },
      });
      if (!result.data) throw platformRequestError('读取平台列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function runPlatformCommand(
  command: PlatformCommand,
  platform: PlatformProfile,
  csrfToken: string | null,
) {
  const token = requireCsrfToken(csrfToken);
  if (command === 'delete-platform') {
    const result = await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}', {
      params: {
        path: { platform_profile_id: platform.id },
        query: { expected_revision: platform.revision },
        header: { 'X-CSRF-Token': token },
      },
    });
    if (result.response.ok) return;
    throw platformRequestError('删除平台', result);
  }
  const path = command === 'enable-platform'
    ? '/api/v1/platform-profiles/{platform_profile_id}/enable' as const
    : '/api/v1/platform-profiles/{platform_profile_id}/disable' as const;
  const result = await api.POST(path, {
    body: { expected_revision: platform.revision },
    params: {
      path: { platform_profile_id: platform.id },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError(command === 'enable-platform' ? '启用平台' : '停用平台', result);
}

function requireCsrfToken(csrfToken: string | null) {
  if (csrfToken) return csrfToken;
  throw new PlatformRequestError('缺少会话安全令牌，无法管理平台');
}

function platformRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new PlatformRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new PlatformRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
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
  PlatformRequestError,
  platformKeys,
  platformListQueryOptions,
  runPlatformCommand,
};
