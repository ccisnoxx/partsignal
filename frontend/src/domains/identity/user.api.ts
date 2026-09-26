import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuid, canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import {
  userSearchToApiParams,
  type User,
  type UserCreateFormValues,
  type UserEditFormValues,
  type UserSearch,
  type UserStatus,
} from './user-list.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type UserBulkStatusItem = components['schemas']['UserBulkStatusItem'];

class UserRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'UserRequestError';
  }
}

class UserBulkStatusUnknownOutcomeError extends Error {
  constructor(readonly originalError: unknown) {
    super('批量更新用户状态的服务端提交结果未知');
    this.name = 'UserBulkStatusUnknownOutcomeError';
  }
}

const bulkStatusResultSchema = z.strictObject({
  failures: z.array(z.strictObject({
    code: z.enum(['NOT_FOUND', 'REVISION_CONFLICT', 'LAST_ADMIN_REQUIRED', 'INVALID_STATE_TRANSITION']),
    message: z.string(),
    user_id: canonicalUuidSchema,
  })),
  succeeded: z.array(z.strictObject({
    account_type: z.enum(['ADMIN', 'ENGINEER']),
    available_actions: z.array(z.enum(['UPDATE', 'RESET_PASSWORD', 'ENABLE', 'DISABLE', 'DELETE'])),
    created_at: z.iso.datetime({ offset: true }),
    deletion: z.strictObject({
      blockers: z.array(z.strictObject({
        count: z.number().int().positive(),
        type: z.enum([
          'FACT_VERSION',
          'CONTENT_TASK',
          'GEO_OBSERVATION',
          'CONTENT_VERSION',
          'GENERATION_JOB',
          'PUBLISHED_ARTICLE',
          'PLATFORM_PROFILE',
          'PLATFORM_ACCOUNT',
          'PUBLICATION_WORK',
          'PROTECTED_CONTENT_VERSION',
          'PUBLISHED_CONTENT_ISSUE',
          'GEO_OPTIMIZATION_SOURCE',
          'USER_BUSINESS_HISTORY',
        ]),
      })),
    }).nullable(),
    display_name: z.string(),
    id: canonicalUuidSchema,
    is_active: z.boolean(),
    must_change_password: z.boolean(),
    primary_task: z.enum(['MANAGE_LOGIN_SECURITY', 'MANAGE_USER', 'ENABLE_USER']),
    revision: z.number().int(),
    username: z.string(),
    workflow_stage: z.enum(['FIRST_PASSWORD_CHANGE', 'ACTIVE', 'DISABLED']),
  })),
});

const bulkStatusRequestSchema = z.strictObject({
  items: z.array(z.strictObject({
    expected_revision: z.number().int().nonnegative(),
    user_id: canonicalUuidSchema,
  })).min(1).max(100),
  status: z.enum(['ENABLED', 'DISABLED']),
}).superRefine(({ items }, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.user_id)) {
      context.addIssue({
        code: 'custom',
        message: '批量状态命令中的 user_id 必须唯一',
        path: ['items', index, 'user_id'],
      });
    }
    seen.add(item.user_id);
  });
});

const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    details: z.record(z.string(), z.unknown()),
    message: z.string(),
    request_id: z.string(),
  }),
});

const userKeys = {
  lists: () => ['identity', 'users', 'list'] as const,
  list: (params: ReturnType<typeof userSearchToApiParams>) => (
    ['identity', 'users', 'list', params] as const
  ),
};

