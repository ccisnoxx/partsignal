import type { components } from '@/shared/api/generated/schema';
import { metricLabels } from '@/shared/lib/geo-metric-labels';
import {
  opportunityActionTypeLabels,
  statusLabels as opportunityStatusLabels,
} from '@/shared/lib/geo-opportunity-labels';

export type GeoInterventionOut = components['schemas']['GeoInterventionOut'];
export type GeoInterventionListPage = components['schemas']['GeoInterventionListPage'];
export type GeoInterventionCreate = components['schemas']['GeoInterventionCreate'];
export type GeoInterventionUpdate = components['schemas']['GeoInterventionUpdate'];
export type GeoInterventionConcludeRequest =
  components['schemas']['GeoInterventionConcludeRequest'];
export type GeoInterventionCancelRequest =
  components['schemas']['GeoInterventionCancelRequest'];
export type GeoInterventionTargetMetrics =
  components['schemas']['GeoInterventionTargetMetrics'];
export type GeoInterventionStatus = GeoInterventionOut['status'];
export type GeoInterventionEditableStatus = GeoInterventionUpdate['status'];
export type GeoInterventionActionType = GeoInterventionOut['planned_action_type'];
export type GeoInterventionOutcomeVerdict = NonNullable<GeoInterventionOut['outcome_verdict']>;
export type GeoInterventionAvailableAction = GeoInterventionOut['available_actions'][number];

export type BadgeTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive';

export const geoInterventionActionTypes = [
  'FACT_REVISION',
  'CONTENT_TASK',
  'PUBLICATION_REPAIR',
  'ADDITIONAL_MONITORING',
  'OTHER',
] as const satisfies readonly GeoInterventionActionType[];

export const geoInterventionActionTypeLabels: Record<GeoInterventionActionType, string> =
  opportunityActionTypeLabels;

export const geoInterventionStatusRegistry = {
  PLANNED: { label: '已计划', tone: 'outline' },
  ACTIVE: { label: '执行中', tone: 'info' },
  EVALUATING: { label: '评估中', tone: 'warning' },
  CONCLUDED: { label: '已结案', tone: 'success' },
  CANCELLED: { label: '已取消', tone: 'secondary' },
} satisfies Record<GeoInterventionStatus, { label: string; tone: BadgeTone }>;

export const geoInterventionVerdictValues = [
  'TARGET_MET',
  'PARTIAL_IMPROVEMENT',
  'NO_IMPROVEMENT',
  'INSUFFICIENT_DATA',
] as const satisfies readonly GeoInterventionOutcomeVerdict[];

export const geoInterventionVerdictRegistry = {
  TARGET_MET: { label: '达到目标', tone: 'success' },
  PARTIAL_IMPROVEMENT: { label: '部分改善', tone: 'info' },
  NO_IMPROVEMENT: { label: '未见改善', tone: 'warning' },
  INSUFFICIENT_DATA: { label: '样本不足', tone: 'secondary' },
} satisfies Record<GeoInterventionOutcomeVerdict, { label: string; tone: BadgeTone }>;

export const decisionKindLabels: Record<
  components['schemas']['GeoOpportunityDecisionKind'],
  string
> = {
  MANUAL_RESOLVE: '人工解决',
  RETEST_RESOLVE: '复测恢复解决',
  CONTINUE: '继续跟进',
};

export function geoInterventionEditableStatuses(
  currentStatus: GeoInterventionStatus,
): readonly GeoInterventionEditableStatus[] {
  // 服务端禁止 ACTIVE/EVALUATING 回退为 PLANNED，下拉仅提供合法迁移状态。
  if (currentStatus === 'PLANNED') {
    return ['PLANNED', 'ACTIVE', 'EVALUATING'];
  }
  return ['ACTIVE', 'EVALUATING'];
}

const comparisonMetricLabels = {
  natural_visibility: '自然可见率',
  recommendation_rate: '推荐率',
  recommendation_sov: '推荐 SOV',
  owned_source_coverage: '自有信源覆盖率',
  severe_error_run_rate: '严重错误运行率',
  incorrect_claim_rate: '错误声明率',
  mention_stability: '提及稳定性',
  run_success_rate: '运行成功率',
  evidence_completeness: '证据完整率',
  same_fact_error_count: '同一事实错误次数',
  owned_citation_count: '自有引用次数',
  consecutive_failed_count: '连续失败次数',
} satisfies Record<components['schemas']['GeoRetestComparisonMetric']['metric_code'], string>;

const COUNT_METRIC_CODES: ReadonlySet<string> = new Set([
  'same_fact_error_count',
  'owned_citation_count',
  'consecutive_failed_count',
]);

