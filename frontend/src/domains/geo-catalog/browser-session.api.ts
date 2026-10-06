import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuid } from '@/shared/lib/canonical-uuid';

type BrowserSessionContext = components['schemas']['GeoBrowserSessionContext'];
type BrowserSessionAction = BrowserSessionContext['available_actions'][number];
type BrowserSessionImport = components['schemas']['GeoBrowserSessionImport'];
type BrowserSessionCommand = components['schemas']['GeoBrowserSessionCommand'];

const contextSchema = z.strictObject({
  profile_id: z.uuid(), profile_revision: z.number().int().nonnegative(),
  session: z.strictObject({
    session_reference: z.uuid(), health: z.enum(['AVAILABLE', 'EXPIRED', 'REVOKED', 'MISSING', 'UNREADABLE']),
    expires_at: z.iso.datetime({ offset: true }), imported_at: z.iso.datetime({ offset: true }),
    last_checked_at: z.iso.datetime({ offset: true }), revoked_at: z.iso.datetime({ offset: true }).nullable(),
    purged_at: z.iso.datetime({ offset: true }).nullable(),
  }).nullable(),
  cleanup_pending_count: z.number().int().nonnegative(),
  available_actions: z.array(z.enum(['IMPORT', 'CHECK_HEALTH', 'REVOKE', 'PURGE'])).refine((actions) => new Set(actions).size === actions.length),
  login_probe: z.literal('NOT_IMPLEMENTED'),
}) satisfies z.ZodType<BrowserSessionContext>;

const errorMessages = {
  AUTH_REQUIRED: '登录会话已失效，请重新登录。',
  PERMISSION_DENIED: '当前账号无权管理浏览器会话。',
  PASSWORD_CHANGE_REQUIRED: '请先完成密码修改。',
  CSRF_INVALID: '会话安全令牌已失效，请重新登录。',
  NOT_FOUND: '采集配置或会话已不存在。',
  REVISION_CONFLICT: '配置已经变化，请重新读取并重新确认。',
  GEO_BROWSER_PROFILE_REQUIRED: '当前采集配置不再是浏览器模式。',
  GEO_BROWSER_SESSION_IMPORT_FORBIDDEN: '当前观测面不允许导入浏览器会话。',
  GEO_BROWSER_SESSION_REVOKED: '此会话已撤销，只能通过新导入恢复。',
  GEO_BROWSER_SESSION_INVALID: '会话文件或有效期不符合要求，请检查后重新选择。',
  VALIDATION_ERROR: '导入文件、有效期或确认信息不符合要求。',
  DEPENDENCY_UNAVAILABLE: '受保护会话存储尚不可用，请联系管理员配置。',
} as const;

class BrowserSessionRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly requiresReload = false) { super(message); this.name = 'BrowserSessionRequestError'; }
}

function safeError(result: { error?: unknown; response: Response }) {
  const envelope = result.error;
  const code = envelope && typeof envelope === 'object' && 'error' in envelope
    && envelope.error && typeof envelope.error === 'object' && 'code' in envelope.error ? envelope.error.code : undefined;
  // 该边界只保留固定错误文案和状态；不让服务端校验回显进入 Error、cache 或 DOM。
  const message = typeof code === 'string' && Object.hasOwn(errorMessages, code)
    ? errorMessages[code as keyof typeof errorMessages] : `浏览器会话请求失败（HTTP ${result.response.status}）。`;
  return new BrowserSessionRequestError(message, result.response.status, result.response.status >= 500 || result.response.status < 400);
}

async function safeContext(id: string, request: () => Promise<{ data?: unknown; error?: unknown; response: Response }>) {
  try {
    const result = await request();
    if (!result.data) throw safeError(result);
    const parsed = contextSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.profile_id !== canonicalUuid(id)) throw new BrowserSessionRequestError('浏览器会话响应结构无效，请重新读取。', undefined, true);
    return parsed.data;
  } catch (error) {
    if (error instanceof BrowserSessionRequestError) throw error;
    throw new BrowserSessionRequestError('浏览器会话请求未完成，请重新读取以核实结果。', undefined, true);
  }
}

function params(id: string, token: string | null) {
  if (!token) throw new BrowserSessionRequestError('缺少会话安全令牌，无法管理浏览器会话。');
  return { path: { profile_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': token } };
}

const browserSessionKeys = { context: (id: string) => ['geo', 'surface-management', 'browser-session', canonicalUuid(id)] as const };
function browserSessionQueryOptions(id: string) {
  return queryOptions({ queryKey: browserSessionKeys.context(id), retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always',
    queryFn: async ({ signal, client }) => {
      const continuation = capturePrincipalContinuation(client);
      const context = await safeContext(id, () => api.GET('/api/v1/geo/collection-profiles/{profile_id}/browser-session', { params: { path: { profile_id: canonicalUuid(id) } }, signal }));
      continuation.assertCurrent(); signal.throwIfAborted();
      return context;
    },
  });
}
async function importBrowserSession(id: string, body: BrowserSessionImport, token: string | null, signal?: AbortSignal) {
  const parameters = params(id, token);
  return safeContext(id, () => api.POST('/api/v1/geo/collection-profiles/{profile_id}/browser-session/import', { params: parameters, body, signal }));
}
async function checkBrowserSessionHealth(id: string, body: BrowserSessionCommand, token: string | null, signal?: AbortSignal) {
  const parameters = params(id, token);
  return safeContext(id, () => api.POST('/api/v1/geo/collection-profiles/{profile_id}/browser-session/health', { params: parameters, body, signal }));
}
async function revokeBrowserSession(id: string, body: BrowserSessionCommand, token: string | null, signal?: AbortSignal) {
  const parameters = params(id, token);
  return safeContext(id, () => api.POST('/api/v1/geo/collection-profiles/{profile_id}/browser-session/revoke', { params: parameters, body, signal }));
}
async function purgeBrowserSessions(id: string, expectedRevision: number, token: string | null, signal?: AbortSignal) {
  const parameters = params(id, token);
  return safeContext(id, () => api.POST('/api/v1/geo/collection-profiles/{profile_id}/browser-session/purge', { params: parameters, body: { expected_revision: expectedRevision }, signal }));
}

export { browserSessionKeys, browserSessionQueryOptions, importBrowserSession, checkBrowserSessionHealth, revokeBrowserSession, purgeBrowserSessions, BrowserSessionRequestError };
export type { BrowserSessionAction, BrowserSessionContext };
