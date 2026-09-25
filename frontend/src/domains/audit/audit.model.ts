import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type AuditLog = components['schemas']['AuditLog'];
type AuditLogList = components['schemas']['AuditLogList'];
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
const auditAccountTypeValues = ['ADMIN', 'ENGINEER'] as const;
const auditRelatedStatusValues = ['AVAILABLE', 'MISSING', 'UNSUPPORTED'] as const;
// 与后端 audit_logs._related_entry 的登记类型及 parent_id 语义保持一一对应。
const auditRelatedRegistry = new Map<string, 'NONE' | 'AVAILABLE' | 'MISSING'>([
  ['Product', 'NONE'],
  ['FactVersion', 'AVAILABLE'],
  ['ContentTask', 'NONE'],
  ['ContentVersion', 'AVAILABLE'],
  ['PublicationWork', 'NONE'],
  ['PublishedContentIssue', 'NONE'],
  ['GeoObservation', 'NONE'],
  ['PlatformProfile', 'NONE'],
  ['PlatformProfileVersion', 'MISSING'],
  ['PlatformAccount', 'AVAILABLE'],
  ['AIChannel', 'NONE'],
  ['AIModel', 'AVAILABLE'],
]);
const auditRuntimeProjectionErrorMessage = '审计响应安全投影失败';

const auditFactFields: Record<AuditModule, ReadonlySet<string>> = {
  IDENTITY: new Set(['account_type', 'is_active', 'source', 'status', 'row_count', 'revision']),
  PRODUCT_FACTS: new Set(['product_id', 'review_record_count', 'revision', 'status', 'version']),
  CONTENT_PLANNING: new Set([
    'content_review_record_count', 'content_version_count', 'fact_version_id', 'generation_job_count',
    'platform_profile_id', 'platform_profile_version_id', 'platform_type_id', 'previous_active_version_id',
    'publication_work_count', 'reason', 'replacement_version_id', 'revision', 'status', 'version',
  ]),
  CONTENT_PRODUCTION: new Set([
    'based_on_id', 'content_version_id', 'retry_of_id', 'source_content_version_id', 'task_id', 'version',
  ]),
  CONTENT_REVIEW: new Set(['revision', 'status']),
  PUBLICATION: new Set([
    'attachment_count', 'content_version_id', 'fact_version_id', 'platform_profile_id',
    'platform_profile_version_id', 'publication_id', 'publication_reference_count', 'repair_task_id',
    'revision', 'status', 'status_event_count', 'task_id', 'trigger_status',
  ]),
  GEO_OBSERVATION: new Set([
    'article_count', 'article_result_count', 'attachment_count', 'observation_count', 'product_id',
    'publication_count', 'query_topic_id', 'root_observation_id', 'supersedes_id',
  ]),
  CONFIGURATION: new Set([
    'account_count', 'allowed_domain_count', 'bound_platform_count', 'bound_platform_ids', 'channel_id',
    'configured', 'header_name', 'is_active', 'is_sensitive', 'model_count', 'platform_account_count',
    'platform_profile_id', 'platform_type_id', 'previous_active_version_id', 'protocol_type',
    'provider_brand', 'reason', 'reference_count', 'replacement_version_id', 'revision', 'status',
    'test_status', 'unbound_platform_count', 'version',
  ]),
  FILE_MANAGEMENT: new Set(['access_level', 'category', 'size', 'status']),
};

const auditChangeFields: Record<AuditModule, ReadonlySet<string>> = {
  IDENTITY: new Set(['account_type', 'display_name', 'is_active']),
  PRODUCT_FACTS: new Set(['status']),
  CONTENT_PLANNING: new Set(['generation_data_classification', 'generation_input_configured', 'status']),
  CONTENT_PRODUCTION: new Set(),
  CONTENT_REVIEW: new Set(['status']),
  PUBLICATION: new Set(['is_active', 'status']),
  GEO_OBSERVATION: new Set(),
  CONFIGURATION: new Set([
    'allowed_domain_count', 'is_active', 'is_configured', 'logo_configured', 'name', 'platform_type_id',
    'revision', 'status', 'website_configured',
  ]),
  FILE_MANAGEMENT: new Set(['status']),
};

type RuntimeRecord = Record<string, unknown>;

function auditRuntimeProjectionFailed(): Error {
  return new Error(auditRuntimeProjectionErrorMessage);
}

