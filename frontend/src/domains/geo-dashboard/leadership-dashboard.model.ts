import type { components } from '@/shared/api/generated/schema';

type RateCi = components['schemas']['GeoRateCiOut'];
type DiffCi = components['schemas']['GeoDiffCiOut'];

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '暂无数据';
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatDeltaPp(deltaPp: number | null | undefined): string {
  if (deltaPp === null || deltaPp === undefined) return '暂无上期对比';
  const sign = deltaPp > 0 ? '+' : '';
  return `较上期 ${sign}${deltaPp.toFixed(1)} 个百分点`;
}

export function formatCi(ci: RateCi | null | undefined): string | null {
  if (!ci) return null;
  return `95% CI ${(ci.lower * 100).toFixed(1)}%–${(ci.upper * 100).toFixed(1)}% (n=${ci.sample_size})`;
}

export function formatDiffCi(ci: DiffCi | null | undefined): string | null {
  if (!ci) return null;
  const sig = ci.excludes_zero ? '统计显著' : '样本波动区间含 0';
  return `差值 CI [${ci.lower_pp.toFixed(1)}, ${ci.upper_pp.toFixed(1)}] pp · ${sig}`;
}

export function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildPresetDateInputs(days: number): { fromDate: string; toDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(days - 1, 0) * 86_400_000);
  return { fromDate: formatDateInput(start), toDate: formatDateInput(end) };
}

export function dateInputToStartIso(dateStr: string): string {
  return `${dateStr}T00:00:00Z`;
}

export function dateInputToEndIso(dateStr: string): string {
  return `${dateStr}T23:59:59Z`;
}

export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const collectionModeLabels: Record<string, string> = {
  MANUAL: '人工录入',
  API: 'API 采集',
  BROWSER: '浏览器采集',
};

export const runStatusLabels: Record<string, string> = {
  COMPLETED: '已完成',
  NEEDS_REVIEW: '待判断',
  PENDING: '待采集',
  RUNNING: '进行中',
  FAILED: '采集异常',
  CANCELLED: '已取消',
};

export const linkStatusLabels: Record<string, string> = {
  AUTO_EXACT: '精确 URL 自动匹配',
  CONFIRMED: '人工已确认',
  CANDIDATE: '待确认候选',
  REJECTED: '已排除',
};

export const verificationStatusLabels: Record<string, string> = {
  MANUAL_RECORDED: '人工登记',
  AUTO_VERIFIED: '系统核验通过',
  MANUAL_VERIFIED: '人工复核通过',
  LINK_BROKEN: '链接异常',
};

export const snapshotKindLabels: Record<string, string> = {
  WEEKLY: '周报快照',
  MONTHLY: '月报快照',
  CUSTOM: '阶段快照',
};

export const citationObsLabels: Record<string, string> = {
  OBSERVED_COMPLETE: '已完整检查引用',
  PARTIAL: '仅部分可见',
  UNKNOWN: '未检查引用',
};
