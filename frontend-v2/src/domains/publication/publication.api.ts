import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  issueSearchToApiParams,
  type PublishedContentIssueListApiParams,
  type PublishedContentIssueSearch,
} from './published-content-issue.model';
import {
  publishedArticleSearchToApiParams,
  type PublishedArticleListApiParams,
  type PublishedArticleSearch,
} from './published-article.model';
import {
  publicationWorkSearchToApiParams,
  type PublicationWork,
  type PublicationWorkListApiParams,
  type PublicationWorkSearch,
} from './publication-work.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type PublicationWorkCreate = components['schemas']['PublicationWorkCreate'];
type PublicationPreparationUpdate = components['schemas']['PublicationPreparationUpdate'];
type PublicationPlatformReviewRequest = components['schemas']['PublicationPlatformReviewRequest'];
type PublicationResultUpdate = components['schemas']['PublicationResultUpdate'];
type PublicationVerificationCreate = components['schemas']['PublicationVerificationCreate'];
type PublicationContentVersionSwitchRequest = components['schemas']['PublicationContentVersionSwitchRequest'];
type PublicationWorkCloseRequest = components['schemas']['PublicationWorkCloseRequest'];
type UploadIntentCreate = components['schemas']['UploadIntentCreate'];
type PublishedContentIssueCreate = components['schemas']['PublishedContentIssueCreate'];
type PublishedContentRepairTaskCreate = components['schemas']['PublishedContentRepairTaskCreate'];
type PublishedContentIssueResolveRequest = components['schemas']['PublishedContentIssueResolveRequest'];

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
  workspaceContexts: () => ['publication', 'works', 'workspace-context'] as const,
  workspaceContext: (workId: string) => (
    ['publication', 'works', 'workspace-context', workId] as const
  ),
  packages: () => ['publication', 'packages'] as const,
  package: (contentVersionId: string) => (
    ['publication', 'packages', contentVersionId] as const
  ),
  articleLists: () => ['publication', 'articles', 'list'] as const,
  articleList: (params: PublishedArticleListApiParams) => (
    ['publication', 'articles', 'list', params] as const
  ),
  articles: () => ['publication', 'articles', 'detail'] as const,
  article: (articleId: string) => ['publication', 'articles', 'detail', articleId] as const,
  issueLists: () => ['publication', 'issues', 'list'] as const,
  issueList: (params: PublishedContentIssueListApiParams) => (
    ['publication', 'issues', 'list', params] as const
  ),
  issueWorkspaceContexts: () => ['publication', 'issues', 'workspace-context'] as const,
  issueWorkspaceContext: (issueId: string) => (
    ['publication', 'issues', 'workspace-context', issueId] as const
  ),
  issueRepairContexts: () => ['publication', 'issues', 'repair-context'] as const,
  issueRepairContext: (issueId: string) => (
    ['publication', 'issues', 'repair-context', issueId] as const
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

function publicationWorkspaceContextQueryOptions(workId: string) {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.workspaceContext(workId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/publication-works/{work_id}/workspace-context', {
        params: { path: { work_id: workId } },
      });
      if (!result.data) throw publicationRequestError('读取发布工作台', result);
      return result.data;
    },
  });
}

function publicationPackageQueryOptions(contentVersionId: string) {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.package(contentVersionId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/content-versions/{content_version_id}/publication-package', {
        params: { path: { content_version_id: contentVersionId } },
      });
      if (!result.data) throw publicationRequestError('读取发布包', result);
      return result.data;
    },
  });
}

function publishedArticleListQueryOptions(search: PublishedArticleSearch) {
  const params = publishedArticleSearchToApiParams(search);
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.articleList(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/published-articles', {
        params: { query: params },
      });
      if (!result.data) throw publicationRequestError('读取发布成果列表', result);
      return result.data;
    },
  });
}

function publishedArticleQueryOptions(articleId: string) {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.article(articleId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/published-articles/{article_id}', {
        params: { path: { article_id: articleId } },
      });
      if (!result.data) throw publicationRequestError('读取发布成果详情', result);
      return result.data;
    },
  });
}

function publishedContentIssueListQueryOptions(search: PublishedContentIssueSearch) {
  const params = issueSearchToApiParams(search);
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.issueList(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/published-content-issues', {
        params: { query: params },
      });
      if (!result.data) throw publicationRequestError('读取内容问题列表', result);
      return result.data;
    },
  });
}