function runtimeRecord(value: unknown): RuntimeRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw auditRuntimeProjectionFailed();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw auditRuntimeProjectionFailed();
  }
  return value as RuntimeRecord;
}

function exactOwnKeys(record: RuntimeRecord, allowedKeys: readonly string[]) {
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== allowedKeys.length
    || ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
  ) {
    throw auditRuntimeProjectionFailed();
  }
}

function ownValue(record: RuntimeRecord, key: string): unknown {
  if (!Object.hasOwn(record, key)) throw auditRuntimeProjectionFailed();
  return record[key];
}

function runtimeString(record: RuntimeRecord, key: string): string {
  const value = ownValue(record, key);
  if (typeof value !== 'string') throw auditRuntimeProjectionFailed();
  return value;
}

function runtimeNullableString(record: RuntimeRecord, key: string): string | null {
  const value = ownValue(record, key);
  if (value !== null && typeof value !== 'string') throw auditRuntimeProjectionFailed();
  return value;
}

function canonicalRuntimeUuid(value: string): string {
  // OpenAPI UUID 字段由 Pydantic 以标准连字符形式序列化；大小写不改变 PostgreSQL UUID 身份。
  if (!z.uuid().safeParse(value).success) throw auditRuntimeProjectionFailed();
  return value.toLowerCase();
}

function runtimeUuid(record: RuntimeRecord, key: string): string {
  return canonicalRuntimeUuid(runtimeString(record, key));
}

function runtimeNullableUuid(record: RuntimeRecord, key: string): string | null {
  const value = runtimeNullableString(record, key);
  return value === null ? null : canonicalRuntimeUuid(value);
}

function runtimeDateTime(record: RuntimeRecord, key: string): string {
  const value = runtimeString(record, key);
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) throw auditRuntimeProjectionFailed();
  return value;
}

function runtimeEnum<const T extends readonly string[]>(
  record: RuntimeRecord,
  key: string,
  values: T,
): T[number] {
  const value = runtimeString(record, key);
  if (!values.includes(value)) throw auditRuntimeProjectionFailed();
  return value as T[number];
}

function runtimePositiveInteger(record: RuntimeRecord, key: string): number {
  const value = ownValue(record, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw auditRuntimeProjectionFailed();
  }
  return value;
}

function runtimeNonNegativeInteger(record: RuntimeRecord, key: string): number {
  const value = ownValue(record, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw auditRuntimeProjectionFailed();
  }
  return value;
}

function runtimeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw auditRuntimeProjectionFailed();
  if (Object.getPrototypeOf(value) !== Array.prototype) throw auditRuntimeProjectionFailed();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || !ownKeys.includes('length')
    || Array.from({ length: value.length }, (_, index) => String(index))
      .some((key) => !ownKeys.includes(key))
  ) {
    throw auditRuntimeProjectionFailed();
  }
  return value;
}

function projectRuntimeAuditActor(value: unknown, strict: boolean): AuditLog['actor'] {
  if (value === null) return null;
  const actor = runtimeRecord(value);
  if (strict) exactOwnKeys(actor, ['id', 'display_name', 'account_type']);
  return {
    id: runtimeUuid(actor, 'id'),
    display_name: runtimeString(actor, 'display_name'),
    account_type: runtimeEnum(actor, 'account_type', auditAccountTypeValues),
  };
}

function projectRuntimeAuditLog(value: unknown, strictNested: boolean): AuditLog {
  const log = runtimeRecord(value);
  const actorId = runtimeNullableUuid(log, 'actor_id');
  const actor = projectRuntimeAuditActor(ownValue(log, 'actor'), strictNested);
  if (
    (actorId === null) !== (actor === null)
    || (actorId !== null && actor !== null && actor.id !== actorId)
  ) {
    throw auditRuntimeProjectionFailed();
  }
  return {
    id: runtimeUuid(log, 'id'),
    actor_id: actorId,
    actor,
    business_module: runtimeEnum(log, 'business_module', auditModuleValues),
    action: runtimeString(log, 'action'),
    target_type: runtimeString(log, 'target_type'),
    target_id: runtimeNullableString(log, 'target_id'),
    outcome: runtimeEnum(log, 'outcome', auditOutcomeValues),
    primary_task: runtimeEnum(log, 'primary_task', ['VIEW_LOG_DETAIL'] as const),
    request_id: runtimeString(log, 'request_id'),
    created_at: runtimeDateTime(log, 'created_at'),
  };
}

