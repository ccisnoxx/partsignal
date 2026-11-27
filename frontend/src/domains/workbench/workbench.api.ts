import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type { WorkAssignmentTargetType, WorkbenchInboxBucket } from './workbench.model';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type WorkAssignmentUpdate = components['schemas']['WorkAssignmentUpdate'];
type WorkAssignmentDetail = components['schemas']['WorkAssignmentDetail'];
type WorkbenchInbox = components['schemas']['WorkbenchInbox'];
type WorkAssigneeOptionList = components['schemas']['WorkAssigneeOptionList'];

const workbenchKeys = {
  all: () => ['workbench'] as const,
  aggregate: () => ['workbench', 'aggregate'] as const,
  inboxAll: () => ['workbench', 'inbox'] as const,
  inbox: (bucket: WorkbenchInboxBucket, timezone: string) =>
    ['workbench', 'inbox', bucket, timezone] as const,
  assignees: () => ['workbench', 'assignees'] as const,
  assignment: (targetType: WorkAssignmentTargetType, targetId: string) =>
    ['workbench', 'assignment', targetType, targetId] as const,
};

function workbenchQueryOptions() {
  return queryOptions({
    queryKey: workbenchKeys.aggregate(),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/workbench', { signal });
      if (!result.data) throw workbenchRequestError('读取工作台', result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function workbenchInboxQueryOptions(
  bucket: WorkbenchInboxBucket,
  timezone = 'Asia/Shanghai',
) {
  return queryOptions({
    queryKey: workbenchKeys.inbox(bucket, timezone),
    queryFn: async ({ signal }): Promise<WorkbenchInbox> => {
      const result = await api.GET('/api/v1/workbench/inbox', {
        params: { query: { bucket, timezone } },
        signal,
      });
      if (!result.data) throw workbenchRequestError('读取运营收件箱', result);
      return result.data;
    },
    placeholderData: keepPreviousData,
    retry: false,
    retryOnMount: false,
    staleTime: 15_000,
  });
}

function workbenchAssigneesQueryOptions() {
  return queryOptions({
    queryKey: workbenchKeys.assignees(),
    queryFn: async ({ signal }): Promise<WorkAssigneeOptionList> => {
      const result = await api.GET('/api/v1/workbench/assignees', { signal });
      if (!result.data) throw workbenchRequestError('读取可分派成员', result);
      return result.data;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function workAssignmentQueryOptions(
  targetType: WorkAssignmentTargetType,
  targetId: string,
) {
  return queryOptions({
    queryKey: workbenchKeys.assignment(targetType, targetId),
    queryFn: async ({ signal }): Promise<WorkAssignmentDetail> => {
      const result = await api.GET('/api/v1/work-assignments/{target_type}/{target_id}', {
        params: { path: { target_type: targetType, target_id: targetId } },
        signal,
      });
      if (!result.data) throw workbenchRequestError('读取责任人与 SLA', result);
      return result.data;
    },
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  });
}

async function updateWorkAssignment(
  targetType: WorkAssignmentTargetType,
  targetId: string,
  body: WorkAssignmentUpdate,
  csrfToken: string | null,
): Promise<WorkAssignmentDetail> {
  if (!csrfToken) throw new Error('缺少 CSRF 令牌，请刷新页面后重试');
  const header = { 'X-CSRF-Token': csrfToken };
  let result: { data?: WorkAssignmentDetail; error?: unknown; response: Response };
  switch (targetType) {
    case 'FactVersion':
      result = await api.PATCH('/api/v1/fact-versions/{fact_version_id}/assignment', {
        body,
        params: { path: { fact_version_id: targetId }, header },
      });
      break;
    case 'ContentTask':
      result = await api.PATCH('/api/v1/content-tasks/{content_task_id}/assignment', {
        body,
        params: { path: { content_task_id: targetId }, header },
      });
      break;
    case 'PublicationWork':
      result = await api.PATCH('/api/v1/publication-works/{publication_work_id}/assignment', {
        body,
        params: { path: { publication_work_id: targetId }, header },
      });
      break;
    case 'PublishedContentIssue':
      result = await api.PATCH('/api/v1/published-content-issues/{issue_id}/assignment', {
        body,
        params: { path: { issue_id: targetId }, header },
      });
      break;
    case 'GeoOpportunity':
      result = await api.PATCH('/api/v1/geo/opportunities/{opportunity_id}/assignment', {
        body,
        params: { path: { opportunity_id: targetId }, header },
      });
      break;
    default: {
      const exhaustive: never = targetType;
      throw new Error(`不支持的分派对象类型：${String(exhaustive)}`);
    }
  }
  if (result.data) return result.data;
  throw workbenchRequestError('更新责任人与 SLA', result);
}

function workbenchRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new Error(`${detail.message}（请求 ID：${detail.request_id}）`);
  }
  return new Error(`${action}失败（HTTP ${result.response.status}）`);
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
  updateWorkAssignment,
  workAssignmentQueryOptions,
  workbenchAssigneesQueryOptions,
  workbenchInboxQueryOptions,
  workbenchKeys,
  workbenchQueryOptions,
};
