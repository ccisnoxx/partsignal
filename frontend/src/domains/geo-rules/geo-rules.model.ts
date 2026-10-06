import { z } from 'zod';
import type { FieldPath } from 'react-hook-form';
import type { components } from '@/shared/api/generated/schema';

type GeoRuleSet = components['schemas']['GeoRuleSetRead'];
type GeoRulePreview = components['schemas']['GeoRulePreviewRead'];
type GeoRuleCode = components['schemas']['GeoRuleCode'];

const count = z.number().int('请输入整数').min(1, '最小值为 1').max(10000, '最大值为 10000');
const rate = z.number().min(0, '比例不能小于 0').max(1, '比例不能大于 1');
const days = z.number().int('请输入整数天数').min(1, '最少 1 天').max(365, '最多 365 天');

// 表单只校验输入形状；样本等级、规则资格和阈值解释全部来自服务端 preview。
const ruleConfigurationSchema = z.object({
  sample_policy: z.object({ reportable_minimum: count, stable_minimum: count }).refine(
    (value) => 1 < value.reportable_minimum && value.reportable_minimum < value.stable_minimum,
    { message: '样本门槛必须满足 1 < REPORTABLE < STABLE', path: ['reportable_minimum'] },
  ),
  visibility_drop_points: rate,
  recommendation_drop_points: rate,
  competitor_surge_points: rate,
  own_citation_previous_count: count,
  repeated_error_minimum_runs: count,
  repeated_error_window_days: days,
  unstable_minimum_repeats: count,
  stability_minimum_rate: rate,
  dedup_window_days: days,
  data_quality_minimum_success_rate: rate.nullable(),
  data_quality_minimum_evidence_rate: rate.nullable(),
  run_failure_consecutive_limit: count.nullable(),
  recovery: z.object({
    minimum_runs: count,
    visibility_drop_max_points: rate,
    recommendation_drop_max_points: rate,
    competitor_surge_max_points: rate,
    topic_visibility_minimum_rate: rate,
    owned_citation_minimum_count: count,
    stability_minimum_rate: rate,
    fact_error_max_count: z.literal(0),
    strict_comparability_required: z.literal(true),
    manual_confirmation_required: z.literal(true),
  }),
});
type RuleFormValues = z.infer<typeof ruleConfigurationSchema>;

const previewSamplesSchema = z.object({
  current_runs: z.number().int('请输入整数').min(0).max(100000),
  previous_runs: z.number().int('请输入整数').min(0).max(100000),
});
type PreviewSamples = z.infer<typeof previewSamplesSchema>;

const ruleLabels: Record<GeoRuleCode, string> = {
  VISIBILITY_DROP: '可见度下降',
  RECOMMENDATION_DROP: '推荐率下降',
  COMPETITOR_SURGE: '竞品上升',
  TOPIC_COVERAGE_GAP: '主题覆盖缺口',
  OWN_CITATION_LOST: '自有引用丢失',
  CRITICAL_FACT_ERROR: '关键事实错误',
  REPEATED_FACT_ERROR: '重复事实错误',
  UNSTABLE_RESULT: '结果不稳定',
  DATA_QUALITY_PROBLEM: '数据质量问题',
  RUN_FAILURE: '连续运行失败',
};
const sampleLevelLabels: Record<components['schemas']['SampleLevel'], string> = {
  NONE: '无样本', OBSERVED: '仅观察', REPORTABLE: '可报告', STABLE: '稳定',
};

