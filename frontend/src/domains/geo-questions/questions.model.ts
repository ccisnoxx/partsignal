import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

type PromptVariant = components['schemas']['GeoPromptVariantOut'];
type QuestionListParams = NonNullable<operations['listGeoPromptVariants']['parameters']['query']>;
const mentionLabels = { BRANDED: '点名', UNBRANDED: '非点名' } satisfies Record<PromptVariant['mention_mode'], string>;
const priorityLabels = { CORE: '核心', STANDARD: '标准', EXPLORATORY: '探索' } satisfies Record<PromptVariant['priority'], string>;
const intentLabels = { BRAND: '品牌', PRODUCT: '产品', REPLACEMENT: '替代', COMPARISON: '对比', APPLICATION: '应用', TROUBLESHOOTING: '故障排查' } satisfies Record<PromptVariant['query_topic']['intent_type'], string>;
const stageLabels = { ACTIVE: '已启用', DISABLED: '已停用', REFERENCED: '已引用' } satisfies Record<PromptVariant['workflow_stage'], string>;
const actionLabels = { UPDATE: '编辑变体', ENABLE: '启用变体', DISABLE: '停用变体', DELETE: '删除变体', COPY: '复制为新变体' } satisfies Record<PromptVariant['available_actions'][number], string>;
const mentionSchema = z.enum(['BRANDED', 'UNBRANDED']);
const prioritySchema = z.enum(['CORE', 'STANDARD', 'EXPLORATORY']);
const intentSchema = z.enum(['BRAND', 'PRODUCT', 'REPLACEMENT', 'COMPARISON', 'APPLICATION', 'TROUBLESHOOTING']);

function text(value: unknown, maximum: number) {
  return typeof value === 'string' && !value.includes('\0') && value.trim().length <= maximum ? value.trim() || undefined : undefined;
}
function uuid(value: unknown) {
  const parsed = canonicalUuidSchema.safeParse(typeof value === 'string' ? value.trim() : value);
  return parsed.success ? parsed.data : undefined;
}
function enumValue<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const questionSearchSchema = z.preprocess((value) => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const page = Number(raw.page);
  const pageSize = Number(raw.page_size);
  const creating = raw.new === 1 || raw.new === '1';
  const copy = uuid(raw.copy);
  return {
    q: text(raw.q, 240), query_topic_id: uuid(raw.query_topic_id),
    intent_type: enumValue(intentSchema, raw.intent_type), mention_mode: enumValue(mentionSchema, raw.mention_mode),
    language_code: typeof raw.language_code === 'string' && /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(raw.language_code) ? text(raw.language_code, 16)?.toLowerCase() : undefined,
    region_code: typeof raw.region_code === 'string' && /^[a-zA-Z]{2}$/.test(raw.region_code) ? raw.region_code.toUpperCase() : undefined,
    priority: enumValue(prioritySchema, raw.priority),
    is_active: raw.is_active === true || raw.is_active === 'true' ? true : raw.is_active === false || raw.is_active === 'false' ? false : undefined,
    sort: raw.sort === 'TEXT_ASC' ? 'TEXT_ASC' : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    page_size: pageSize === 10 || pageSize === 50 ? pageSize : undefined,
    ...(creating ? { new: 1 } : copy ? { copy } : { selected: uuid(raw.selected) }),
  };
}, z.object({
  q: z.string().optional(), query_topic_id: canonicalUuidSchema.optional(), intent_type: intentSchema.optional(),
  mention_mode: mentionSchema.optional(), language_code: z.string().optional(), region_code: z.string().optional(),
  priority: prioritySchema.optional(), is_active: z.boolean().optional(), sort: z.literal('TEXT_ASC').optional(),
  page: z.number().int().positive().optional(), page_size: z.union([z.literal(10), z.literal(50)]).optional(),
  selected: canonicalUuidSchema.optional(), new: z.literal(1).optional(), copy: canonicalUuidSchema.optional(),
}).transform((parsed) => Object.fromEntries(Object.entries(parsed).filter(([, entry]) => entry !== undefined)) as typeof parsed));
type QuestionSearch = z.output<typeof questionSearchSchema>;

function questionSearchToParams(search: QuestionSearch): QuestionListParams {
  const filters = { ...search };
  delete filters.selected; delete filters.new; delete filters.copy;
  return { ...filters, page: search.page ?? 1, page_size: search.page_size ?? 20, sort: search.sort ?? 'UPDATED_DESC' };
}
function isCanonicalQuestionSearch(raw: Record<string, unknown>, search: QuestionSearch) {
  return Object.keys(raw).length === Object.keys(search).length && Object.entries(search).every(([key, value]) => String(raw[key]) === String(value));
}
function questionEditorIdentity(search: QuestionSearch) {
  return search.new ? 'new' : search.copy ? `copy:${search.copy}` : search.selected ? `variant:${search.selected}` : 'none';
}
function shouldBlockQuestionNavigation(current: { pathname: string; search: unknown }, next: { pathname: string; search: unknown }) {
  return current.pathname !== next.pathname || questionEditorIdentity(questionSearchSchema.parse(current.search)) !== questionEditorIdentity(questionSearchSchema.parse(next.search));
}

const questionFormSchema = z.object({
  query_topic_id: canonicalUuidSchema,
  prompt_text: z.string().min(1, '请填写完整问题文本').max(8000, '问题文本不能超过 8000 字符').refine((value) => value.trim().length > 0 && !value.includes('\0'), '问题文本不能只有空白或包含空字符'),
  mention_mode: mentionSchema.or(z.literal('')).refine((value) => value !== '', '请显式选择点名属性'),
  language_code: z.string().regex(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/, '请填写语言标签，例如 zh-CN').max(16, '语言标签不能超过 16 字符'),
  region_code: z.string().regex(/^[a-zA-Z]{2}$/, '请填写两位地区代码，例如 CN'),
  priority: prioritySchema.or(z.literal('')).refine((value) => value !== '', '请显式选择优先级'),
});
type QuestionValues = z.input<typeof questionFormSchema>;
function questionValues(variant?: PromptVariant): QuestionValues {
  return variant ? { query_topic_id: variant.query_topic_id, prompt_text: variant.prompt_text, mention_mode: variant.mention_mode, language_code: variant.language_code, region_code: variant.region_code, priority: variant.priority }
    : { query_topic_id: '', prompt_text: '', mention_mode: '', language_code: '', region_code: '', priority: '' };
}
function questionCreate(values: QuestionValues): components['schemas']['GeoPromptVariantCreate'] {
  return { ...values, mention_mode: mentionSchema.parse(values.mention_mode), priority: prioritySchema.parse(values.priority) };
}
function questionUpdate(values: QuestionValues, revision: number): components['schemas']['GeoPromptVariantUpdate'] {
  const body = questionCreate(values);
  return { expected_revision: revision, prompt_text: body.prompt_text, mention_mode: body.mention_mode, language_code: body.language_code, region_code: body.region_code, priority: body.priority };
}
function assertNever(value: never): never { throw new Error(`问题库返回未知合同值：${String(value)}`); }

export { actionLabels, assertNever, intentLabels, isCanonicalQuestionSearch, mentionLabels, priorityLabels, questionCreate, questionEditorIdentity, questionFormSchema, questionSearchSchema, questionSearchToParams, questionUpdate, questionValues, shouldBlockQuestionNavigation, stageLabels };
export type { PromptVariant, QuestionListParams, QuestionSearch, QuestionValues };
