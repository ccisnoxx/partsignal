import type { components } from '@/shared/api/generated/schema';

type Schema = components['schemas'];
export const metricLabels = {
  answer_coverage: '回答覆盖率', natural_visibility: '自然可见率', product_mention: '产品提及率',
  recommendation_rate: '推荐率', top_recommendation_rate: '首位推荐率', owned_source_coverage: '自有信源覆盖率',
  accurate_claim_rate: '准确声明率', severe_error_run_rate: '严重错误运行率', eligible_runs: '合格运行比例',
  run_success_rate: '运行成功率', analysis_run_coverage: '运行级分析覆盖率', review_backlog: '待复核比例',
  evidence_completeness: '证据完整率', cost_coverage: '费用覆盖率', model_version_coverage: '模型版本覆盖率',
  mention_sov: '提及 SOV', recommendation_sov: '推荐 SOV', owned_citation_share: '自有引用份额',
  partial_claim_rate: '部分准确声明率', incorrect_claim_rate: '错误声明率',
} satisfies Record<Schema['GeoOverviewCard']['metric_code'] | Schema['GeoAnswerInsightMetric']['metric_code'], string>;
export const exclusionLabels = {
  RUN_NOT_COMPLETED: '运行未完成', ANSWER_MISSING_OR_EMPTY: '答案缺失或为空', CURRENT_ANALYSIS_UNAVAILABLE: '当前分析不可用',
  CURRENT_REVIEW_REQUIRED: '尚需当前复核', INTEGRITY_ERROR: '证据完整性不足', ADMINISTRATOR_EXCLUDED: '管理员排除',
  SUPERSEDED_ATTEMPT: '已被后续尝试替代', DIMENSION_MISMATCH: '维度不匹配', SUBJECT_NOT_APPLICABLE: '对象不适用',
  MENTION_MODE_NOT_APPLICABLE: '点名属性不适用', INTENT_NOT_APPLICABLE: '问题意图不适用',
  RELIABLE_ORDER_UNAVAILABLE: '无可靠推荐顺序', TARGET_RANK_UNAVAILABLE: '目标排名不可用',
  CITATION_OBSERVATION_UNAVAILABLE: '引用观测不可用', CITATION_CLASSIFICATION_INCOMPLETE: '引用分类不完整',
  ASSESSABLE_CLAIM_UNAVAILABLE: '无可判断声明', INSUFFICIENT_REPEATS: '重复样本不足',
} satisfies Record<Schema['MetricExclusion'], string>;

