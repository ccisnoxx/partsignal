import { queryOptions, type QueryClient } from '@tanstack/react-query';

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
type PlatformAccount = components['schemas']['PlatformAccount'];
type PlatformAccountCreate = components['schemas']['PlatformAccountCreate'];
type PlatformAccountUpdate = components['schemas']['PlatformAccountUpdate'];
type PlatformProfileDetail = components['schemas']['PlatformProfileDetail'];
type PlatformProfileUpdate = components['schemas']['PlatformProfileUpdate'];
type PlatformType = components['schemas']['PlatformType'];
type PlatformTypeCreate = components['schemas']['PlatformTypeCreate'];
type PlatformTypeUpdate = components['schemas']['PlatformTypeUpdate'];
type UploadIntentCreate = components['schemas']['UploadIntentCreate'];

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
  detail: (platformId: string) => (
    ['configuration', 'platforms', 'detail', platformId] as const
  ),
  details: () => ['configuration', 'platforms', 'detail'] as const,
  accounts: (platformId: string) => (
    ['configuration', 'platforms', platformId, 'accounts'] as const
  ),
  promptOptions: () => ['configuration', 'platforms', 'prompt-options'] as const,
  types: () => ['configuration', 'platforms', 'types'] as const,
};

function platformTypeListQueryOptions() {
  return queryOptions({
    queryKey: platformKeys.types(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-types');
      if (!result.data) throw platformRequestError('读取平台类型', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

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

function platformDetailQueryOptions(platformId: string) {
  return queryOptions({
    queryKey: platformKeys.detail(platformId),
    queryFn: async (): Promise<PlatformProfileDetail> => {
      const result = await api.GET('/api/v1/platform-profiles/{platform_profile_id}', {
        params: { path: { platform_profile_id: platformId } },
      });
      if (!result.data) throw platformRequestError('读取平台工作区', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function platformAccountsQueryOptions(platformId: string, enabled: boolean) {
  return queryOptions({
    enabled,
    queryKey: platformKeys.accounts(platformId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-accounts', {
        params: { query: { platform_profile_id: platformId } },
      });
      if (!result.data) throw platformRequestError('读取平台发布账号', result);
      return result.data;
    },
    retry: false,
    staleTime: 30_000,
  });
}

function platformPromptOptionsQueryOptions(enabled: boolean) {
  return queryOptions({
    enabled,
    queryKey: platformKeys.promptOptions(),
    queryFn: async () => {
      const result = await api.GET('/api/v1/platform-prompts');
      if (!result.data) throw platformRequestError('读取 Prompt 选项', result);
      return result.data;
    },
    retry: false,
    staleTime: 30_000,
  });
}

async function updatePlatformProfile(
  platformId: string,
  body: PlatformProfileUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/platform-profiles/{platform_profile_id}', {
    body,
    params: {
      path: { platform_profile_id: platformId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError('更新平台', result);
}

async function createPlatformType(body: PlatformTypeCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/platform-types', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw platformRequestError('创建平台类型', result);
}

async function updatePlatformType(
  platformTypeId: string,
  body: PlatformTypeUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/platform-types/{platform_type_id}', {
    body,
    params: {
      path: { platform_type_id: platformTypeId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError('更新平台类型', result);
}

async function deletePlatformType(platformType: PlatformType, csrfToken: string | null) {
  const result = await api.DELETE('/api/v1/platform-types/{platform_type_id}', {
    params: {
      path: { platform_type_id: platformType.id },
      query: { expected_revision: platformType.revision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.ok) return;
  throw platformRequestError('删除平台类型', result);
}

async function invalidatePlatformTypeConsumers(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: platformKeys.types() }),
    queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: platformKeys.details() }),
  ]);
}

async function createPlatformAccount(
  body: PlatformAccountCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/platform-accounts', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw platformRequestError('创建发布账号', result);
}

async function updatePlatformAccount(
  accountId: string,
  body: PlatformAccountUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/platform-accounts/{platform_account_id}', {
    body,
    params: {
      path: { platform_account_id: accountId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError('更新发布账号', result);
}

async function setPlatformAccountEnabled(
  account: PlatformAccount,
  enabled: boolean,
  csrfToken: string | null,
) {
  const path = enabled
    ? '/api/v1/platform-accounts/{platform_account_id}/enable' as const
    : '/api/v1/platform-accounts/{platform_account_id}/disable' as const;
  const result = await api.POST(path, {
    body: { expected_revision: account.revision },
    params: {
      path: { platform_account_id: account.id },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError(enabled ? '启用发布账号' : '停用发布账号', result);
}

async function deletePlatformAccount(
  account: PlatformAccount,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/platform-accounts/{platform_account_id}', {
    params: {
      path: { platform_account_id: account.id },
      query: { expected_revision: account.revision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.ok) return;
  throw platformRequestError('删除发布账号', result);
}

async function createPlatformLogoCandidate(
  websiteUrl: string,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/platform-logo-candidates', {
    body: { website_url: websiteUrl },
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw platformRequestError('导入官网 Logo 候选', result);
}

async function createPlatformLogoUploadIntent(
  body: UploadIntentCreate,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/files/upload-intents', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw platformRequestError('创建 Logo 上传意图', result);
}

async function completePlatformLogoUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/complete', {
    params: {
      path: { file_id: fileId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError('确认 Logo 上传', result);
}

async function abortPlatformLogoUpload(fileId: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/abort', {
    params: {
      path: { file_id: fileId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw platformRequestError('中止 Logo 上传', result);
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
  abortPlatformLogoUpload,
  completePlatformLogoUpload,
  createPlatformAccount,
  createPlatformLogoCandidate,
  createPlatformLogoUploadIntent,
  createPlatformType,
  deletePlatformAccount,
  deletePlatformType,
  invalidatePlatformTypeConsumers,
  platformAccountsQueryOptions,
  platformDetailQueryOptions,
  platformKeys,
  platformListQueryOptions,
  platformTypeListQueryOptions,
  platformPromptOptionsQueryOptions,
  runPlatformCommand,
  setPlatformAccountEnabled,
  updatePlatformAccount,
  updatePlatformProfile,
  updatePlatformType,
};
