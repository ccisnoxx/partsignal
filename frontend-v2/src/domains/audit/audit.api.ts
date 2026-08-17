import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { auditSearchToApiParams, type AuditSearch } from './audit.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

class AuditRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'AuditRequestError';
  }
}

const auditKeys = {
  list: (params: ReturnType<typeof auditSearchToApiParams>) => ['audit', 'list', params] as const,
  options: () => ['audit', 'filter-options'] as const,
  detail: (auditLogId: string) => ['audit', 'detail', auditLogId] as const,
};

function auditListQueryOptions(search: AuditSearch) {
  const params = auditSearchToApiParams(search);
  return queryOptions({
    queryKey: auditKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/audit-logs', { params: { query: params } });
      if (!result.data) throw auditRequestError('读取审计日志', result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function auditFilterOptionsQueryOptions() {
  return queryOptions({
    queryKey: auditKeys.options(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/audit-logs/filter-options');
      if (!result.data) throw auditRequestError('读取审计筛选项', result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function auditDetailQueryOptions(auditLogId: string) {
  return queryOptions({
    queryKey: auditKeys.detail(auditLogId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/audit-logs/{audit_log_id}', {
        params: { path: { audit_log_id: auditLogId } },
      });
      if (!result.data) throw auditRequestError('读取审计详情', result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function auditRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new AuditRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new AuditRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
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
  AuditRequestError,
  auditDetailQueryOptions,
  auditFilterOptionsQueryOptions,
  auditKeys,
  auditListQueryOptions,
};
