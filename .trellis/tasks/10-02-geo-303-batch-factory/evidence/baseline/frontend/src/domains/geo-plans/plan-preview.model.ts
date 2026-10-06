import type { components } from '@/shared/api/generated/schema';

type PlanBlocker = components['schemas']['GeoPlanPreviewBlocker'];
type PlanWarning = components['schemas']['GeoPlanPreviewWarning'];
const blockerLabels = {
  SUBJECT_NOT_FOUND: '监测对象不存在，请移除或重新选择', SUBJECT_DISABLED: '监测对象已停用',
  PROMPT_NOT_FOUND: '问题变体不存在，请移除或重新选择', PROMPT_DISABLED: '问题变体已停用', PROFILE_NOT_FOUND: '采集配置不存在，请移除或重新选择',
  BUDGET_EXCEEDED: '已知费用小计超过预算上限', BUDGET_CURRENCY_MISMATCH: '费用涉及多个币种，无法核验预算',
  ADAPTER_UNKNOWN: '适配器未登记', CONFIGURATION_INVALID: '采集配置无效', MODE_UNSUPPORTED: '采集模式不受支持', SURFACE_UNSUPPORTED: '观测面不受支持',
  LANGUAGE_UNSUPPORTED: '语言不受支持', REGION_UNSUPPORTED: '地区不受支持', LOGIN_UNSUPPORTED: '登录状态不受支持', SEARCH_POLICY_UNSUPPORTED: '搜索策略不受支持', CAPABILITY_UNSUPPORTED: '能力不受支持',
  MONITORING_DISABLED: 'GEO 总开关已关闭，请联系管理员', API_COLLECTION_DISABLED: 'API 采集开关已关闭，请联系管理员', BROWSER_COLLECTION_DISABLED: '浏览器采集开关已关闭，请联系管理员',
  PROFILE_DISABLED: '采集配置已停用', SURFACE_DISABLED: '观测面已停用', ADAPTER_NOT_APPROVED: '适配器尚未批准', ENVIRONMENT_UNSUPPORTED: '运行环境不受支持',
  COMPLIANCE_NOT_APPROVED: '合规尚未批准', PROFILE_NOT_TESTED: '采集配置尚未通过测试', MODEL_BINDING_REQUIRED: '采集配置需要模型绑定', MODEL_BINDING_UNSUPPORTED: '此模式不支持模型绑定',
  MODEL_BINDING_INVALID: '模型绑定无效', MODEL_DISABLED: '模型已停用', CHANNEL_DISABLED: 'AI 渠道已停用', MODEL_NOT_TESTED: '模型尚未通过测试', CREDENTIAL_NOT_CONFIGURED: '凭据尚未配置，请联系管理员', PROTOCOL_UNSUPPORTED: '协议不受支持',
} satisfies Record<PlanBlocker['code'], string>;
const warningLabels = {
  MIXED_COLLECTION_MODES: '包含不同采集模式，请分别核对运行要求', MIXED_PROFILE_ENVIRONMENTS: '采集配置的语言、地区或登录环境不同',
  PROMPT_PROFILE_ENVIRONMENT_MISMATCH: '问题变体与采集配置的语言或地区不同', MODEL_VERSION_UNKNOWN: '无法观测模型版本',
  COST_UNKNOWN: '全部运行费用未知', COST_PARTIAL: '仅部分运行费用已知', COST_CURRENCY_MISMATCH: '已知费用包含多个币种，不进行换汇', BUDGET_UNVERIFIED: '存在未知费用，不能保证最终费用未超过预算',
} satisfies Record<PlanWarning['code'], string>;

function blockerDestination(blocker: PlanBlocker) {
  const code = blocker.code;
  if (code === 'SUBJECT_NOT_FOUND' || code === 'SUBJECT_DISABLED') return { step: 1, field: 'subjects', href: blocker.resource_id ? `/configuration/geo-entities?subject_id=${encodeURIComponent(blocker.resource_id)}` : '/configuration/geo-entities' };
  if (code === 'PROMPT_NOT_FOUND' || code === 'PROMPT_DISABLED') return { step: 2, field: 'prompt_variant_ids', href: blocker.resource_id ? `/geo/questions?selected=${encodeURIComponent(blocker.resource_id)}` : '/geo/questions' };
  if (code === 'BUDGET_EXCEEDED' || code === 'BUDGET_CURRENCY_MISMATCH') return { step: 4, field: 'budget_limit', href: null };
  // Profile blocker 的 resource_id 始终指向所选 Profile；field 的后缀属于其配置，而非计划字段。
  return { step: 3, field: 'collection_profile_ids', href: blocker.resource_id ? `/configuration/geo-surfaces?tab=profiles&profile_id=${encodeURIComponent(blocker.resource_id)}` : '/configuration/geo-surfaces?tab=profiles' };
}
function planFieldStep(field: string) {
  const root = field.split('.')[0];
  if (root === 'subjects') return 1;
  if (root === 'prompt_variant_ids') return 2;
  if (root === 'collection_profile_ids') return 3;
  if (root === 'repeat_count' || root === 'budget_limit' || root === 'rule_set_revision') return 4;
  if (root === 'schedule_kind' || root === 'cron_expression' || root === 'timezone') return 5;
  return 0;
}
export { blockerDestination, blockerLabels, planFieldStep, warningLabels };
export type { PlanBlocker, PlanWarning };
