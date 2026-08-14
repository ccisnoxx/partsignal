import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  aiChannelSearchToApiParams,
  type AIChannelCommand,
  type AIChannelSearch,
} from './ai-channel-list.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type AIChannel = components['schemas']['AIChannel'];
type AIChannelCreate = components['schemas']['AIChannelCreate'];
type AIChannelUpdate = components['schemas']['AIChannelUpdate'];
type AIChannelHeaderCreate = components['schemas']['AIChannelHeaderCreate'];
type AIChannelHeaderUpdate = components['schemas']['AIChannelHeaderUpdate'];
type AIChannelCommandTarget = Pick<AIChannel, 'id' | 'revision'>;

class AIChannelRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'AIChannelRequestError';
  }
}

const aiChannelKeys = {
  lists: () => ['configuration', 'ai-channels', 'list'] as const,
  list: (params: ReturnType<typeof aiChannelSearchToApiParams>) => (
    ['configuration', 'ai-channels', 'list', params] as const
  ),
  details: () => ['configuration', 'ai-channels', 'detail'] as const,
  detail: (channelId: string) => ['configuration', 'ai-channels', 'detail', channelId] as const,
  models: (channelId: string) => ['configuration', 'ai-channels', 'models', channelId] as const,
  logs: (channelId: string) => ['configuration', 'ai-channels', 'logs', channelId] as const,
};

function aiChannelListQueryOptions(search: AIChannelSearch) {
  const params = aiChannelSearchToApiParams(search);
  return queryOptions({
    queryKey: aiChannelKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/ai-channels', { params: { query: params } });
      if (!result.data) throw aiChannelRequestError('读取 AI 渠道列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function aiChannelDetailQueryOptions(channelId: string) {
  return queryOptions({
    queryKey: aiChannelKeys.detail(channelId),
    queryFn: async () => {
      const result = await api.GET('/api/v1/ai-channels/{channel_id}', {
        params: { path: { channel_id: channelId } },
      });
      if (!result.data) throw aiChannelRequestError('读取 AI 渠道详情', result);
      return result.data;
    },
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function createAIChannel(payload: AIChannelCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/ai-channels', {
    body: payload,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError('创建 AI 渠道', result);
}

async function updateAIChannel(
  channelId: string,
  payload: AIChannelUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/ai-channels/{channel_id}', {
    body: payload,
    params: {
      path: { channel_id: channelId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError('更新 AI 渠道', result);
}

async function replaceAIChannelApiKey(
  channel: AIChannelCommandTarget,
  apiKey: string,
  csrfToken: string | null,
) {
  const result = await api.PUT('/api/v1/ai-channels/{channel_id}/api-key', {
    body: { expected_revision: channel.revision, api_key: apiKey },
    params: {
      path: { channel_id: channel.id },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError('重新配置 API Key', result);
}

async function createAIChannelHeader(
  channel: AIChannelCommandTarget,
  payload: Omit<AIChannelHeaderCreate, 'expected_channel_revision'>,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/ai-channels/{channel_id}/headers', {
    body: { ...payload, expected_channel_revision: channel.revision },
    params: {
      path: { channel_id: channel.id },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError('创建 AI 渠道 Header', result);
}

async function updateAIChannelHeader(
  channel: AIChannelCommandTarget,
  headerId: string,
  payload: Omit<AIChannelHeaderUpdate, 'expected_channel_revision'>,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/ai-channel-headers/{header_id}', {
    body: { ...payload, expected_channel_revision: channel.revision },
    params: {
      path: { header_id: headerId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError('更新 AI 渠道 Header', result);
}

async function deleteAIChannelHeader(
  channel: AIChannelCommandTarget,
  headerId: string,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/ai-channel-headers/{header_id}', {
    params: {
      path: { header_id: headerId },
      query: { expected_channel_revision: channel.revision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.ok) return;
  throw aiChannelRequestError('删除 AI 渠道 Header', result);
}

async function runAIChannelCommand(
  command: AIChannelCommand,
  channel: AIChannelCommandTarget,
  csrfToken: string | null,
) {
  const token = requireCsrfToken(csrfToken);
  if (command === 'delete-channel') {
    const result = await api.DELETE('/api/v1/ai-channels/{channel_id}', {
      params: {
        path: { channel_id: channel.id },
        query: { expected_revision: channel.revision },
        header: { 'X-CSRF-Token': token },
      },
    });
    if (result.response.ok) return;
    throw aiChannelRequestError('删除 AI 渠道', result);
  }
  const path = command === 'enable-channel'
    ? '/api/v1/ai-channels/{channel_id}/enable' as const
    : '/api/v1/ai-channels/{channel_id}/disable' as const;
  const result = await api.POST(path, {
    body: { expected_revision: channel.revision },
    params: {
      path: { channel_id: channel.id },
      header: { 'X-CSRF-Token': token },
    },
  });
  if (result.data) return result.data;
  throw aiChannelRequestError(command === 'enable-channel' ? '启用 AI 渠道' : '停用 AI 渠道', result);
}

function requireCsrfToken(csrfToken: string | null) {
  if (csrfToken) return csrfToken;
  throw new AIChannelRequestError('缺少会话安全令牌，无法管理 AI 渠道');
}

function aiChannelRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new AIChannelRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new AIChannelRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
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
  AIChannelRequestError,
  aiChannelDetailQueryOptions,
  aiChannelKeys,
  aiChannelListQueryOptions,
  createAIChannel,
  createAIChannelHeader,
  deleteAIChannelHeader,
  replaceAIChannelApiKey,
  runAIChannelCommand,
  updateAIChannel,
  updateAIChannelHeader,
};
