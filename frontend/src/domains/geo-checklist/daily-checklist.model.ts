import type { components } from '@/shared/api/generated/schema';

export type PromptCategory = components['schemas']['GeoPromptCategory'];
export type RunStatus = components['schemas']['GeoRunStatus'];
export type ManualFailCode = components['schemas']['GeoManualFailCode'];

export const promptCategoryLabels: Record<PromptCategory, string> = {
  NATURAL_DEMAND: '自然需求',
  BRAND_MODEL: '品牌/型号',
  ARTICLE_LOOKUP: '文章定位核查',
};

export const runStatusLabels: Record<RunStatus, string> = {
  PENDING: '待采集',
  RUNNING: '采集中',
  COLLECTED: '已采集待分析',
  ANALYZING: '分析中',
  NEEDS_REVIEW: '待判断',
  COMPLETED: '已完成',
  FAILED: '采集异常',
  CANCELLED: '已取消',
  BUDGET_BLOCKED: '预算拦截',
};

export const manualFailLabels: Record<ManualFailCode, string> = {
  MANUAL_TIMEOUT: '页面超时',
  MANUAL_PLATFORM_UNAVAILABLE: '平台不可用',
  MANUAL_ANSWER_UNAVAILABLE: '回答不可用/中断',
  MANUAL_ACCESS_BLOCKED: '访问受限/风控',
  MANUAL_OTHER: '其他采集异常',
};

export const linkStatusLabels: Record<string, string> = {
  AUTO_EXACT: '精确 URL 自动命中',
  CANDIDATE: '候选匹配（待确认）',
  CONFIRMED: '已人工确认',
  REJECTED: '已驳回',
};

export function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function makeIdempotencyKey(runId: string): string {
  return `manual-${runId.slice(0, 8)}-${Date.now()}`;
}
