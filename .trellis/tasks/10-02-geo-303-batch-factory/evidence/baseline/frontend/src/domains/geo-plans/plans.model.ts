import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

type PlanDetail = components['schemas']['GeoMonitoringPlanDetail'];
type PlanPreview = components['schemas']['GeoMonitoringPlanPreview'];
type PlanCreate = components['schemas']['GeoMonitoringPlanCreate'];
type PlanListParams = NonNullable<operations['listGeoMonitoringPlans']['parameters']['query']>;
type PlanAction = PlanDetail['available_actions'][number];
const statusLabels = { DISABLED: '未启用', ACTIVE: '已启用', PAUSED: '已暂停', ARCHIVED: '已归档' } satisfies Record<PlanDetail['status'], string>;
const stageLabels = { CONFIGURATION_REQUIRED: '配置待修正', READY: '可以启用', ACTIVE: '已启用', PAUSED: '已暂停', ARCHIVED: '已归档' } satisfies Record<PlanDetail['workflow_stage'], string>;
const scheduleLabels = { MANUAL_ONLY: '手动触发', CRON: '定时配置' } satisfies Record<PlanDetail['schedule_kind'], string>;
const actionLabels = { UPDATE: '编辑计划', PREVIEW: '预览配置', ACTIVATE: '启用计划', PAUSE: '暂停计划', RESUME: '恢复计划', ARCHIVE: '归档计划', COPY: '复制为新计划', CREATE_REVISION: '修订配置', DELETE: '删除计划' } satisfies Record<PlanAction, string>;
const roleLabels = { PRIMARY: '主要监测对象', COMPETITOR: '竞品', REFERENCE: '参考对象' } satisfies Record<components['schemas']['GeoPlanSubjectRole'], string>;
const statuses = z.enum(['DISABLED', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const schedules = z.enum(['MANUAL_ONLY', 'CRON']);
function uuid(value: unknown) { const parsed = canonicalUuidSchema.safeParse(value); return parsed.success ? parsed.data : undefined; }
function enumValue<T>(schema: z.ZodType<T>, value: unknown) { const parsed = schema.safeParse(value); return parsed.success ? parsed.data : undefined; }
const planSearchSchema = z.preprocess((value) => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const page = Number(raw.page); const size = Number(raw.page_size);
  const creating = raw.new === 1 || raw.new === '1'; const selected = uuid(raw.selected);
  return {
    q: typeof raw.q === 'string' && !raw.q.includes('\0') && raw.q.trim().length <= 200 ? raw.q.trim() || undefined : undefined,
    status: enumValue(statuses, raw.status), schedule_kind: enumValue(schedules, raw.schedule_kind),
    sort: raw.sort === 'NAME_ASC' ? 'NAME_ASC' : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    page_size: size === 10 || size === 50 ? size : undefined,
    ...(creating ? { new: 1 } : { selected, edit: selected && (raw.edit === 1 || raw.edit === '1') ? 1 : undefined }),
  };
}, z.object({
  q: z.string().optional(), status: statuses.optional(), schedule_kind: schedules.optional(), sort: z.literal('NAME_ASC').optional(),
  page: z.number().int().positive().optional(), page_size: z.union([z.literal(10), z.literal(50)]).optional(),
  selected: canonicalUuidSchema.optional(), new: z.literal(1).optional(), edit: z.literal(1).optional(),
}).transform((value) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as typeof value));
type PlanSearch = z.output<typeof planSearchSchema>;
function planSearchToParams(search: PlanSearch): PlanListParams {
  return { q: search.q, status: search.status, schedule_kind: search.schedule_kind, page: search.page ?? 1, page_size: search.page_size ?? 20, sort: search.sort ?? 'UPDATED_DESC' };
}
function isCanonicalPlanSearch(raw: Record<string, unknown>, search: PlanSearch) { return Object.keys(raw).length === Object.keys(search).length && Object.entries(search).every(([key, value]) => String(raw[key]) === String(value)); }
function planEditorIdentity(search: PlanSearch) { return search.new ? 'new' : search.selected ? `${search.edit ? 'edit' : 'detail'}:${search.selected}` : 'none'; }
function shouldBlockPlanNavigation(current: { pathname: string; search: unknown }, next: { pathname: string; search: unknown }) { return current.pathname !== next.pathname || planEditorIdentity(planSearchSchema.parse(current.search)) !== planEditorIdentity(planSearchSchema.parse(next.search)); }
const idsSchema = z.array(canonicalUuidSchema).min(1, '请至少选择一个选项').refine((ids) => new Set(ids).size === ids.length, '选择不能重复');
const planFormSchema = z.object({
  name: z.string().min(1, '请填写计划名称').max(200, '名称最多 200 字符').refine((value) => value === value.trim() && !value.includes('\0'), '名称不能包含首尾空白或空字符'),
  description: z.string().refine((value) => !value.includes('\0'), '说明不能包含空字符'),
  subjects: z.array(z.object({ subject_id: canonicalUuidSchema, role: z.enum(['PRIMARY', 'COMPETITOR', 'REFERENCE']) })).min(1, '请选择监测对象').refine((items) => items.some((item) => item.role === 'PRIMARY'), '请至少选择一个主要监测对象').refine((items) => new Set(items.map((item) => item.subject_id)).size === items.length, '监测对象不能重复'),
  prompt_variant_ids: idsSchema, collection_profile_ids: idsSchema,
  repeat_count: z.number().int('重复次数必须为整数').min(1, '至少重复 1 次').max(10, '最多重复 10 次'),
  schedule_kind: schedules, cron_expression: z.string().max(120, 'Cron 最多 120 字符'),
  timezone: z.string().min(1, '请填写 IANA 时区').max(64, '时区最多 64 字符'),
  budget_limit: z.string().refine((value) => value === '' || /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/.test(value), '预算为非负十进制，最多 8 位整数、6 位小数'),
  rule_set_revision: z.number().int().min(1),
}).superRefine((value, context) => {
  if (value.schedule_kind === 'CRON' && value.cron_expression.trim().split(/\s+/).length !== 5) context.addIssue({ code: 'custom', path: ['cron_expression'], message: '请填写五字段 Cron；服务端会校验其执行语义' });
});
type PlanValues = z.input<typeof planFormSchema>;
function planValues(plan?: PlanDetail): PlanValues { return plan ? {
  name: plan.name, description: plan.description, subjects: plan.subjects.map((item) => ({ ...item })), prompt_variant_ids: [...plan.prompt_variant_ids], collection_profile_ids: [...plan.collection_profile_ids], repeat_count: plan.repeat_count, schedule_kind: plan.schedule_kind, cron_expression: plan.cron_expression ?? '', timezone: plan.timezone, budget_limit: plan.budget_limit ?? '', rule_set_revision: plan.rule_set_revision,
} : { name: '', description: '', subjects: [], prompt_variant_ids: [], collection_profile_ids: [], repeat_count: 3, schedule_kind: 'MANUAL_ONLY', cron_expression: '', timezone: 'Asia/Shanghai', budget_limit: '', rule_set_revision: 1 }; }
function planCreate(values: PlanValues): PlanCreate { return { ...values, cron_expression: values.schedule_kind === 'CRON' ? values.cron_expression : null, budget_limit: values.budget_limit === '' ? null : values.budget_limit }; }
function planUpdate(values: PlanValues, revision: number): components['schemas']['GeoMonitoringPlanUpdate'] { return { ...planCreate(values), expected_revision: revision }; }
function assertNever(value: never): never { throw new Error(`计划返回未知合同值：${String(value)}`); }
export { actionLabels, assertNever, isCanonicalPlanSearch, planCreate, planEditorIdentity, planFormSchema, planSearchSchema, planSearchToParams, planUpdate, planValues, roleLabels, scheduleLabels, shouldBlockPlanNavigation, stageLabels, statusLabels };
export type { PlanAction, PlanCreate, PlanDetail, PlanListParams, PlanPreview, PlanSearch, PlanValues };
