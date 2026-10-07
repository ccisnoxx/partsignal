import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { planSearchToParams, type PlanCreate, type PlanDetail, type PlanListParams, type PlanPreview, type PlanSearch } from './plans.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
class PlanRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: ErrorDetail) { super(message); this.name = 'PlanRequestError'; }
}
const planKeys = {
  root: () => ['geo', 'plans'] as const,
  lists: () => ['geo', 'plans', 'list'] as const,
  list: (params: PlanListParams) => ['geo', 'plans', 'list', params] as const,
  detail: (id: string) => ['geo', 'plans', 'detail', id] as const,
  options: (kind: 'subjects' | 'prompts' | 'profiles', q: string, page: number) => ['geo', 'plans', 'options', kind, q, page] as const,
};
function planListOptions(search: PlanSearch) {
  const params = planSearchToParams(search);
  return queryOptions({ queryKey: planKeys.list(params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/monitoring-plans', { params: { query: params }, signal });
    if (!result.data) throw requestError('读取监测计划列表', result);
    return result.data as components['schemas']['GeoMonitoringPlanListPage'];
  }, retry: false, retryOnMount: false, staleTime: 30_000 });
}
function planDetailOptions(id: string, enabled = true) {
  return queryOptions({ enabled, queryKey: planKeys.detail(id), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/monitoring-plans/{plan_id}', { params: { path: { plan_id: id } }, signal });
    if (!result.data) throw requestError('读取监测计划详情', result);
    return result.data as PlanDetail;
  }, retry: false, retryOnMount: false, staleTime: 30_000 });
}
async function previewPlan(body: PlanCreate, csrfToken: string | null, signal?: AbortSignal) {
  const result = await api.POST('/api/v1/geo/monitoring-plans/preview', { body, signal, params: { header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('预览监测计划', result);
  return result.data as PlanPreview;
}
async function createPlan(body: PlanCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/monitoring-plans', { body, params: { header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('创建监测计划', result);
  return result.data as PlanDetail;
}
async function updatePlan(id: string, body: components['schemas']['GeoMonitoringPlanUpdate'], csrfToken: string | null) {
  const result = await api.PATCH('/api/v1/geo/monitoring-plans/{plan_id}', { body, params: { path: { plan_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('保存监测计划', result);
  return result.data as PlanDetail;
}
type PlanStatusCommand = 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'ARCHIVE';
const commandPaths = { ACTIVATE: '/api/v1/geo/monitoring-plans/{plan_id}/activate', PAUSE: '/api/v1/geo/monitoring-plans/{plan_id}/pause', RESUME: '/api/v1/geo/monitoring-plans/{plan_id}/resume', ARCHIVE: '/api/v1/geo/monitoring-plans/{plan_id}/archive' } as const;
async function changePlanStatus(id: string, revision: number, action: PlanStatusCommand, csrfToken: string | null) {
  const result = await api.POST(commandPaths[action], { body: { expected_revision: revision }, params: { path: { plan_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('改变监测计划状态', result);
  return result.data as PlanDetail;
}
async function copyPlan(id: string, revision: number, name: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/monitoring-plans/{plan_id}/copy', { body: { expected_revision: revision, name }, params: { path: { plan_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (!result.data) throw requestError('复制监测计划', result);
  return result.data as PlanDetail;
}
async function deletePlan(id: string, revision: number, csrfToken: string | null) {
  const result = await api.DELETE('/api/v1/geo/monitoring-plans/{plan_id}', { params: { path: { plan_id: id }, query: { expected_revision: revision }, header: { 'X-CSRF-Token': csrf(csrfToken) } } });
  if (result.response.status !== 204) throw requestError('删除监测计划', result);
  // 完整消费204，避免已成功的空响应在浏览器中被误判为取消。
  await result.response.arrayBuffer();
}
function csrf(value: string | null) { if (value) return value; throw new PlanRequestError('缺少会话安全令牌，无法管理监测计划'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function requestError(action: string, result: { error?: unknown; response: Response }) {
  const body = result.error;
  if (isRecord(body) && isRecord(body.error)) {
    const detail = body.error;
    if (typeof detail.code === 'string' && typeof detail.message === 'string' && typeof detail.request_id === 'string' && isRecord(detail.details)) {
      const message = detail.code === 'GEO_PLAN_CRON_UNSUPPORTED' ? 'V1.0 不支持定时调度（CRON），历史计划只读，不能修改或运行。' : detail.message;
      const code = detail.code === 'GEO_PLAN_CRON_UNSUPPORTED' ? `${detail.code}；` : '';
      return new PlanRequestError(`${message}（${code}请求 ID：${detail.request_id}）`, result.response.status, detail as ErrorDetail);
    }
  }
  return new PlanRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
export { changePlanStatus, copyPlan, createPlan, deletePlan, PlanRequestError, planDetailOptions, planKeys, planListOptions, previewPlan, requestError, updatePlan };
export type { PlanStatusCommand };
