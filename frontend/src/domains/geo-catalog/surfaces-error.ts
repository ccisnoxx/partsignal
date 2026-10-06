import type { components } from '@/shared/api/generated/schema';
type ErrorDetail = components['schemas']['ErrorDetail'];
class SurfacesRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: ErrorDetail) {
    super(message); this.name = 'SurfacesRequestError';
  }
}
function surfacesRequestError(action: string, result: { error?: unknown; response: Response }) {
  const envelope = result.error;
  if (envelope && typeof envelope === 'object' && Object.keys(envelope).length === 1 && 'error' in envelope) {
    const detail = envelope.error;
    if (detail && typeof detail === 'object' && Object.keys(detail).length === 4 && 'code' in detail && typeof detail.code === 'string' && 'message' in detail && typeof detail.message === 'string' && 'request_id' in detail && typeof detail.request_id === 'string' && 'details' in detail && detail.details && typeof detail.details === 'object' && !Array.isArray(detail.details)) {
      const known = detail as ErrorDetail;
      return new SurfacesRequestError(`${known.message}（请求 ID：${known.request_id}）`, result.response.status, known);
    }
  }
  return new SurfacesRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
function surfacesErrorMessage(error: unknown) { return error instanceof Error ? error.message : 'GEO 配置发生未知错误'; }
function requireSurfacesCsrf(token: string | null) {
  if (!token) throw new SurfacesRequestError('缺少会话安全令牌，无法管理 GEO 配置');
  return token;
}
export { SurfacesRequestError, surfacesRequestError, surfacesErrorMessage, requireSurfacesCsrf };