function projectAuditSafeValue(value: unknown): AuditSafeValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  return runtimeArray(value).map((item) => {
    if (
      item === null
      || typeof item === 'string'
      || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))
    ) {
      return item;
    }
    throw auditRuntimeProjectionFailed();
  });
}

function projectRuntimeAuditChanges(value: unknown, module: AuditModule): AuditLogDetail['changes'] {
  return runtimeArray(value).map((item) => {
    const change = runtimeRecord(item);
    const hasBefore = Object.hasOwn(change, 'before');
    const hasAfter = Object.hasOwn(change, 'after');
    exactOwnKeys(change, [
      'field',
      ...(hasBefore ? ['before'] : []),
      ...(hasAfter ? ['after'] : []),
    ]);
    if (!hasBefore && !hasAfter) throw auditRuntimeProjectionFailed();
    const field = runtimeString(change, 'field');
    if (!auditChangeFields[module].has(field)) throw auditRuntimeProjectionFailed();
    return {
      field,
      ...(hasBefore ? { before: projectAuditSafeValue(ownValue(change, 'before')) } : {}),
      ...(hasAfter ? { after: projectAuditSafeValue(ownValue(change, 'after')) } : {}),
    };
  });
}

function projectRuntimeAuditFacts(value: unknown, module: AuditModule): AuditLogDetail['facts'] {
  const rawFacts = runtimeRecord(value);
  const facts: AuditLogDetail['facts'] = {};
  for (const key of Reflect.ownKeys(rawFacts)) {
    if (typeof key !== 'string' || !auditFactFields[module].has(key)) {
      throw auditRuntimeProjectionFailed();
    }
    facts[key] = projectAuditSafeValue(ownValue(rawFacts, key));
  }
  return facts;
}

function projectRuntimeRelatedEntry(
  value: unknown,
  target: Pick<AuditLog, 'target_id' | 'target_type'>,
): {
  relatedEntry: AuditLogDetail['related_entry'];
  targetId: AuditLog['target_id'];
} {
  const related = runtimeRecord(value);
  exactOwnKeys(related, ['status', 'kind', 'parent_id']);
  const status = runtimeEnum(related, 'status', auditRelatedStatusValues);
  const kind = runtimeNullableString(related, 'kind');
  const parentId = runtimeNullableString(related, 'parent_id');
  const parentContract = auditRelatedRegistry.get(target.target_type);

  if (parentContract === undefined) {
    if (status !== 'UNSUPPORTED' || kind !== null || parentId !== null) {
      throw auditRuntimeProjectionFailed();
    }
    return { relatedEntry: { status, kind, parent_id: parentId }, targetId: target.target_id };
  }
  if (status === 'UNSUPPORTED' || kind !== target.target_type) {
    throw auditRuntimeProjectionFailed();
  }
  if (parentContract === 'MISSING') {
    if (status !== 'MISSING') throw auditRuntimeProjectionFailed();
    return { relatedEntry: { status, kind, parent_id: parentId }, targetId: target.target_id };
  }
  const targetId = status === 'AVAILABLE'
    ? canonicalRuntimeUuid(target.target_id ?? '')
    : target.target_id;
  if (parentContract === 'NONE') {
    if (parentId !== null) throw auditRuntimeProjectionFailed();
    return { relatedEntry: { status, kind, parent_id: parentId }, targetId };
  }
  if (status === 'AVAILABLE') {
    if (parentId === null) throw auditRuntimeProjectionFailed();
    return {
      relatedEntry: { status, kind, parent_id: canonicalRuntimeUuid(parentId) },
      targetId,
    };
  }
  if (parentId !== null) throw auditRuntimeProjectionFailed();
  return { relatedEntry: { status, kind, parent_id: parentId }, targetId };
}

function parseAuditLogListResponse(
  value: unknown,
  requested: Pick<AuditLogList, 'page' | 'page_size'>,
): AuditLogList {
  try {
    const response = runtimeRecord(value);
    const items = runtimeArray(ownValue(response, 'items'));
    const page = runtimePositiveInteger(response, 'page');
    const pageSize = runtimePositiveInteger(response, 'page_size');
    if (page !== requested.page || pageSize !== requested.page_size) {
      throw auditRuntimeProjectionFailed();
    }
    return {
      items: items.map((item) => projectRuntimeAuditLog(item, false)),
      page,
      page_size: pageSize,
      total: runtimeNonNegativeInteger(response, 'total'),
    };
  } catch {
    throw auditRuntimeProjectionFailed();
  }
}

