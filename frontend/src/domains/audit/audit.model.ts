import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];
type AuditModule = components['schemas']['AuditModule'];
type AuditOutcome = components['schemas']['AuditOutcome'];
type AuditSafeValue = components['schemas']['AuditSafeValue'];
type AuditListApiParams = NonNullable<operations['listAuditLogs']['parameters']['query']>;
type AuditDisplayItem = { field: string; label: string; value: string };
type AuditDisplayChange = { field: string; label: string; before: string; after: string };
type AuditRelatedLink = { href: string; label: string };

const auditModuleValues = [
  'IDENTITY',
  'PRODUCT_FACTS',
  'CONTENT_PLANNING',
  'CONTENT_PRODUCTION',
  'CONTENT_REVIEW',
  'PUBLICATION',
  'GEO_OBSERVATION',
  'CONFIGURATION',
  'FILE_MANAGEMENT',
] as const satisfies readonly AuditModule[];
const auditOutcomeValues = ['SUCCESS', 'FAILED', 'DENIED'] as const satisfies readonly AuditOutcome[];
const auditPageSizeValues = [10, 20, 50] as const;

function initialAuditRange(now = new Date()) {
  return {
    createdFrom: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000).toISOString(),
    createdTo: now.toISOString(),
  };
}

const auditDefaultRange = initialAuditRange();

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value, 36)?.toLowerCase();
  return normalized && z.uuid().safeParse(normalized).success ? normalized : undefined;
}

function normalizeIso(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

const auditSearchSchema = z.object({
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number().pipe(z.union(auditPageSizeValues.map((value) => z.literal(value)))).catch(20).default(20),
  createdFrom: z.preprocess((value) => normalizeIso(value, auditDefaultRange.createdFrom), z.iso.datetime()),
  createdTo: z.preprocess((value) => normalizeIso(value, auditDefaultRange.createdTo), z.iso.datetime()),
  actorId: z.preprocess(normalizeUuid, z.uuid().optional()),
  module: z.preprocess(
    (value) => typeof value === 'string' && auditModuleValues.includes(value as AuditModule) ? value : undefined,
    z.enum(auditModuleValues).optional(),
  ),
  action: z.preprocess((value) => normalizeText(value, 120), z.string().max(120).optional()),
  targetType: z.preprocess((value) => normalizeText(value, 80), z.string().max(80).optional()),
  targetId: z.preprocess((value) => normalizeText(value, 100), z.string().max(100).optional()),
  outcome: z.preprocess(
    (value) => typeof value === 'string' && auditOutcomeValues.includes(value as AuditOutcome) ? value : undefined,
    z.enum(auditOutcomeValues).optional(),
  ),
  requestId: z.preprocess((value) => normalizeText(value, 100), z.string().max(100).optional()),
  keyword: z.preprocess((value) => normalizeText(value, 100), z.string().max(100).optional()),
  logId: z.preprocess(normalizeUuid, z.uuid().optional()),
}).transform((search) => (
  new Date(search.createdFrom) < new Date(search.createdTo)
    ? search
    : { ...search, ...auditDefaultRange }
));

type AuditSearch = z.output<typeof auditSearchSchema>;

function auditSearchToApiParams(search: AuditSearch): AuditListApiParams {
  return {
    page: search.page,
    page_size: search.pageSize,
    created_from: search.createdFrom,
    created_to: search.createdTo,
    actor_id: search.actorId,
    business_module: search.module,
    action: search.action,
    target_type: search.targetType,
    target_id: search.targetId,
    outcome: search.outcome,
    request_id: search.requestId,
    keyword: search.keyword,
  };
}

function canonicalAuditSearchRecord(search: AuditSearch): Record<string, string | number> {
  const record: Record<string, string | number> = {
    page: search.page,
    pageSize: search.pageSize,
    createdFrom: search.createdFrom,
    createdTo: search.createdTo,
  };
  for (const [key, value] of Object.entries({
    actorId: search.actorId,
    module: search.module,
    action: search.action,
    targetType: search.targetType,
    targetId: search.targetId,
    outcome: search.outcome,
    requestId: search.requestId,
    keyword: search.keyword,
    logId: search.logId,
  })) {
    if (value) record[key] = value;
  }
  return record;
}

function isCanonicalAuditSearch(raw: Record<string, unknown>, search: AuditSearch) {
  const expected = canonicalAuditSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => String(raw[key]) === String(value));
}

function auditResetSearch(): AuditSearch {
  return auditSearchSchema.parse(auditDefaultRange);
}

function normalizeAuditPageSize(value: number): AuditSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`审计列表收到未知分页大小：${value}`);
}

