import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type PlatformPromptCreate = components['schemas']['PlatformPromptCreate'];
type PlatformPromptDetail = components['schemas']['PlatformPromptDetail'];
type PlatformPromptPreviewOptions = components['schemas']['PlatformPromptPreviewOptions'];
type PlatformPromptUpdate = components['schemas']['PlatformPromptUpdate'];
type PlatformPromptVersionCreate = components['schemas']['PlatformPromptVersionCreate'];
type PlatformPromptVersionDraftUpdate = components['schemas']['PlatformPromptVersionDraftUpdate'];
type PlatformPromptVersionList = components['schemas']['PlatformPromptVersionList'];
type PlatformPromptVersionOut = components['schemas']['PlatformPromptVersionOut'];
type PlatformPromptBindingOut = components['schemas']['PlatformPromptBindingOut'];
type PlatformPromptVersionBindCommand = components['schemas']['PlatformPromptVersionBindCommand'];

class PromptRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'PromptRequestError';
  }
}

const promptKeys = {
  lists: () => ['configuration', 'prompts', 'list'] as const,
  list: () => ['configuration', 'prompts', 'list'] as const,
  details: () => ['configuration', 'prompts', 'detail'] as const,
  detail: (promptId: string) => ['configuration', 'prompts', 'detail', promptId] as const,
  versions: (promptId: string) => ['configuration', 'prompts', 'versions', promptId] as const,
  platformBinding: (platformProfileId: string) =>
    ['configuration', 'platforms', 'prompt-binding', platformProfileId] as const,
  previewOptionsRoot: () => ['configuration', 'prompts', 'preview-options'] as const,
  previewOptions: (promptId: string) => (
    ['configuration', 'prompts', 'preview-options', promptId] as const
  ),
};

function platformPromptListQueryOptions(enabled = true) {
  return queryOptions({
    enabled,
    queryKey: promptKeys.list(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-prompts');
      if (!result.data) throw promptRequestError('读取 Prompt 列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function platformPromptDetailQueryOptions(promptId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: promptKeys.detail(promptId),
    queryFn: async (): Promise<PlatformPromptDetail> => {
      const result = await api.GET('/api/v1/platform-prompts/{platform_prompt_id}', {
        params: { path: { platform_prompt_id: promptId } },
      });
      if (!result.data) throw promptRequestError('读取 Prompt 详情', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function platformPromptPreviewOptionsQueryOptions(promptId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: promptKeys.previewOptions(promptId),
    queryFn: async (): Promise<PlatformPromptPreviewOptions> => {
      const result = await api.GET(
        '/api/v1/platform-prompts/{platform_prompt_id}/preview-options',
        { params: { path: { platform_prompt_id: promptId } } },
      );
      if (!result.data) throw promptRequestError('读取 Prompt Preview 选项', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    staleTime: 0,
  });
}

async function createPlatformPrompt(body: PlatformPromptCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/platform-prompts', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw promptRequestError('创建 Prompt', result);
}

async function updatePlatformPrompt(
  promptId: string,
  body: PlatformPromptUpdate,
  csrfToken: string | null,
) {
  const result = await api.PUT('/api/v1/platform-prompts/{platform_prompt_id}', {
    body,
    params: {
      path: { platform_prompt_id: promptId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('更新 Prompt', result);
}

async function deletePlatformPrompt(
  prompt: Pick<PlatformPromptDetail, 'id' | 'revision'>,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/platform-prompts/{platform_prompt_id}', {
    params: {
      path: { platform_prompt_id: prompt.id },
      query: { expected_revision: prompt.revision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.ok) return;
  throw promptRequestError('删除 Prompt', result);
}

function requireCsrfToken(csrfToken: string | null) {
  if (csrfToken) return csrfToken;
  throw new PromptRequestError('缺少会话安全令牌，无法管理 Prompt');
}

function promptRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new PromptRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new PromptRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
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

function platformPromptVersionsQueryOptions(promptId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: promptKeys.versions(promptId),
    queryFn: async ({ signal }): Promise<PlatformPromptVersionList> => {
      const result = await api.GET('/api/v1/platform-prompts/{platform_prompt_id}/versions', {
        params: { path: { platform_prompt_id: promptId } },
        signal,
      });
      if (!result.data) throw promptRequestError('读取 Prompt 版本历史', result);
      return result.data;
    },
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  });
}

async function createPlatformPromptVersion(
  promptId: string,
  body: PlatformPromptVersionCreate,
  csrfToken: string | null,
): Promise<PlatformPromptVersionOut> {
  const result = await api.POST('/api/v1/platform-prompts/{platform_prompt_id}/versions', {
    body,
    params: {
      path: { platform_prompt_id: promptId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('创建 Prompt 版本', result);
}

async function updatePlatformPromptVersionDraft(
  versionId: string,
  body: PlatformPromptVersionDraftUpdate,
  csrfToken: string | null,
): Promise<PlatformPromptVersionOut> {
  const result = await api.PUT('/api/v1/platform-prompt-versions/{version_id}', {
    body,
    params: {
      path: { version_id: versionId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('更新 Prompt 草稿版本', result);
}

async function publishPlatformPromptVersion(
  versionId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<PlatformPromptVersionOut> {
  const result = await api.POST('/api/v1/platform-prompt-versions/{version_id}/publish', {
    body: { expected_revision: expectedRevision },
    params: {
      path: { version_id: versionId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('发布 Prompt 版本', result);
}

async function archivePlatformPromptVersion(
  versionId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<PlatformPromptVersionOut> {
  const result = await api.POST('/api/v1/platform-prompt-versions/{version_id}/archive', {
    body: { expected_revision: expectedRevision },
    params: {
      path: { version_id: versionId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('归档 Prompt 版本', result);
}

async function restorePlatformPromptVersion(
  versionId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<PlatformPromptVersionOut> {
  const result = await api.POST('/api/v1/platform-prompt-versions/{version_id}/restore', {
    body: { expected_revision: expectedRevision },
    params: {
      path: { version_id: versionId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('恢复 Prompt 版本', result);
}

function platformPromptBindingQueryOptions(platformProfileId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: promptKeys.platformBinding(platformProfileId),
    queryFn: async ({ signal }): Promise<PlatformPromptBindingOut> => {
      const result = await api.GET('/api/v1/platform-profiles/{platform_profile_id}/prompt-binding', {
        params: { path: { platform_profile_id: platformProfileId } },
        signal,
      });
      if (!result.data) throw promptRequestError('读取平台 Prompt 版本绑定', result);
      return result.data;
    },
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  });
}

async function bindPlatformPromptVersion(
  platformProfileId: string,
  body: PlatformPromptVersionBindCommand,
  csrfToken: string | null,
): Promise<PlatformPromptBindingOut> {
  const result = await api.POST('/api/v1/platform-profiles/{platform_profile_id}/bind-prompt-version', {
    body,
    params: {
      path: { platform_profile_id: platformProfileId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw promptRequestError('切换平台 Prompt 版本', result);
}

export {
  PromptRequestError,
  archivePlatformPromptVersion,
  bindPlatformPromptVersion,
  createPlatformPrompt,
  createPlatformPromptVersion,
  deletePlatformPrompt,
  platformPromptBindingQueryOptions,
  platformPromptDetailQueryOptions,
  platformPromptListQueryOptions,
  platformPromptPreviewOptionsQueryOptions,
  platformPromptVersionsQueryOptions,
  promptKeys,
  publishPlatformPromptVersion,
  restorePlatformPromptVersion,
  updatePlatformPrompt,
  updatePlatformPromptVersionDraft,
};
