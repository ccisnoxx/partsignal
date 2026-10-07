import type { components, operations } from '@/shared/api/generated/schema';
import type { SurfacesSearch } from './surfaces-search.model';

type Surface = components['schemas']['GeoEngineSurfaceRead'];
type Profile = components['schemas']['GeoCollectionProfileRead'];
type ConfigurationResource = Surface | Profile;
type SurfaceListParams = NonNullable<operations['listGeoEngineSurfaces']['parameters']['query']>;
type ProfileListParams = NonNullable<operations['listGeoCollectionProfiles']['parameters']['query']>;
type ConfigurationAction = components['schemas']['GeoConfigurationAction'];
const kindLabels = { CONSUMER_UI: '消费端界面', MODEL_API: '模型 API', SEARCH_API: '搜索 API', MANUAL_SITE: '人工网站' } satisfies Record<components['schemas']['GeoSurfaceKind'], string>;
const complianceLabels = { NOT_REVIEWED: '待审核', APPROVED: '已批准', REJECTED: '已拒绝', SUSPENDED: '已暂停' } satisfies Record<components['schemas']['GeoComplianceStatus'], string>;
const modeLabels = { MANUAL: '人工', API: 'API', BROWSER: '浏览器' } satisfies Record<components['schemas']['GeoCollectionMode'], string>;
const stageLabels = { ACTIVE: '已启用', DISABLED: '已停用', BLOCKED: '启用受阻' } satisfies Record<components['schemas']['GeoConfigurationWorkflowStage'], string>;
const testLabels = { UNTESTED: '未测试', PASSED: '测试通过', FAILED: '测试失败' } satisfies Record<components['schemas']['GeoProfileTestStatus'], string>;
const loginLabels = { ANONYMOUS: '匿名', AUTHENTICATED: '已登录', NOT_APPLICABLE: '不适用' } satisfies Record<components['schemas']['GeoProfileLoginState'], string>;
const webPolicyLabels = { UNKNOWN: '未知', REQUESTED: '请求搜索', REQUIRED: '必须搜索', NOT_APPLICABLE: '不适用' } satisfies Record<components['schemas']['GeoWebSearchPolicy'], string>;
const deletionLabels = { COLLECTION_PROFILE: '采集配置', HISTORICAL_REFERENCE: '历史引用', MONITORING_PLAN: '监测计划引用' } satisfies Record<components['schemas']['GeoConfigurationDeletionBlockerType'], string>;
const activationLabels = {
  ADAPTER_UNKNOWN: '适配器未登记', CONFIGURATION_INVALID: '配置无效', MODE_UNSUPPORTED: '采集模式不受支持', SURFACE_UNSUPPORTED: '观测面不受支持',
  LANGUAGE_UNSUPPORTED: '语言不受支持', REGION_UNSUPPORTED: '地区不受支持', LOGIN_UNSUPPORTED: '登录状态不受支持', SEARCH_POLICY_UNSUPPORTED: '搜索策略不受支持', CAPABILITY_UNSUPPORTED: '能力不受支持',
  MONITORING_DISABLED: 'GEO 总开关已关闭', API_COLLECTION_DISABLED: 'API 采集开关已关闭', BROWSER_COLLECTION_DISABLED: '浏览器采集开关已关闭', PROFILE_DISABLED: '采集配置已停用', SURFACE_DISABLED: '观测面已停用',
  ADAPTER_NOT_APPROVED: '适配器未批准', ENVIRONMENT_UNSUPPORTED: '运行环境不受支持', COMPLIANCE_NOT_APPROVED: '合规尚未批准', PROFILE_NOT_TESTED: '配置尚未通过测试',
  MODEL_BINDING_REQUIRED: '需要模型绑定', MODEL_BINDING_UNSUPPORTED: '此模式不支持模型绑定', MODEL_BINDING_INVALID: '模型绑定无效', MODEL_DISABLED: '模型已停用', CHANNEL_DISABLED: '渠道已停用', MODEL_NOT_TESTED: '模型尚未通过测试', CREDENTIAL_NOT_CONFIGURED: '凭据尚未配置', PROTOCOL_UNSUPPORTED: '协议不受支持',
} satisfies Record<components['schemas']['ProfileBlockerCode'], string>;
const primaryLabels = { VIEW_SUMMARY: '查看摘要', MANAGE_SURFACE: '维护观测面', ENABLE_SURFACE: '查看并启用', MANAGE_PROFILE: '维护配置', ENABLE_PROFILE: '查看并启用', RESOLVE_BLOCKERS: '查看启用条件' } satisfies Record<components['schemas']['GeoConfigurationPrimaryTask'], string>;
function surfaceListParams(search: SurfacesSearch): SurfaceListParams {
  return { page: search.page ?? 1, page_size: search.page_size ?? 20, sort: search.sort ?? 'NAME_ASC', ...(search.q ? { q: search.q } : {}), ...(search.is_active !== undefined ? { is_active: search.is_active } : {}), ...(search.surface_kind ? { surface_kind: search.surface_kind } : {}) };
}
function profileListParams(search: SurfacesSearch): ProfileListParams {
  return { page: search.page ?? 1, page_size: search.page_size ?? 20, sort: search.sort ?? 'NAME_ASC', ...(search.q ? { q: search.q } : {}), ...(search.is_active !== undefined ? { is_active: search.is_active } : {}), ...(search.surface_id ? { engine_surface_id: search.surface_id } : {}), ...(search.collection_mode ? { collection_mode: search.collection_mode } : {}) };
}
function actionLabel(action: ConfigurationAction, profile: boolean) {
  const noun = profile ? '采集配置' : '观测面';
  switch (action) {
    case 'UPDATE': return `编辑${noun}`;
    case 'ENABLE': return `启用${noun}`;
    case 'DISABLE': return `停用${noun}`;
    case 'TEST': return '测试连接';
    case 'DELETE': return `删除${noun}`;
    default: return assertNever(action);
  }
}
function assertNever(value: never): never { throw new Error(`GEO 配置返回未知动作：${String(value)}`); }
export { kindLabels, complianceLabels, modeLabels, stageLabels, testLabels, loginLabels, webPolicyLabels, deletionLabels, activationLabels, primaryLabels, surfaceListParams, profileListParams, actionLabel };
export type { Surface, Profile, ConfigurationResource, SurfaceListParams, ProfileListParams, ConfigurationAction };
