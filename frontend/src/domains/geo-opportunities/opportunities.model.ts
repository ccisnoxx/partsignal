import { statusLabels, priorityLabels } from '@/shared/lib/geo-opportunity-labels';
import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { baseShape } from '@/domains/geo-insights/insights.model';

const sourceScopeShape = baseShape.extend({
  mention_mode: baseShape.shape.mention_mode.nullable(),
  review_policy: z.enum(['EFFECTIVE', 'REVIEWED_ONLY']).optional(),
}).strict(); // 保留服务端微秒及原时区；窗口先后由服务端按实际瞬时裁决。
const sourceScopeJson = z.string().transform((value, ctx) => {
  try { return JSON.parse(value) as unknown; }
  catch { ctx.addIssue({ code: 'custom', message: '来源范围必须是合法 JSON' }); return z.NEVER; }
}).pipe(sourceScopeShape);
// TanStack Router 会解析 URL 的 JSON 值；内部保留对象，仅在 API 边界编码字符串。
const sourceScopeParameter = z.union([sourceScopeShape, sourceScopeJson]);

export type Opportunity = components['schemas']['GeoOpportunityListItem'];
export type OpportunityDetail = components['schemas']['GeoOpportunityDetail'];
export type OpportunityList = components['schemas']['GeoOpportunityListPage'];
export type OpportunityComparisonRead = components['schemas']['GeoOpportunityComparisonRead'];
export type LegacyOpportunityAction = Extract<components['schemas']['GeoOpportunityAction'], 'ACKNOWLEDGE' | 'DISMISS'>;
export type OpportunityParams = NonNullable<operations['listGeoOpportunities']['parameters']['query']>;
export type SourceParams = NonNullable<operations['getGeoOpportunity']['parameters']['query']>;
export const stageLabels = { OPEN: '待确认', ACKNOWLEDGED: '已确认', IN_PROGRESS: '处理中', CLOSED: '已关闭' } satisfies Record<Opportunity['workflow_stage'], string>;
export const ruleLabels = {
  VISIBILITY_DROP: '可见度下降', RECOMMENDATION_DROP: '推荐率下降', COMPETITOR_SURGE: '竞品上升', TOPIC_COVERAGE_GAP: '主题覆盖缺口',
  OWN_CITATION_LOST: '自有引用丢失', CRITICAL_FACT_ERROR: '严重事实错误', REPEATED_FACT_ERROR: '重复事实错误', UNSTABLE_RESULT: '结果不稳定',
  DATA_QUALITY_PROBLEM: '数据质量问题', RUN_FAILURE: '运行失败',
} satisfies Record<Opportunity['rule_code'], string>;
export const primaryLabels = { ACKNOWLEDGE: '确认机会', VIEW_EVIDENCE: '查看证据' } satisfies Record<Opportunity['primary_task'], string>;
export const actionLabels = { ACKNOWLEDGE: '确认机会', DISMISS: '忽略机会', RESOLVE: '解决机会', CONTINUE: '继续跟进' } satisfies Record<components['schemas']['GeoOpportunityAction'], string>;
export const modeLabels = { MANUAL: '人工录入', API: 'API', BROWSER: '浏览器' } satisfies Record<components['schemas']['GeoCollectionMode'], string>;
export const sortLabels = { PRIORITY_DESC: '优先级从高到低', CREATED_DESC: '创建时间从新到旧', LAST_SEEN_DESC: '最近评估从新到旧' } satisfies Record<NonNullable<OpportunityParams['sort']>, string>;
const ids = ['subject_id', 'product_id', 'query_topic_id', 'prompt_variant_id', 'collection_profile_id', 'engine_surface_id', 'opportunity_id', 'retest_batch_id'] as const;
const shape = z.object({
  source_scope: sourceScopeParameter.optional(), open_only: z.literal(true).optional(),
  q: z.string().optional(), status: z.enum(Object.keys(statusLabels) as [Opportunity['status'], ...Opportunity['status'][]]).optional(),
  priority: z.enum(Object.keys(priorityLabels) as [Opportunity['priority'], ...Opportunity['priority'][]]).optional(),
  rule_code: z.enum(Object.keys(ruleLabels) as [Opportunity['rule_code'], ...Opportunity['rule_code'][]]).optional(),
  subject_id: canonicalUuidSchema.optional(), product_id: canonicalUuidSchema.optional(), query_topic_id: canonicalUuidSchema.optional(),
  prompt_variant_id: canonicalUuidSchema.optional(), collection_profile_id: canonicalUuidSchema.optional(), engine_surface_id: canonicalUuidSchema.optional(),
  collection_mode: z.enum(['MANUAL', 'API', 'BROWSER']).optional(), created_from: z.iso.datetime().optional(), created_to: z.iso.datetime().optional(),
  sort: z.enum(['CREATED_DESC', 'LAST_SEEN_DESC']).optional(), page: z.number().int().positive().optional(), page_size: z.union([z.literal(10), z.literal(50)]).optional(),
  opportunity_id: canonicalUuidSchema.optional(), retest_batch_id: canonicalUuidSchema.optional(), source_page: z.number().int().positive().optional(), source_page_size: z.union([z.literal(10), z.literal(50)]).optional(),
});
function known<T>(schema: z.ZodType<T>, value: unknown) { const result = schema.safeParse(value); return result.success ? result.data : undefined; }
function date(value: unknown) { const parsed = known(z.iso.datetime({ offset: true }), value); return parsed ? new Date(parsed).toISOString() : undefined; }
export const opportunitySearchSchema = z.preprocess((value) => {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalized: Record<string, unknown> = {};
  for (const key of ids) normalized[key] = known(canonicalUuidSchema, raw[key]);
  const from = date(raw.created_from); const to = date(raw.created_to);
  const page = Number(raw.page); const size = Number(raw.page_size); const sourcePage = Number(raw.source_page); const sourceSize = Number(raw.source_page_size);
  Object.assign(normalized, {
    source_scope: raw.source_scope,
    open_only: raw.open_only === true || raw.open_only === 'true' ? true : undefined,
    q: typeof raw.q === 'string' && !raw.q.includes('\0') && raw.q.trim().length <= 200 ? raw.q.trim() || undefined : undefined,
    status: known(shape.shape.status, raw.status), priority: known(shape.shape.priority, raw.priority), rule_code: known(shape.shape.rule_code, raw.rule_code),
    collection_mode: known(shape.shape.collection_mode, raw.collection_mode), sort: known(shape.shape.sort, raw.sort),
    created_from: from && to && from >= to ? undefined : from, created_to: from && to && from >= to ? undefined : to,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined, page_size: size === 10 || size === 50 ? size : undefined,
    source_page: normalized.opportunity_id && Number.isSafeInteger(sourcePage) && sourcePage > 1 ? sourcePage : undefined,
    source_page_size: normalized.opportunity_id && (sourceSize === 10 || sourceSize === 50) ? sourceSize : undefined,
    retest_batch_id: normalized.opportunity_id ? normalized.retest_batch_id : undefined,
  });
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => item !== undefined));
}, shape);
export type OpportunitySearch = z.output<typeof opportunitySearchSchema>;
export function opportunitySearchToParams(search: OpportunitySearch): OpportunityParams {
  return {
    source_scope: search.source_scope ? JSON.stringify(search.source_scope) : undefined, open_only: search.open_only,
    q: search.q, status: search.status, priority: search.priority, rule_code: search.rule_code,
    subject_id: search.subject_id, product_id: search.product_id, query_topic_id: search.query_topic_id,
    prompt_variant_id: search.prompt_variant_id, collection_profile_id: search.collection_profile_id, engine_surface_id: search.engine_surface_id,
    collection_mode: search.collection_mode, created_from: search.created_from, created_to: search.created_to,
    page: search.page ?? 1, page_size: search.page_size ?? 20, sort: search.sort ?? 'PRIORITY_DESC',
  };
}
export function opportunityExportUrl(search: OpportunitySearch) {
  const params: NonNullable<operations['exportGeoOpportunityWorkbenchCsv']['parameters']['query']> = opportunitySearchToParams(search);
  const url = new URL('/api/v1/geo/opportunities/export.csv', import.meta.env.VITE_API_BASE_URL || globalThis.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || key === 'page_size' || value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

export function sourceSearchToParams(search: OpportunitySearch): SourceParams { return { source_page: search.source_page ?? 1, source_page_size: search.source_page_size ?? 20 }; }
function sameSourceScope(raw: unknown, scope: NonNullable<OpportunitySearch['source_scope']>) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const fields = Object.entries(scope);
  // Router 的结构共享可能保留原键顺序；对象顺序不属于来源筛选语义。
  return Object.keys(raw).length === fields.length && fields.every(([key, value]) =>
    JSON.stringify((raw as Record<string, unknown>)[key]) === JSON.stringify(value));
}
export function isCanonicalOpportunitySearch(raw: Record<string, unknown>, search: OpportunitySearch) {
  return Object.keys(raw).length === Object.keys(search).length && Object.entries(search).every(([key, value]) => key === 'source_scope' ? sameSourceScope(raw[key], value as NonNullable<OpportunitySearch['source_scope']>) : String(raw[key]) === String(value));
}
const reason = (limit: number) => z.string().trim().min(1, '请填写忽略原因').refine((value) => Array.from(value).length <= limit, `最多 ${limit} 个字符`).refine((value) => !value.includes('\0'), '不能包含 NUL 字符');
export const dismissFormSchema = z.object({ resolution_code: reason(40), resolution_comment: reason(2000) });
export type DismissValues = z.output<typeof dismissFormSchema>;
const decisionReason = (limit: number) => z.string().trim().min(1, '请填写处理依据').refine((value) => Array.from(value).length <= limit, `最多 ${limit} 个字符`).refine((value) => !value.includes('\0'), '不能包含 NUL 字符');
export const decisionFormSchema = z.object({ resolution_code: decisionReason(40), resolution_comment: decisionReason(2000) });
export type DecisionValues = z.output<typeof decisionFormSchema>;
export function formatTime(value: string | null) { return value === null ? '未记录' : new Date(value).toLocaleString('zh-CN', { hour12: false }); }
export function formatValue(value: number | null) { return value === null ? '不可计算' : String(value); }
export function toUtcInput(value?: string) { return value ? new Date(value).toISOString().slice(0, -1) : ''; }
export function fromUtcInput(value: string) { return value ? new Date(`${value}Z`).toISOString() : undefined; }
