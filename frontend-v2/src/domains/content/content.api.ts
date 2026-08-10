import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  contentTasksSearchToApiParams,
  type ContentTaskListApiParams,
  type ContentTasksSearch,
} from './content-task-list.model';

type ContentTask = components['schemas']['ContentTask'];
type ContentTaskCreate = components['schemas']['ContentTaskCreate'];
type ContentTaskCreationOptions = components['schemas']['ContentTaskCreationOptions'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentReviewContext = components['schemas']['ContentReviewContext'];
type ContentRevisionCreate = components['schemas']['ContentRevisionCreate'];
type ContentDraftUpdate = components['schemas']['ContentDraftUpdate'];
type ContentVersion = components['schemas']['ContentVersion'];
type ContentVersionDetail = components['schemas']['ContentVersionDetail'];
type CommandRequest = components['schemas']['CommandRequest'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];
type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobDetail = components['schemas']['GenerationJobDetail'];
type GenerationJobList = components['schemas']['GenerationJobList'];
type GenerationOptions = components['schemas']['GenerationOptions'];
type HumanizationJobCreate = components['schemas']['HumanizationJobCreate'];
type OriginalGenerationJobCreate = components['schemas']['OriginalGenerationJobCreate'];
type ContentTaskCommandTarget = Pick<ContentTask, 'id' | 'revision'>;
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
  details: () => ['content', 'tasks', 'detail'] as const,
  detail: (taskId: string) => ['content', 'tasks', 'detail', taskId] as const,
  editorContexts: () => ['content', 'tasks', 'editor-context'] as const,
  editorContext: (taskId: string) => (
    ['content', 'tasks', 'editor-context', taskId] as const
  ),
  reviewContexts: () => ['content', 'tasks', 'review-context'] as const,
  reviewContext: (taskId: string) => (
    ['content', 'tasks', 'review-context', taskId] as const
  ),
  versionDetails: () => ['content', 'versions', 'detail'] as const,
  versionDetail: (versionId: string) => (
    ['content', 'versions', 'detail', versionId] as const
  ),
  generationOptions: (taskId: string) => (
    ['content', 'tasks', taskId, 'generation-options'] as const
  ),
  generationJobs: (taskId: string) => (
    ['content', 'tasks', taskId, 'generation-jobs'] as const
  ),
  generationJob: (jobId: string) => ['content', 'generation-jobs', jobId] as const,
  platformReferences: () => ['content', 'tasks', 'platform-references'] as const,
  permanentDeletionPreview: (taskId: string) => (
    ['content', 'tasks', taskId, 'permanent-deletion-preview'] as const
  ),
  creationOptions: (requestedProductId?: string) => (
    ['content', 'tasks', 'creation-options', requestedProductId ?? null] as const
  ),
};

function generationOptionsQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: contentKeys.generationOptions(taskId),
    queryFn: async (): Promise<GenerationOptions> => {
      const result = await api.GET(
        '/api/v1/content-tasks/{content_task_id}/generation-options',
        { params: { path: { content_task_id: taskId } } },
      );
      if (!result.data) throw contentRequestError('读取 AI 生成选项', result);
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
}

