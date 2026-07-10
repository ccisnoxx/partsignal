/** 基于 OpenAPI 生成类型的唯一 HTTP 边界，统一会话、CSRF 和错误语义。 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

export const csrfHeader = (): { 'X-CSRF-Token': string } => ({
  'X-CSRF-Token': csrfToken ?? '',
});

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && csrfToken) {
      request.headers.set('X-CSRF-Token', csrfToken);
    }
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401 && csrfToken) {
      csrfToken = null;
      globalThis.dispatchEvent(new Event('partsignal:auth-expired'));
    }
    return response;
  },
};

export const api = createClient<paths>({
  // 契约路径已包含 `/api`，同源部署不得再追加 `/api` 前缀。
  baseUrl: import.meta.env.VITE_API_BASE_URL || globalThis.location?.origin || 'http://localhost',
  credentials: 'include',
  fetch: (request: Request) => globalThis.fetch(request),
});

api.use(csrfMiddleware);

type ErrorPayload = { error?: { code?: string; message?: string; request_id?: string } };

export function unwrap<T>(result: { data?: T; error?: ErrorPayload; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const detail = result.error?.error;
  throw new ApiError(detail?.message ?? `请求失败（HTTP ${result.response.status}）`, detail?.code ?? 'HTTP_ERROR', detail?.request_id);
}

export function ensureSuccess(result: { error?: ErrorPayload; response: Response }): void {
  if (result.response.ok) return;
  const detail = result.error?.error;
  throw new ApiError(detail?.message ?? `请求失败（HTTP ${result.response.status}）`, detail?.code ?? 'HTTP_ERROR', detail?.request_id);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
