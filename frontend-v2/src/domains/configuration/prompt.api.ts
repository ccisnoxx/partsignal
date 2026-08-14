import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type PlatformPromptCreate = components['schemas']['PlatformPromptCreate'];
type PlatformPromptDetail = components['schemas']['PlatformPromptDetail'];
type PlatformPromptPreviewOptions = components['schemas']['PlatformPromptPreviewOptions'];
type PlatformPromptUpdate = components['schemas']['PlatformPromptUpdate'];

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

export {
  PromptRequestError,
  createPlatformPrompt,
  deletePlatformPrompt,
  platformPromptDetailQueryOptions,
  platformPromptListQueryOptions,
  platformPromptPreviewOptionsQueryOptions,
  promptKeys,
  updatePlatformPrompt,
};