function generationJobsQueryOptions(taskId: string, trackedJobId: string | null) {
  return queryOptions({
    enabled: trackedJobId !== null,
    queryKey: contentKeys.generationJobs(taskId),
    queryFn: async (): Promise<GenerationJobList> => {
      const result = await api.GET(
        '/api/v1/content-tasks/{content_task_id}/generation-jobs',
        { params: { path: { content_task_id: taskId } } },
      );
      if (!result.data) throw contentRequestError('读取生成作业', result);
      return result.data;
    },
    refetchInterval: (query) => {
      const tracked = query.state.data?.items.find((job) => job.id === trackedJobId);
      return tracked?.status === 'PENDING' || tracked?.status === 'RUNNING' ? 2_000 : false;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    staleTime: 0,
  });
}

function generationJobDetailQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: contentKeys.generationJob(jobId),
    queryFn: async (): Promise<GenerationJobDetail> => {
      const result = await api.GET('/api/v1/generation-jobs/{generation_job_id}', {
        params: { path: { generation_job_id: jobId } },
      });
      if (!result.data) throw contentRequestError('读取完整生成作业快照', result);
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
}

async function createGenerationJob(
  taskId: string,
  body: OriginalGenerationJobCreate,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<GenerationJob> {
  const token = requireCsrfToken(csrfToken, '创建生成作业');
  const result = await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', {
    body,
    params: {
      path: { content_task_id: taskId },
      header: { 'X-CSRF-Token': token, 'Idempotency-Key': idempotencyKey },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('创建生成作业', result);
}

async function createHumanizationJob(
  versionId: string,
  body: HumanizationJobCreate,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<GenerationJob> {
  const token = requireCsrfToken(csrfToken, '创建自然化作业');
  const result = await api.POST(
    '/api/v1/content-versions/{content_version_id}/humanization-jobs',
    {
      body,
      params: {
        path: { content_version_id: versionId },
        header: { 'X-CSRF-Token': token, 'Idempotency-Key': idempotencyKey },
      },
    },
  );
  if (result.data) return result.data;
  throw contentRequestError('创建自然化作业', result);
}

async function retryGenerationJob(
  jobId: string,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<GenerationJob> {
  const token = requireCsrfToken(csrfToken, '重试生成作业');
  const result = await api.POST('/api/v1/generation-jobs/{generation_job_id}/retry', {
    params: {
      path: { generation_job_id: jobId },
      header: { 'X-CSRF-Token': token, 'Idempotency-Key': idempotencyKey },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('重试生成作业', result);
}

function contentEditorContextQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: contentKeys.editorContext(taskId),
    queryFn: async (): Promise<ContentEditorContext> => {
      const result = await api.GET('/api/v1/content-tasks/{content_task_id}/editor-context', {
        params: { path: { content_task_id: taskId } },
      });
      if (!result.data) throw contentRequestError('读取内容编辑器', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function contentReviewContextQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: contentKeys.reviewContext(taskId),
    queryFn: async (): Promise<ContentReviewContext> => {
      const result = await api.GET('/api/v1/content-tasks/{content_task_id}/review-context', {
        params: { path: { content_task_id: taskId } },
      });
      if (!result.data) throw contentRequestError('读取内容审核上下文', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function contentTaskDetailQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: contentKeys.detail(taskId),
    queryFn: async (): Promise<ContentTaskDetail> => {
      const result = await api.GET('/api/v1/content-tasks/{content_task_id}/detail', {
        params: { path: { content_task_id: taskId } },
      });
      if (!result.data) throw contentRequestError('读取内容任务详情', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function contentVersionDetailQueryOptions(versionId: string) {
  return queryOptions({
    queryKey: contentKeys.versionDetail(versionId),
    queryFn: async (): Promise<ContentVersionDetail> => {
      const result = await api.GET(
        '/api/v1/content-versions/{content_version_id}/detail',
        { params: { path: { content_version_id: versionId } } },
      );
      if (!result.data) throw contentRequestError('读取内容版本详情', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

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

async function createManualContentVersion(
  taskId: string,
  body: ContentRevisionCreate,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const token = requireCsrfToken(csrfToken, '创建人工首稿');
  const result = await api.POST('/api/v1/content-tasks/{content_task_id}/manual-versions', {
    body,
    params: {
      path: { content_task_id: taskId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('创建人工首稿', result);
}

async function createContentRevision(
  versionId: string,
  body: ContentRevisionCreate,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const token = requireCsrfToken(csrfToken, '创建内容修订');
  const result = await api.POST('/api/v1/content-versions/{content_version_id}/revisions', {
    body,
    params: {
      path: { content_version_id: versionId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('创建内容修订', result);
}

async function updateContentDraft(
  versionId: string,
  body: ContentDraftUpdate,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const token = requireCsrfToken(csrfToken, '保存内容草稿');
  const result = await api.PUT('/api/v1/content-versions/{content_version_id}', {
    body,
    params: {
      path: { content_version_id: versionId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('保存内容草稿', result);
}

async function submitContentVersion(
  versionId: string,
  body: CommandRequest,
  csrfToken: string | null,
): Promise<ContentVersion> {
  return commandContentVersion('submit-review', versionId, body, csrfToken);
}

async function abandonContentVersion(
  versionId: string,
  body: CommandRequest,
  csrfToken: string | null,
): Promise<ContentVersion> {
  return commandContentVersion('abandon', versionId, body, csrfToken);
}

async function approveContentVersion(
  versionId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const token = requireCsrfToken(csrfToken, '批准内容');
  const result = await api.POST('/api/v1/content-versions/{content_version_id}/approve', {
    body: { expected_revision: expectedRevision, comment: '' },
    params: {
      path: { content_version_id: versionId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError('批准内容', result);
}

async function requestContentVersionChanges(
  versionId: string,
  body: RequestChangesCommand,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const token = requireCsrfToken(csrfToken, '退回内容修改');
  const result = await api.POST(
    '/api/v1/content-versions/{content_version_id}/request-changes',
    {
      body,
      params: {
        path: { content_version_id: versionId },
        header: { 'X-CSRF-Token': token },
      },
    },
  );
  if (result.data) return result.data;
  throw contentRequestError('退回内容修改', result);
}

async function commandContentVersion(
  command: 'submit-review' | 'abandon',
  versionId: string,
  body: CommandRequest,
  csrfToken: string | null,
): Promise<ContentVersion> {
  const action = command === 'submit-review' ? '提交内容审核' : '放弃内容版本';
  const token = requireCsrfToken(csrfToken, action);
  const path = command === 'submit-review'
    ? '/api/v1/content-versions/{content_version_id}/submit-review'
    : '/api/v1/content-versions/{content_version_id}/abandon';
  const result = await api.POST(path, {
    body,
    params: {
      path: { content_version_id: versionId },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw contentRequestError(action, result);
}

async function deleteContentDraft(
  versionId: string,
  expectedRevision: number,
  csrfToken: string | null,
) {
  const token = requireCsrfToken(csrfToken, '删除内容草稿');
  const result = await api.DELETE('/api/v1/content-versions/{content_version_id}', {
    params: {
      path: { content_version_id: versionId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (!result.response.ok) throw contentRequestError('删除内容草稿', result);
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
  task: ContentTaskCommandTarget,
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
  task: ContentTaskCommandTarget,
  csrfToken: string | null,
): Promise<ContentTask> {
  return reviseContentTask('archive', task, csrfToken);
}

async function restoreContentTask(
  task: ContentTaskCommandTarget,
  csrfToken: string | null,
): Promise<ContentTask> {
  return reviseContentTask('restore', task, csrfToken);
}

async function reviseContentTask(
  command: 'archive' | 'restore',
  task: ContentTaskCommandTarget,
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

async function deleteContentTask(task: ContentTaskCommandTarget, csrfToken: string | null) {
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

function contentTaskDetailErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (error instanceof ContentRequestError && error.status === 404) return 'not-found';
  if (error instanceof ContentRequestError && error.status === 403) return 'forbidden';
  return 'generic';
}

const contentEditorContextErrorKind = contentTaskDetailErrorKind;
const contentReviewContextErrorKind = contentTaskDetailErrorKind;
const contentVersionDetailErrorKind = contentTaskDetailErrorKind;

export {
  ContentRequestError,
  approveContentVersion,
  archiveContentTask,
  cancelContentTask,
  contentEditorContextErrorKind,
  contentEditorContextQueryOptions,
  contentReviewContextErrorKind,
  contentReviewContextQueryOptions,
  contentTaskCreationOptionsQueryOptions,
  contentTaskDetailErrorKind,
  contentTaskDetailQueryOptions,
  contentVersionDetailErrorKind,
  contentVersionDetailQueryOptions,
  contentKeys,
  contentPlatformReferencesQueryOptions,
  contentRequestError,
  contentTaskListQueryOptions,
  createContentTask,
  createContentRevision,
  createGenerationJob,
  createHumanizationJob,
  createManualContentVersion,
  deleteContentDraft,
  deleteContentTask,
  permanentDeletionPreviewQueryOptions,
  permanentlyDeleteContentTask,
  generationJobDetailQueryOptions,
  generationJobsQueryOptions,
  generationOptionsQueryOptions,
  mapContentTaskCreateError,
  restoreContentTask,
  requestContentVersionChanges,
  retryGenerationJob,
  submitContentVersion,
  abandonContentVersion,
  updateContentDraft,
};
export type { ContentTaskCommandTarget, ContentTaskCreateErrorMapping };