function parseAuditLogDetailResponse(value: unknown, requestedLogId: string): AuditLogDetail {
  try {
    const response = runtimeRecord(value);
    exactOwnKeys(response, [
      'id', 'actor_id', 'actor', 'business_module', 'action', 'target_type', 'target_id', 'outcome',
      'primary_task', 'request_id', 'created_at', 'changes', 'facts', 'result_message', 'error_code',
      'related_entry',
    ]);
    const base = projectRuntimeAuditLog(response, true);
    if (base.id !== canonicalRuntimeUuid(requestedLogId)) throw auditRuntimeProjectionFailed();
    const related = projectRuntimeRelatedEntry(ownValue(response, 'related_entry'), base);
    return {
      ...base,
      target_id: related.targetId,
      changes: projectRuntimeAuditChanges(ownValue(response, 'changes'), base.business_module),
      facts: projectRuntimeAuditFacts(ownValue(response, 'facts'), base.business_module),
      result_message: runtimeString(response, 'result_message'),
      error_code: runtimeNullableString(response, 'error_code'),
      related_entry: related.relatedEntry,
    };
  } catch {
    throw auditRuntimeProjectionFailed();
  }
}

function initialAuditRange(now = new Date()) {
  return {
    createdFrom: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000).toISOString(),
    createdTo: now.toISOString(),
  };
}

function auditDefaultRange(now = new Date()) {
  return initialAuditRange(now);
}

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

const auditSearchSchema = z.preprocess((raw) => {
  const defaults = auditDefaultRange();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const createdFrom = normalizeIso(input.createdFrom, defaults.createdFrom);
  const createdTo = normalizeIso(input.createdTo, defaults.createdTo);
  const range = new Date(createdFrom) < new Date(createdTo)
    ? { createdFrom, createdTo }
    : defaults;
  return { ...input, ...range };
}, z.object({
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number().pipe(z.union(auditPageSizeValues.map((value) => z.literal(value)))).catch(20).default(20),
  createdFrom: z.iso.datetime(),
  createdTo: z.iso.datetime(),
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
}))

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
  return auditSearchSchema.parse({});
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
  if (projection.status === 'failed') throw new Error('审计返回未知动作');
  return projection.label;
}

function formatAuditScalar(value: unknown): string {
  if (value === null) return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error('审计详情包含无法安全展示的值');
}

function formatAuditValue(value: AuditSafeValue): string {
  if (Array.isArray(value)) {
    return value.length ? value.map(formatAuditScalar).join('、') : '空数组';
  }
  return formatAuditScalar(value);
}

function auditFieldLabel(field: string) {
  if (!Object.hasOwn(auditFieldLabels, field)) {
    throw new Error('审计详情包含未登记字段');
  }
  return auditFieldLabels[field]!;
}

function projectAuditFacts(facts: Record<string, AuditSafeValue>): AuditDisplayItem[] {
  return Object.entries(facts).map(([field, value]) => {
    const label = auditFieldLabel(field);
    return { field, label, value: formatAuditValue(value) };
  });
}

function projectAuditChanges(changes: AuditLogDetail['changes']): AuditDisplayChange[] {
  return changes.map((change) => {
    const label = auditFieldLabel(change.field);
    return {
      field: change.field,
      label,
      before: Object.hasOwn(change, 'before') ? formatAuditValue(change.before ?? null) : '历史未记录',
      after: Object.hasOwn(change, 'after') ? formatAuditValue(change.after ?? null) : '历史未记录',
    };
  });
}

function resolveAuditRelatedLink(detail: AuditLogDetail): AuditRelatedLink | undefined {
  const projection = projectRuntimeRelatedEntry(detail.related_entry, detail);
  const related = projection.relatedEntry;
  if (related.status !== 'AVAILABLE') return undefined;
  const targetId = projection.targetId;
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
    default: throw auditRuntimeProjectionFailed();
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
  parseAuditLogDetailResponse,
  parseAuditLogListResponse,
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
  AuditLogList,
  AuditLogDetail,
  AuditModule,
  AuditOutcome,
  AuditRelatedLink,
  AuditSearch,
};