type RuleField = { name: FieldPath<RuleFormValues>; label: string; unit: 'count' | 'rate' | 'days'; nullable?: boolean; minimum?: number };
const sampleFields: readonly RuleField[] = [
  { name: 'sample_policy.reportable_minimum', label: '可报告最低样本（REPORTABLE）', unit: 'count', minimum: 2 },
  { name: 'sample_policy.stable_minimum', label: '稳定最低样本（STABLE）', unit: 'count', minimum: 3 },
];
const thresholdFields: readonly RuleField[] = [
  { name: 'visibility_drop_points', label: '可见度下降阈值', unit: 'rate' },
  { name: 'recommendation_drop_points', label: '推荐率下降阈值', unit: 'rate' },
  { name: 'competitor_surge_points', label: '竞品上升阈值', unit: 'rate' },
  { name: 'own_citation_previous_count', label: '自有引用丢失：前期最低引用数', unit: 'count' },
  { name: 'repeated_error_minimum_runs', label: '重复事实错误：最低运行数', unit: 'count' },
  { name: 'repeated_error_window_days', label: '重复事实错误：统计窗口', unit: 'days' },
  { name: 'unstable_minimum_repeats', label: '结果不稳定：最低重复数', unit: 'count' },
  { name: 'stability_minimum_rate', label: '结果不稳定：稳定率门槛', unit: 'rate' },
  { name: 'data_quality_minimum_success_rate', label: '数据质量：最低成功率', unit: 'rate', nullable: true },
  { name: 'data_quality_minimum_evidence_rate', label: '数据质量：最低证据率', unit: 'rate', nullable: true },
  { name: 'run_failure_consecutive_limit', label: '连续运行失败：次数门槛', unit: 'count', nullable: true },
];
const recoveryFields: readonly RuleField[] = [
  { name: 'recovery.minimum_runs', label: '复测最低样本数', unit: 'count' },
  { name: 'recovery.visibility_drop_max_points', label: '复测可见度最大下降值', unit: 'rate' },
  { name: 'recovery.recommendation_drop_max_points', label: '复测推荐率最大下降值', unit: 'rate' },
  { name: 'recovery.competitor_surge_max_points', label: '复测竞品最大上升值', unit: 'rate' },
  { name: 'recovery.topic_visibility_minimum_rate', label: '复测主题最低可见度', unit: 'rate' },
  { name: 'recovery.owned_citation_minimum_count', label: '复测自有引用最低数量', unit: 'count' },
  { name: 'recovery.stability_minimum_rate', label: '复测最低稳定率', unit: 'rate' },
];
const dedupFields: readonly RuleField[] = [{ name: 'dedup_window_days', label: '机会去重窗口', unit: 'days' }];
const allRuleFields = [...sampleFields, ...thresholdFields, ...dedupFields, ...recoveryFields];

function parseGeoRuleSet(value: unknown): GeoRuleSet {
  const result = z.object({
    revision: z.number().int().min(1), configuration: ruleConfigurationSchema,
    updated_at: z.iso.datetime({ offset: true }), updated_by: z.uuid().nullable(),
    available_actions: z.array(z.enum(['UPDATE', 'PREVIEW'])),
  }).safeParse(value);
  if (!result.success) throw new Error('GEO 规则配置响应不完整或不符合合同');
  return result.data;
}

function parseGeoRulePreview(value: unknown): GeoRulePreview {
  const result = z.object({
    baseline_revision: z.number().int().min(1), proposed_revision: z.number().int().min(1), changed: z.boolean(),
    snapshot: z.object({ schema_version: z.literal(1), rule_set_revision: z.number().int().min(1), configuration: ruleConfigurationSchema }),
    current_sample_level: z.enum(['NONE', 'OBSERVED', 'REPORTABLE', 'STABLE']),
    previous_sample_level: z.enum(['NONE', 'OBSERVED', 'REPORTABLE', 'STABLE']),
    sample_gates: z.array(z.object({
      rule_code: z.enum(Object.keys(ruleLabels) as [GeoRuleCode, ...GeoRuleCode[]]),
      current_minimum: z.number().int().min(1), previous_minimum: z.number().int().min(0),
      sample_sufficient: z.boolean(), threshold_configured: z.boolean(),
    })),
    preview_scope: z.literal('CONFIGURATION_AND_SAMPLE_GATES'),
  }).safeParse(value);
  if (!result.success) throw new Error('GEO 规则预览响应不完整或不符合合同');
  return result.data;
}

export { allRuleFields, dedupFields, parseGeoRulePreview, parseGeoRuleSet, previewSamplesSchema, recoveryFields, ruleConfigurationSchema, ruleLabels, sampleFields, sampleLevelLabels, thresholdFields };
export type { GeoRulePreview, GeoRuleSet, PreviewSamples, RuleField, RuleFormValues };