export function geoInterventionMetricLabel(code: string): string {
  if (code in comparisonMetricLabels) {
    return comparisonMetricLabels[code as keyof typeof comparisonMetricLabels];
  }
  if (code in metricLabels) {
    return metricLabels[code as keyof typeof metricLabels];
  }
  return code;
}

export function isCountMetric(code: string): boolean {
  return COUNT_METRIC_CODES.has(code);
}

export function formatOpportunityChoiceLabel(
  item: components['schemas']['GeoOpportunityListItem'],
): string {
  const statusText = opportunityStatusLabels[item.status] ?? item.status;
  const scopeParts = [item.subject_name, item.query_topic_name].filter(Boolean);
  const scopeSuffix = scopeParts.length > 0 ? `（${scopeParts.join(' / ')}）` : '';
  return `[${statusText}] ${item.title}${scopeSuffix}`;
}

export function charLength(value: string): number {
  return Array.from(value).length;
}

export function rateToPctString(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(Math.round(value * 10000) / 100);
}

export function parsePctInput(
  label: string,
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return { ok: false, message: `${label}需为 0 到 100 的数字` };
  }
  return { ok: true, value: Math.round((numeric / 100) * 10000) / 10000 };
}

export function toLocalDateTimeValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTimeValue(
  label: string,
  localValue: string,
  initialLocalValue: string,
  initialIso: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  // 未修改日期输入框时保留原始精确 ISO 时间戳，避免分钟截断改写服务端记录。
  if (localValue === initialLocalValue) {
    return { ok: true, value: initialIso ?? null };
  }
  const trimmed = localValue.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `${label}格式无效，请重新选择或清空` };
  }
  return { ok: true, value: parsed.toISOString() };
}

export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '未设置';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('zh-CN', { hour12: false });
}

