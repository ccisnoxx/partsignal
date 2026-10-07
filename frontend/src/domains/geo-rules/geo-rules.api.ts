import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { parseGeoRulePreview, parseGeoRuleSet } from './geo-rules.model';

class GeoRulesRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: components['schemas']['ErrorDetail']) {
    super(message); this.name = 'GeoRulesRequestError';
  }
}
const geoRulesKey = ['configuration', 'geo-rules', 'current'] as const;

function requestError(action: string, result: { error?: unknown; response: Response }) {
  const envelope = result.error;
  if (envelope && typeof envelope === 'object' && 'error' in envelope) {
    const detail = envelope.error;
    if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
      && 'code' in detail && typeof detail.code === 'string' && 'request_id' in detail && typeof detail.request_id === 'string'
      && 'details' in detail && detail.details && typeof detail.details === 'object' && !Array.isArray(detail.details)) {
      return new GeoRulesRequestError(`${detail.message}（请求 ID：${detail.request_id}）`, result.response.status, detail as components['schemas']['ErrorDetail']);
    }
  }
  return new GeoRulesRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
function requireToken(token: string | null) {
  if (!token) throw new GeoRulesRequestError('缺少会话安全令牌，请重新登录后操作');
  return token;
}
async function getGeoRules(signal?: AbortSignal) {
  const result = await api.GET('/api/v1/geo/rules', { signal });
  if (!result.data) throw requestError('读取 GEO 规则', result);
  return parseGeoRuleSet(result.data);
}
function geoRulesQueryOptions() {
  return queryOptions({ queryKey: geoRulesKey, queryFn: ({ signal }) => getGeoRules(signal), retry: false, retryOnMount: false, staleTime: 30000, refetchOnWindowFocus: false });
}
async function updateGeoRules(body: components['schemas']['GeoRuleUpdateRequest'], token: string | null) {
  const result = await api.PUT('/api/v1/geo/rules', { body, params: { header: { 'X-CSRF-Token': requireToken(token) } } });
  if (!result.data) throw requestError('保存 GEO 规则', result);
  return parseGeoRuleSet(result.data);
}
async function previewGeoRules(body: components['schemas']['GeoRulePreviewRequest'], token: string | null, signal: AbortSignal) {
  const result = await api.POST('/api/v1/geo/rules/preview', { body, signal, params: { header: { 'X-CSRF-Token': requireToken(token) } } });
  if (!result.data) throw requestError('预览 GEO 规则', result);
  return parseGeoRulePreview(result.data);
}
function geoRulesErrorMessage(error: unknown) { return error instanceof Error ? error.message : 'GEO 规则操作发生未知错误'; }
export { GeoRulesRequestError, geoRulesErrorMessage, geoRulesKey, geoRulesQueryOptions, getGeoRules, previewGeoRules, updateGeoRules };
