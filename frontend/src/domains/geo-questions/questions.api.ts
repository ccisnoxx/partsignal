import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { questionSearchToParams, type PromptVariant, type QuestionListParams, type QuestionSearch } from './questions.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
class QuestionRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: ErrorDetail) { super(message); this.name = 'QuestionRequestError'; }
}
const questionKeys = {
  root: () => ['geo', 'questions'] as const,
  lists: () => ['geo', 'questions', 'list'] as const,
  list: (params: QuestionListParams) => ['geo', 'questions', 'list', params] as const,
  detail: (id: string) => ['geo', 'questions', 'detail', id] as const,
};
function questionListOptions(search: QuestionSearch) {
  const params = questionSearchToParams(search);
  return queryOptions({ queryKey: questionKeys.list(params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/prompt-variants', { params: { query: params }, signal });
    if (!result.data) throw requestError('读取问题变体列表', result);
    return result.data as components['schemas']['GeoPromptVariantListPage'];
  }, retry: false, retryOnMount: false, staleTime: 30_000 });
}
function questionDetailOptions(id: string, enabled = true) {
  return queryOptions({ enabled, queryKey: questionKeys.detail(id), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/prompt-variants/{variant_id}', { params: { path: { variant_id: id } }, signal });
    if (!result.data) throw requestError('读取问题变体详情', result);
    // openapi-fetch Readable 会删除纯 null 属性；保持 generated 响应合同。
    return result.data as PromptVariant;
  }, retry: false, retryOnMount: false, staleTime: 30_000 });
}
async function createQuestion(body: components['schemas']['GeoPromptVariantCreate'], csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/query-topics/{query_topic_id}/prompt-variants', {
    body, params: { path: { query_topic_id: body.query_topic_id }, header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('创建问题变体', result);
  return result.data as PromptVariant;
}
async function updateQuestion(id: string, body: components['schemas']['GeoPromptVariantUpdate'], csrfToken: string | null) {
  const result = await api.PATCH('/api/v1/geo/prompt-variants/{variant_id}', { body, params: { path: { variant_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('保存问题变体', result);
  return result.data as PromptVariant;
}
async function setQuestionActive(id: string, revision: number, active: boolean, csrfToken: string | null) {
  const path = active ? '/api/v1/geo/prompt-variants/{variant_id}/enable' as const : '/api/v1/geo/prompt-variants/{variant_id}/disable' as const;
  const result = await api.POST(path, { body: { expected_revision: revision }, params: { path: { variant_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError(active ? '启用问题变体' : '停用问题变体', result);
  return result.data as PromptVariant;
}
async function deleteQuestion(id: string, revision: number, csrfToken: string | null) {
  const result = await api.DELETE('/api/v1/geo/prompt-variants/{variant_id}', { params: { path: { variant_id: id }, query: { expected_revision: revision }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (result.response.status !== 204) throw requestError('删除问题变体', result);
}
function csrf(value: string | null) { if (value) return value; throw new QuestionRequestError('缺少会话安全令牌，无法管理问题变体'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function requestError(action: string, result: { error?: unknown; response: Response }) {
  const body = result.error;
  if (isRecord(body) && isRecord(body.error)) {
    const detail = body.error;
    if (typeof detail.code === 'string' && typeof detail.message === 'string' && typeof detail.request_id === 'string' && isRecord(detail.details)) {
      return new QuestionRequestError(`${detail.message}（请求 ID：${detail.request_id}）`, result.response.status, detail as ErrorDetail);
    }
  }
  return new QuestionRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
export { createQuestion, deleteQuestion, QuestionRequestError, questionDetailOptions, questionKeys, questionListOptions, setQuestionActive, updateQuestion };