function userListQueryOptions(search: UserSearch) {
  const params = userSearchToApiParams(search);
  return queryOptions({
    queryKey: userKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/users', { params: { query: params } });
      if (!result.data) throw userRequestError('读取用户列表', result);
      return {
        ...result.data,
        items: result.data.items.map(canonicalUser),
      };
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function createUser(payload: UserCreateFormValues, csrfToken: string | null) {
  const result = await api.POST('/api/v1/users', {
    body: payload,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return canonicalUser(result.data);
  throw userRequestError('创建用户', result);
}

async function updateUser(
  user: User,
  payload: UserEditFormValues,
  csrfToken: string | null,
  signal?: AbortSignal,
) {
  const result = await api.PATCH('/api/v1/users/{user_id}', {
    body: { ...payload, expected_revision: user.revision },
    params: {
      path: { user_id: canonicalUuid(user.id) },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
    ...(signal ? { signal } : {}),
  });
  if (result.data) return canonicalUser(result.data);
  throw userRequestError('更新用户', result);
}

async function resetUserPassword(
  user: User,
  temporaryPassword: string,
  csrfToken: string | null,
  signal?: AbortSignal,
) {
  const result = await api.POST('/api/v1/users/{user_id}/reset-password', {
    body: { temporary_password: temporaryPassword, expected_revision: user.revision },
    params: {
      path: { user_id: canonicalUuid(user.id) },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
    ...(signal ? { signal } : {}),
  });
  if (result.data) return canonicalUser(result.data);
  throw userRequestError('重置临时密码', result);
}

async function setUserEnabled(
  user: User,
  enabled: boolean,
  csrfToken: string | null,
  signal?: AbortSignal,
) {
  return updateUser(
    user,
    {
      display_name: user.display_name,
      account_type: user.account_type,
      is_active: enabled,
    },
    csrfToken,
    signal,
  );
}

async function deleteUser(
  { id, expectedRevision }: { id: string; expectedRevision: number },
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/users/{user_id}', {
    params: {
      path: { user_id: canonicalUuid(id) },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.ok) return;
  throw userRequestError('删除用户', result);
}

async function bulkUpdateUserStatus(
  items: UserBulkStatusItem[],
  status: UserStatus,
  csrfToken: string | null,
) {
  const request = bulkStatusRequestSchema.safeParse({ items, status });
  if (!request.success) {
    throw new UserRequestError('批量更新用户状态请求结构无效');
  }
  const token = requireCsrfToken(csrfToken);
  const result = await (async () => {
    try {
      return await api.POST('/api/v1/users/bulk-status', {
        body: request.data,
        params: { header: { 'X-CSRF-Token': token } },
      });
    } catch (error) {
      throw new UserBulkStatusUnknownOutcomeError(error);
    }
  })();
  if (result.response.status === 200) {
    const parsed = bulkStatusResultSchema.safeParse(result.data);
    if (!parsed.success) throw new UserBulkStatusUnknownOutcomeError(parsed.error);
    const semanticError = bulkStatusSemanticError(parsed.data, request.data.items, request.data.status);
    if (semanticError) throw new UserBulkStatusUnknownOutcomeError(semanticError);
    return parsed.data;
  }
  if ([400, 401, 403, 422].includes(result.response.status)) {
    const parsed = errorEnvelopeSchema.safeParse(result.error);
    if (parsed.success) {
      const detail: ErrorDetail = parsed.data.error;
      throw new UserRequestError(
        `${detail.message}（请求 ID：${detail.request_id}）`,
        result.response.status,
        detail,
      );
    }
  }
  throw new UserBulkStatusUnknownOutcomeError(
    new Error(`批量更新用户状态收到无法分类的 HTTP ${result.response.status}`),
  );
}

function bulkStatusSemanticError(
  result: z.infer<typeof bulkStatusResultSchema>,
  items: UserBulkStatusItem[],
  status: UserStatus,
) {
  const requestedIds = new Set(items.map((item) => item.user_id));
  const observedIds = new Set<string>();
  const expectedActive = status === 'ENABLED';

  for (const user of result.succeeded) {
    if (!requestedIds.has(user.id)) {
      return new Error(`批量状态响应包含请求外成功项：${user.id}`);
    }
    if (observedIds.has(user.id)) {
      return new Error(`批量状态响应重复报告用户：${user.id}`);
    }
    if (user.is_active !== expectedActive) {
      return new Error(`批量状态成功项未达到目标状态：${user.id}`);
    }
    observedIds.add(user.id);
  }

  for (const failure of result.failures) {
    if (!requestedIds.has(failure.user_id)) {
      return new Error(`批量状态响应包含请求外失败项：${failure.user_id}`);
    }
    if (observedIds.has(failure.user_id)) {
      return new Error(`批量状态响应重复或交叉报告用户：${failure.user_id}`);
    }
    observedIds.add(failure.user_id);
  }

  if (observedIds.size !== requestedIds.size) {
    return new Error('批量状态响应未精确覆盖全部请求用户');
  }
  return null;
}

async function exportUsers(search: UserSearch) {
  const params = userSearchToApiParams(search);
  const result = await api.GET('/api/v1/users/export', {
    params: {
      query: {
        q: params.q,
        account_type: params.account_type,
        status: params.status,
      },
    },
    parseAs: 'blob',
  });
  if (!result.data) throw userRequestError('导出用户列表', result);
  const disposition = result.response.headers.get('Content-Disposition');
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  return {
    blob: result.data instanceof Blob
      ? result.data
      : new Blob([result.data], { type: 'text/csv;charset=utf-8' }),
    fileName: encodedName ? decodeURIComponent(encodedName) : plainName ?? 'users.csv',
  };
}

function requireCsrfToken(csrfToken: string | null) {
  if (csrfToken) return csrfToken;
  throw new UserRequestError('缺少会话安全令牌，无法管理用户');
}

function canonicalUser(user: User): User {
  return { ...user, id: canonicalUuid(user.id) };
}

function userRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new UserRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new UserRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
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
  UserBulkStatusUnknownOutcomeError,
  UserRequestError,
  bulkUpdateUserStatus,
  createUser,
  deleteUser,
  exportUsers,
  resetUserPassword,
  setUserEnabled,
  updateUser,
  userKeys,
  userListQueryOptions,
};
