import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  contentTasksSearchToApiParams,
  type ContentTaskListApiParams,
  type ContentTaskListItem,
  type ContentTasksSearch,
} from './content-task-list.model';

type ContentTask = components['schemas']['ContentTask'];
type ContentTaskCreate = components['schemas']['ContentTaskCreate'];
type ContentTaskCreationOptions = components['schemas']['ContentTaskCreationOptions'];
type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type PermanentDeletionPreview = components['schemas']['ContentTaskPermanentDeletionPreview'];

class ContentRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'ContentRequestError';
  }
}

const contentKeys = {
  lists: () => ['content', 'tasks', 'list'] as const,
  list: (params: ContentTaskListApiParams) => ['content', 'tasks', 'list', params] as const,
  platformReferences: () => ['content', 'tasks', 'platform-references'] as const,
  permanentDeletionPreview: (taskId: string) => (
    ['content', 'tasks', taskId, 'permanent-deletion-preview'] as const
  ),
  creationOptions: (requestedProductId?: string) => (
    ['content', 'tasks', 'creation-options', requestedProductId ?? null] as const
  ),
};

function contentTaskCreationOptionsQueryOptions(requestedProductId?: string) {
  return queryOptions({
    queryKey: contentKeys.creationOptions(requestedProductId),
    queryFn: async (): Promise<ContentTaskCreationOptions> => {
      const result = await api.GET('/api/v1/content-tasks/creation-options', {
        params: { query: { requested_product_id: requestedProductId } },
      });
      if (!result.data) throw contentRequestError('读取创建选项', result);
      return result.data;
    },
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: 'always',
    retry: false,
    staleTime: 30_000,
  });
}

async function createContentTask(
  body: ContentTaskCreate,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<ContentTask> {
  const token = requireCsrfToken(csrfToken, '创建内容任务');
  const result = await api.POST('/api/v1/content-tasks', {
    body,
    params: {
      header: {
        'X-CSRF-Token': token,
        'Idempotency-Key': idempotencyKey,
      },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('创建内容任务', result);
}

type ContentTaskCreateField = keyof ContentTaskCreate;
type ContentTaskCreateErrorMapping = {
  fields: Partial<Record<ContentTaskCreateField, string>>;
  formMessage?: string;
  requestId?: string;
  code?: string;
};

const contentTaskCreateFields = new Set<ContentTaskCreateField>([
  'product_id',
  'fact_version_id',
  'platform_profile_id',
]);

function mapContentTaskCreateError(error: unknown): ContentTaskCreateErrorMapping {
  if (!(error instanceof ContentRequestError) || !error.detail) {
    return {
      fields: {},
      formMessage: error instanceof Error ? error.message : '创建内容任务失败',
    };
  }

  const fields: Partial<Record<ContentTaskCreateField, string>> = {};
  const issues = error.detail.details.errors;
  let hasUnknownIssue = false;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        hasUnknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      const field = Array.isArray(loc) && loc.length === 2 && loc[0] === 'body'
        ? loc[1]
        : undefined;
      if (
        typeof field === 'string'
        && contentTaskCreateFields.has(field as ContentTaskCreateField)
        && typeof message === 'string'
      ) {
        fields[field as ContentTaskCreateField] ??= message;
      } else {
        hasUnknownIssue = true;
      }
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || hasUnknownIssue
      ? error.detail.message
      : undefined,
    requestId: error.detail.request_id,
    code: error.detail.code,
  };
}

function contentTaskListQueryOptions(search: ContentTasksSearch) {
  const params = contentTasksSearchToApiParams(search);
  return queryOptions({
    queryKey: contentKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/content-tasks', { params: { query: params } });
      if (!result.data) throw contentRequestError('读取内容任务列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function contentPlatformReferencesQueryOptions() {
  return queryOptions({
    queryKey: contentKeys.platformReferences(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-profiles');
      if (!result.data) throw contentRequestError('读取平台筛选项', result);
      return result.data;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function permanentDeletionPreviewQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: contentKeys.permanentDeletionPreview(taskId),
    queryFn: async (): Promise<PermanentDeletionPreview> => {
      const result = await api.GET(
        '/api/v1/content-tasks/{content_task_id}/permanent-deletion-preview',
        { params: { path: { content_task_id: taskId } } },
      );
      if (!result.data) throw contentRequestError('读取永久删除范围', result);
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
}

async function cancelContentTask(
  task: ContentTaskListItem,
  comment: string,
  csrfToken: string | null,
): Promise<ContentTask> {
  const token = requireCsrfToken(csrfToken, '取消内容任务');
  const result = await api.POST('/api/v1/content-tasks/{content_task_id}/cancel', {
    body: { expected_revision: task.revision, comment },
    params: {
      path: { content_task_id: task.id },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('取消内容任务', result);
}

async function archiveContentTask(
  task: ContentTaskListItem,
  csrfToken: string | null,
): Promise<ContentTask> {
  return reviseContentTask('archive', task, csrfToken);
}

async function restoreContentTask(
  task: ContentTaskListItem,
  csrfToken: string | null,
): Promise<ContentTask> {
  return reviseContentTask('restore', task, csrfToken);
}

async function reviseContentTask(
  command: 'archive' | 'restore',
  task: ContentTaskListItem,
  csrfToken: string | null,
): Promise<ContentTask> {
  const token = requireCsrfToken(csrfToken, command === 'archive' ? '归档内容任务' : '恢复内容任务');
  const path = command === 'archive'
    ? '/api/v1/content-tasks/{content_task_id}/archive'
    : '/api/v1/content-tasks/{content_task_id}/restore';
  const result = await api.POST(path, {
    body: { expected_revision: task.revision },
    params: {
      path: { content_task_id: task.id },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError(command === 'archive' ? '归档内容任务' : '恢复内容任务', result);
}

async function deleteContentTask(task: ContentTaskListItem, csrfToken: string | null) {
  const token = requireCsrfToken(csrfToken, '删除内容任务');
  const result = await api.DELETE('/api/v1/content-tasks/{content_task_id}', {
    params: {
      path: { content_task_id: task.id },
      query: { expected_revision: task.revision },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (!result.response.ok) throw contentRequestError('删除内容任务', result);
}

async function permanentlyDeleteContentTask(
  taskId: string,
  preview: PermanentDeletionPreview,
  confirmationText: string,
  csrfToken: string | null,
) {
  const token = requireCsrfToken(csrfToken, '永久删除内容任务');
  const result = await api.POST('/api/v1/content-tasks/{content_task_id}/permanent-delete', {
    body: {
      expected_revision: preview.revision,
      confirmation_text: confirmationText,
    },
    params: {
      path: { content_task_id: taskId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (!result.response.ok) throw contentRequestError('永久删除内容任务', result);
}

function requireCsrfToken(csrfToken: string | null, action: string) {
  if (csrfToken) return csrfToken;
  throw new ContentRequestError(`缺少会话安全令牌，无法${action}`);
}

function contentRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new ContentRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new ContentRequestError(
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
  ContentRequestError,
  archiveContentTask,
  cancelContentTask,
  contentTaskCreationOptionsQueryOptions,
  contentKeys,
  contentPlatformReferencesQueryOptions,
  contentRequestError,
  contentTaskListQueryOptions,
  createContentTask,
  deleteContentTask,
  permanentDeletionPreviewQueryOptions,
  permanentlyDeleteContentTask,
  mapContentTaskCreateError,
  restoreContentTask,
};
export type { ContentTaskCreateErrorMapping };