export function formatRatePercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMetricValue(code: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无';
  if (isCountMetric(code)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSignedMetricDelta(code: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (isCountMetric(code)) {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return value > 0 ? `+${formatted}` : formatted;
  }
  const pct = (value * 100).toFixed(1);
  return value > 0 ? `+${pct}%` : `${pct}%`;
}

export type BaselineChoice = {
  id: string;
  label: string;
};

export function extractBaselineChoices(
  comparisonRead: components['schemas']['GeoOpportunityComparisonRead'] | undefined,
): BaselineChoice[] {
  if (!comparisonRead) return [];
  const seen = new Set<string>();
  const choices: BaselineChoice[] = [];
  for (const item of comparisonRead.retests) {
    if (seen.has(item.baseline_id)) continue;
    seen.add(item.baseline_id);
    choices.push({
      id: item.baseline_id,
      label: `基线 ${item.baseline_id.slice(0, 8)}（关联复测 ${formatShortDateTime(item.created_at)}）`,
    });
  }
  const activeBaselineId = comparisonRead.comparison?.baseline_id;
  if (activeBaselineId && !seen.has(activeBaselineId)) {
    seen.add(activeBaselineId);
    choices.push({
      id: activeBaselineId,
      label: `基线 ${activeBaselineId.slice(0, 8)}（当前比较快照）`,
    });
  }
  return choices;
}

export function validateInterventionTargetMetrics(fields: {
  discoveryPct: string;
  mentionPct: string;
  recommendationPct: string;
  citationPct: string;
  accuracyPct: string;
}): { ok: true; value: GeoInterventionTargetMetrics } | { ok: false; message: string } {
  const entries = [
    ['目标发现率', fields.discoveryPct, 'target_discovery_rate'],
    ['目标提及率', fields.mentionPct, 'target_mention_rate'],
    ['目标推荐率', fields.recommendationPct, 'target_recommendation_rate'],
    ['目标引用率', fields.citationPct, 'target_citation_rate'],
    ['目标准确率', fields.accuracyPct, 'target_accuracy_rate'],
  ] as const;

  const targetMetrics: GeoInterventionTargetMetrics = {};
  for (const [label, raw, key] of entries) {
    const parsed = parsePctInput(label, raw);
    if (!parsed.ok) return parsed;
    if (parsed.value !== null) {
      targetMetrics[key] = parsed.value;
    }
  }
  return { ok: true, value: targetMetrics };
}

export type GeoInterventionFormDraft = {
  opportunityId: string;
  campaignId: string;
  title: string;
  hypothesis: string;
  plannedActionType: GeoInterventionActionType;
  status: GeoInterventionEditableStatus;
  assigneeId: string;
  baselineId: string;
  decisionId: string;
  discoveryPct: string;
  mentionPct: string;
  recommendationPct: string;
  citationPct: string;
  accuracyPct: string;
  intervenedLocal: string;
  retestStartLocal: string;
  retestEndLocal: string;
};

export function buildInitialGeoInterventionDraft(
  editTarget: GeoInterventionOut | null,
  lockedCampaignId?: string,
  lockedOpportunityId?: string,
): GeoInterventionFormDraft {
  return {
    opportunityId: editTarget?.opportunity_id ?? lockedOpportunityId ?? '',
    campaignId: editTarget?.campaign_id ?? lockedCampaignId ?? '',
    title: editTarget?.title ?? '',
    hypothesis: editTarget?.hypothesis ?? '',
    plannedActionType: editTarget?.planned_action_type ?? 'CONTENT_TASK',
    status:
      editTarget && editTarget.status !== 'CONCLUDED' && editTarget.status !== 'CANCELLED'
        ? editTarget.status
        : 'PLANNED',
    assigneeId: editTarget?.assignee_id ?? '',
    baselineId: editTarget?.baseline_id ?? '',
    decisionId: editTarget?.decision_id ?? '',
    discoveryPct: rateToPctString(editTarget?.target_metrics.target_discovery_rate),
    mentionPct: rateToPctString(editTarget?.target_metrics.target_mention_rate),
    recommendationPct: rateToPctString(editTarget?.target_metrics.target_recommendation_rate),
    citationPct: rateToPctString(editTarget?.target_metrics.target_citation_rate),
    accuracyPct: rateToPctString(editTarget?.target_metrics.target_accuracy_rate),
    intervenedLocal: toLocalDateTimeValue(editTarget?.intervened_at),
    retestStartLocal: toLocalDateTimeValue(editTarget?.retest_window_start),
    retestEndLocal: toLocalDateTimeValue(editTarget?.retest_window_end),
  };
}

export type ValidatedGeoInterventionForm = {
  title: string;
  hypothesis: string;
  targetMetrics: GeoInterventionTargetMetrics;
  intervenedAt: string | null;
  retestWindowStart: string | null;
  retestWindowEnd: string | null;
};

export function validateGeoInterventionFormDraft(
  mode: 'create' | 'edit',
  draft: GeoInterventionFormDraft,
  editTarget: GeoInterventionOut | null,
  initialTimes: { intervenedLocal: string; startLocal: string; endLocal: string },
): { ok: true; value: ValidatedGeoInterventionForm } | { ok: false; message: string } {
  const cleanTitle = draft.title.trim();
  const cleanHypothesis = draft.hypothesis.trim();
  if (mode === 'create' && !draft.opportunityId) {
    return { ok: false, message: '请选择关联的 GEO 机会' };
  }
  if (!cleanTitle || charLength(cleanTitle) > 200) {
    return { ok: false, message: '干预标题不能为空且不能超过 200 个字符' };
  }
  if (!cleanHypothesis || charLength(cleanHypothesis) > 2000) {
    return { ok: false, message: '优化假设不能为空且不能超过 2000 个字符' };
  }

  const metricsRes = validateInterventionTargetMetrics({
    discoveryPct: draft.discoveryPct,
    mentionPct: draft.mentionPct,
    recommendationPct: draft.recommendationPct,
    citationPct: draft.citationPct,
    accuracyPct: draft.accuracyPct,
  });
  if (!metricsRes.ok) return metricsRes;

  const intervenedRes = parseLocalDateTimeValue(
    '干预执行时间',
    draft.intervenedLocal,
    initialTimes.intervenedLocal,
    editTarget?.intervened_at,
  );
  if (!intervenedRes.ok) return intervenedRes;

  const startRes = parseLocalDateTimeValue(
    '复测窗口开始时间',
    draft.retestStartLocal,
    initialTimes.startLocal,
    editTarget?.retest_window_start,
  );
  if (!startRes.ok) return startRes;

  const endRes = parseLocalDateTimeValue(
    '复测窗口结束时间',
    draft.retestEndLocal,
    initialTimes.endLocal,
    editTarget?.retest_window_end,
  );
  if (!endRes.ok) return endRes;

  if (
    startRes.value
    && endRes.value
    && new Date(startRes.value).getTime() > new Date(endRes.value).getTime()
  ) {
    return { ok: false, message: '复测窗口开始时间不能晚于结束时间' };
  }

  return {
    ok: true,
    value: {
      title: cleanTitle,
      hypothesis: cleanHypothesis,
      targetMetrics: metricsRes.value,
      intervenedAt: intervenedRes.value,
      retestWindowStart: startRes.value,
      retestWindowEnd: endRes.value,
    },
  };
}
