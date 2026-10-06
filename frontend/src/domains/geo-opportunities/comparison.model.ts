import type { components } from '@/shared/api/generated/schema';

export type Comparison = components['schemas']['GeoRetestComparison'];
export const recoveryLabels = {
  PENDING: '复测尚未完成', UNAVAILABLE: '恢复规则或证据不可用', NOT_COMPARABLE: '当前结果不可比',
  INSUFFICIENT_SAMPLE: '恢复样本不足', NOT_RECOVERED: '尚未恢复', RECOVERED: '已达到冻结恢复条件，待人工确认',
} satisfies Record<components['schemas']['GeoRetestRecoveryStatus'], string>;
export const comparisonMetricLabels = {
  natural_visibility: '自然可见率', recommendation_rate: '推荐率', recommendation_sov: '推荐 SOV',
  owned_source_coverage: '自有信源覆盖率', severe_error_run_rate: '严重错误运行率', incorrect_claim_rate: '错误声明率',
  mention_stability: '提及稳定性', run_success_rate: '运行成功率', evidence_completeness: '证据完整率',
  same_fact_error_count: '同一事实错误次数', owned_citation_count: '自有引用次数', consecutive_failed_count: '连续失败次数',
} satisfies Record<components['schemas']['GeoRetestComparisonMetric']['metric_code'], string>;
export const comparisonSampleLabels = { NONE: '无样本', OBSERVED: '样本不足 · 仅观测', REPORTABLE: '可报告', STABLE: '稳定样本' } satisfies Record<components['schemas']['SampleLevel'], string>;
export const differenceLabels = {
  MATRIX_CHANGED: '复测矩阵变化', INPUT_CHANGED: '冻结输入变化', MODEL_VERSION_UNKNOWN: '模型版本未知',
  MODEL_VERSION_CHANGED: '模型版本变化', ANALYSIS_VERSION_CHANGED: '分析版本变化', ENVIRONMENT_CHANGED: '实际环境变化', BASELINE_SOURCE_UNAVAILABLE: '基线历史来源不可用',
} satisfies Record<components['schemas']['GeoRetestComparisonDifference']['code'], string>;
export const decisionLabels = { MANUAL_RESOLVE: '人工解决', RETEST_RESOLVE: '复测恢复确认', CONTINUE: '继续跟进' } satisfies Record<components['schemas']['GeoOpportunityDecisionKind'], string>;
export const dimensionLabels = {
  query_topic_id: '问题主题 ID', query_topic_revision: '主题修订', prompt_variant_id: '问题变体 ID', prompt_revision: '问题修订',
  collection_profile_id: '采集配置 ID', profile_revision: '配置修订', engine_surface_id: '观测面 ID', surface_revision: '观测面修订',
  collection_mode: '采集方式', language_code: '语言', region_code: '地区', login_state: '登录状态', mention_mode: '点名属性',
  intent_type: '问题意图', source_model: '实际来源模型', source_product: '实际来源产品', model_version: '模型版本', product_version: '产品版本',
  rule_set_version: '规则版本', analysis_configuration_key: '分析配置', subject_versions: '对象版本', fact_version_bindings: '事实版本绑定', window_key: '窗口键',
} satisfies Record<keyof components['schemas']['GeoOverviewDimensions'], string>;