function toBeijingDateTimeInput(value: string) {
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function fromBeijingDateTimeInput(value: string) {
  const parsed = new Date(`${value}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('审计时间格式无效');
  return parsed.toISOString();
}

const auditModuleLabels: Record<AuditModule, string> = {
  IDENTITY: '身份与用户',
  PRODUCT_FACTS: '产品事实',
  CONTENT_PLANNING: '内容规划',
  CONTENT_PRODUCTION: '内容生产',
  CONTENT_REVIEW: '内容审核',
  PUBLICATION: '发布',
  GEO_OBSERVATION: 'GEO 观测',
  CONFIGURATION: '系统配置',
  FILE_MANAGEMENT: '文件管理',
};

const auditOutcomeLabels: Record<AuditOutcome, string> = {
  SUCCESS: '成功',
  FAILED: '失败',
  DENIED: '已拒绝',
};

const auditActionLabels: Record<string, string> = {
  'user.created': '创建用户', 'user.updated': '更新用户', 'user.deleted': '删除用户', 'user.exported': '导出用户',
  'user.password_changed': '修改密码', 'user.password_reset': '重置密码',
  'ai_channel.created': '创建 AI 渠道', 'ai_channel.updated': '更新 AI 渠道', 'ai_channel.deleted': '删除 AI 渠道',
  'ai_channel.api_key_replaced': '替换 API Key', 'ai_channel.enabled': '启用 AI 渠道', 'ai_channel.disabled': '停用 AI 渠道',
  'ai_channel_header.created': '创建 Header', 'ai_channel_header.updated': '更新 Header', 'ai_channel_header.deleted': '删除 Header',
  'ai_model.created': '创建模型', 'ai_model.updated': '更新模型', 'ai_model.deleted': '删除模型', 'ai_model.enabled': '启用模型', 'ai_model.disabled': '停用模型',
  'platform_profile.enabled': '启用平台', 'platform_profile.disabled': '停用平台', 'platform_profile.deleted': '删除平台',
  'platform_prompt.created': '创建平台 Prompt', 'platform_prompt.updated': '更新平台 Prompt', 'platform_prompt.deleted': '删除平台 Prompt',
  'content_humanization_prompt.saved': '保存自然化 Prompt', 'platform_type.deleted': '删除平台类型', 'platform_account.deleted': '删除平台账号',
  'product.created': '创建产品', 'product.updated': '更新产品', 'product.deleted': '删除产品', 'fact_version.approve': '批准事实版本', 'fact_version.deleted': '删除事实版本',
  'content_version.approve': '批准内容版本', 'content_version.deleted': '删除内容版本', 'content_task.deleted': '删除内容任务', 'content_task.permanently_deleted': '永久删除内容任务',
  'publication_work.completed': '完成发布工作', 'published_article.permanently_deleted': '永久删除发布成果',
  'query_topic.created': '创建问题主题', 'query_topic.updated': '更新问题主题', 'query_topic.deleted': '删除问题主题',
  'geo_observation.deleted': '删除 GEO 观测',
};

const auditFieldLabels: Record<string, string> = {
  account_type: '账号类型', is_active: '启用状态', source: '来源', status: '状态', row_count: '行数', revision: '修订号', display_name: '显示名称',
  product_id: '产品 ID', review_record_count: '审核记录数', version: '版本', fact_version_id: '事实版本 ID', platform_profile_id: '平台 ID', platform_profile_version_id: '平台版本 ID', platform_type_id: '平台类型 ID', previous_active_version_id: '原活动版本 ID', reason: '原因', replacement_version_id: '替代版本 ID',
  generation_job_count: '生成作业数', content_version_count: '内容版本数', content_review_record_count: '内容审核记录数', publication_work_count: '发布工作数', generation_data_classification: '生成数据分级', generation_input_configured: '生成输入配置状态',
  based_on_id: '基线版本 ID', content_version_id: '内容版本 ID', retry_of_id: '重试来源 ID', source_content_version_id: '来源内容版本 ID', task_id: '任务 ID',
  attachment_count: '附件数', publication_id: '发布成果 ID', publication_reference_count: '发布引用数', repair_task_id: '修复任务 ID', status_event_count: '状态事件数', trigger_status: '触发状态',
  article_count: '文章数', article_result_count: '文章结果数', observation_count: '观测数', publication_count: '发布数', query_topic_id: '问题主题 ID', root_observation_id: '根观测 ID', supersedes_id: '更正来源 ID',
  account_count: '账号数', allowed_domain_count: '允许域名数', bound_platform_count: '绑定平台数', bound_platform_ids: '绑定平台 ID', channel_id: '渠道 ID', configured: '配置状态', header_name: 'Header 名', is_sensitive: '敏感状态', model_count: '模型数', platform_account_count: '平台账号数', protocol_type: '协议类型', provider_brand: 'Provider', reference_count: '引用数', test_status: '测试状态', unbound_platform_count: '解绑平台数',
  access_level: '访问级别', category: '分类', size: '大小', is_configured: '配置状态', logo_configured: 'Logo 配置状态', name: '名称', website_configured: '网站配置状态',
};

type AuditActionLabelProjection =
  | { status: 'projected'; label: string }
  | { status: 'failed' };

function projectAuditActionLabel(action: string): AuditActionLabelProjection {
  const label = Object.hasOwn(auditActionLabels, action) ? auditActionLabels[action] : undefined;
  return label ? { status: 'projected', label } : { status: 'failed' };
}

function auditActionLabel(action: string) {
  const projection = projectAuditActionLabel(action);
  if (projection.status === 'failed') throw new Error(`审计返回未知动作：${action}`);
  return projection.label;
}

function formatAuditValue(value: AuditSafeValue): string {
  if (value === null) return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join('、') : '空数组';
  return String(value);
}

function projectAuditFacts(facts: Record<string, AuditSafeValue>): AuditDisplayItem[] {
  return Object.entries(facts).map(([field, value]) => {
    const label = auditFieldLabels[field];
    if (!label) throw new Error(`审计返回未登记事实字段：${field}`);
    return { field, label, value: formatAuditValue(value) };
  });
}

function projectAuditChanges(changes: AuditLogDetail['changes']): AuditDisplayChange[] {
  return changes.map((change) => {
    const label = auditFieldLabels[change.field];
    if (!label) throw new Error(`审计返回未登记变更字段：${change.field}`);
    return {
      field: change.field,
      label,
      before: Object.hasOwn(change, 'before') ? formatAuditValue(change.before ?? null) : '历史未记录',
      after: Object.hasOwn(change, 'after') ? formatAuditValue(change.after ?? null) : '历史未记录',
    };
  });
}

function resolveAuditRelatedLink(detail: AuditLogDetail): AuditRelatedLink | undefined {
  const related = detail.related_entry;
  if (related.status !== 'AVAILABLE') return undefined;
  const targetId = detail.target_id;
  switch (related.kind) {
    case 'Product': return targetId ? { href: `/products/${targetId}`, label: '查看产品' } : undefined;
    case 'FactVersion': return targetId && related.parent_id ? { href: `/products/${related.parent_id}/facts/versions/${targetId}`, label: '查看事实版本' } : undefined;
    case 'ContentTask': return targetId ? { href: `/content/tasks/${targetId}`, label: '查看内容任务' } : undefined;
    case 'ContentVersion': return related.parent_id ? { href: `/content/tasks/${related.parent_id}`, label: '查看所属任务' } : undefined;
    case 'PublicationWork': return targetId ? { href: `/publishing/work/${targetId}`, label: '查看发布工作' } : undefined;
    case 'PublishedContentIssue': return targetId ? { href: `/publishing/issues/${targetId}`, label: '查看内容问题' } : undefined;
    case 'GeoObservation': return targetId ? { href: `/geo/observations/${targetId}`, label: '查看 GEO 观测' } : undefined;
    case 'PlatformProfile': return targetId ? { href: `/settings/platforms/${targetId}`, label: '查看平台' } : undefined;
    case 'PlatformAccount': return related.parent_id ? { href: `/settings/platforms/${related.parent_id}?tab=accounts`, label: '查看平台账号' } : undefined;
    case 'AIChannel': return targetId ? { href: `/settings/ai/${targetId}?tab=basic`, label: '查看 AI 渠道' } : undefined;
    case 'AIModel': return related.parent_id ? { href: `/settings/ai/${related.parent_id}?tab=models`, label: '查看 AI 模型' } : undefined;
    default: return undefined;
  }
}

export {
  auditActionLabel,
  auditDefaultRange,
  auditModuleLabels,
  auditModuleValues,
  auditOutcomeLabels,
  auditOutcomeValues,
  auditResetSearch,
  auditSearchSchema,
  auditSearchToApiParams,
  canonicalAuditSearchRecord,
  formatAuditValue,
  fromBeijingDateTimeInput,
  initialAuditRange,
  isCanonicalAuditSearch,
  normalizeAuditPageSize,
  projectAuditActionLabel,
  projectAuditChanges,
  projectAuditFacts,
  resolveAuditRelatedLink,
  toBeijingDateTimeInput,
};
export type {
  AuditActionLabelProjection,
  AuditDisplayChange,
  AuditDisplayItem,
  AuditLog,
  AuditLogDetail,
  AuditModule,
  AuditOutcome,
  AuditRelatedLink,
  AuditSearch,
};