function publishedContentIssueWorkspaceQueryOptions(issueId: string) {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.issueWorkspaceContext(issueId),
    queryFn: async () => {
      const result = await api.GET(
        '/api/v1/published-content-issues/{issue_id}/workspace-context',
        { params: { path: { issue_id: issueId } } },
      );
      if (!result.data) throw publicationRequestError('读取内容问题工作区', result);
      return result.data;
    },
  });
}

function publishedContentRepairContextQueryOptions(issueId: string) {
  return queryOptions({
    ...commonQueryOptions,
    queryKey: publicationKeys.issueRepairContext(issueId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/published-content-issues/{issue_id}/repair-context', {
        params: { path: { issue_id: issueId } },
      });
      if (!result.data) throw publicationRequestError('读取内容修复选项', result);
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

function requireCsrfToken(csrfToken: string | null) {
  if (!csrfToken) throw new PublicationRequestError('缺少会话安全令牌，无法执行发布操作');
  return csrfToken;
}

async function openPublishedContentIssue(
  articleId: string,
  body: PublishedContentIssueCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/published-articles/{article_id}/issues', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { article_id: articleId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('登记内容问题', result);
}

async function createPublishedContentRepairTask(
  issueId: string,
  body: PublishedContentRepairTaskCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/published-content-issues/{issue_id}/repair-task', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { issue_id: issueId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('创建内容修复任务', result);
}

async function resolvePublishedContentIssue(
  issueId: string,
  body: PublishedContentIssueResolveRequest,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/published-content-issues/{issue_id}/resolve', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { issue_id: issueId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('解决内容问题', result);
}

async function updatePublicationPreparation(
  workId: string,
  body: PublicationPreparationUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/publication-works/{work_id}/preparation', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('更新发布准备信息', result);
}

async function markPublicationPlatformReview(
  workId: string,
  body: PublicationPlatformReviewRequest,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/publication-works/{work_id}/platform-review', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('标记平台处理中', result);
}

async function registerPublicationResult(
  workId: string,
  body: PublicationResultUpdate,
  csrfToken: string | null,
) {
  const result = await api.PUT('/api/v1/publication-works/{work_id}/result', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('登记发布结果', result);
}

async function verifyPublicationWork(
  workId: string,
  body: PublicationVerificationCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/publication-works/{work_id}/verifications', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('核验发布结果', result);
}

async function switchPublicationContentVersion(
  workId: string,
  body: PublicationContentVersionSwitchRequest,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/publication-works/{work_id}/content-version', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('切换批准内容版本', result);
}

async function closePublicationWork(
  workId: string,
  body: PublicationWorkCloseRequest,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/publication-works/{work_id}/close', {
    body,
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { work_id: workId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('关闭发布工作', result);
}

async function createFileUploadIntent(body: UploadIntentCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/upload-intents', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw publicationRequestError('创建证据上传意图', result);
}

async function completeFileUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/complete', {
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { file_id: fileId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('确认文件上传', result);
}

async function abortFileUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/abort', {
    params: {
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
      path: { file_id: fileId },
    },
  });
  if (result.data) return result.data;
  throw publicationRequestError('中止文件上传', result);
}

async function getFileDownloadUrl(fileId: string) {
  const result = await api.GET('/api/v1/files/{file_id}/download-url', {
    params: { path: { file_id: fileId } },
  });
  if (result.data) return result.data;
  throw publicationRequestError('读取附件下载地址', result);
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

const mapPublicationError = mapPublicationStartError;

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
  abortFileUpload,
  closePublicationWork,
  completeFileUpload,
  createPublishedContentRepairTask,
  createPublicationWork,
  createFileUploadIntent,
  getFileDownloadUrl,
  mapPublicationError,
  mapPublicationStartError,
  markPublicationPlatformReview,
  publicationKeys,
  publicationPackageQueryOptions,
  publicationReadyItemsQueryOptions,
  publicationSummaryQueryOptions,
  publicationWorkListQueryOptions,
  publicationWorkspaceContextQueryOptions,
  publishedArticleListQueryOptions,
  publishedArticleQueryOptions,
  publishedContentIssueListQueryOptions,
  publishedContentIssueWorkspaceQueryOptions,
  publishedContentRepairContextQueryOptions,
  openPublishedContentIssue,
  registerPublicationResult,
  resolvePublishedContentIssue,
  switchPublicationContentVersion,
  updatePublicationPreparation,
  verifyPublicationWork,
};
export type { PublicationStartErrorMapping };
