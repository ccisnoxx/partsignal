import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

type Subject = components['schemas']['GeoSubjectOut'];
type CatalogListApiParams = NonNullable<operations['listGeoSubjects']['parameters']['query']>;
type SubjectType = components['schemas']['GeoSubjectType'];

const subjectTypeLabels = {
  OWN_BRAND: '自有品牌',
  OWN_PRODUCT: '自有产品',
  COMPETITOR_BRAND: '竞品品牌',
  COMPETITOR_PRODUCT: '竞品产品',
  REFERENCE_PART: '参考型号',
} satisfies Record<SubjectType, string>;

const aliasKindLabels = {
  NAME: '名称',
  PART_NUMBER: '型号',
  ABBREVIATION: '缩写',
  LEGACY: '历史名称',
} satisfies Record<components['schemas']['GeoSubjectAliasKind'], string>;

const domainRelationLabels = {
  OWNED: '自有域名',
  OFFICIAL: '官方域名',
  DISTRIBUTOR: '分销商域名',
  OTHER: '其他域名',
} satisfies Record<components['schemas']['GeoSubjectDomainRelationType'], string>;

const blockerLabels = {
  CHILD_SUBJECT: '子对象',
  MONITORING_PLAN: '监测计划',
  OBSERVATION_RUN: '观测运行',
  ANALYSIS: '分析记录',
  OPPORTUNITY: '机会记录',
} satisfies Record<components['schemas']['GeoSubjectDeletionBlockerType'], string>;

const stageLabels = {
  ACTIVE: '已启用',
  DISABLED: '已停用',
} satisfies Record<components['schemas']['GeoSubjectWorkflowStage'], string>;

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 240 ? trimmed : undefined;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const parsed = canonicalUuidSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function normalizeBoolean(value: unknown) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function normalizePage(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 1 ? number : undefined;
}

function normalizePageSize(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return number === 10 || number === 50 ? number : undefined;
}

const subjectTypes = Object.keys(subjectTypeLabels) as [SubjectType, ...SubjectType[]];
const subjectTypeSchema = z.enum(subjectTypes);

const catalogSearchSchema = z.preprocess((value) => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const q = normalizeText(raw.q);
  const subjectType = subjectTypeSchema.safeParse(raw.subject_type);
  const isActive = normalizeBoolean(raw.is_active);
  const productId = normalizeUuid(raw.product_id);
  const parentSubjectId = normalizeUuid(raw.parent_subject_id);
  const subjectId = normalizeUuid(raw.subject_id);
  const page = normalizePage(raw.page);
  const pageSize = normalizePageSize(raw.page_size);
  const creating = raw.new === 1 || raw.new === '1';
  return {
    ...(q ? { q } : {}),
    ...(subjectType.success ? { subject_type: subjectType.data } : {}),
    ...(isActive !== undefined ? { is_active: isActive } : {}),
    ...(productId ? { product_id: productId } : {}),
    ...(parentSubjectId ? { parent_subject_id: parentSubjectId } : {}),
    ...(raw.sort === 'UPDATED_DESC' ? { sort: raw.sort } : {}),
    ...(page ? { page } : {}),
    ...(pageSize ? { page_size: pageSize } : {}),
    ...(creating ? { new: 1 } : subjectId ? { subject_id: subjectId } : {}),
  };
}, z.object({
  q: z.string().max(240).optional(),
  subject_type: subjectTypeSchema.optional(),
  is_active: z.boolean().optional(),
  product_id: z.uuid().optional(),
  parent_subject_id: z.uuid().optional(),
  sort: z.enum(['NAME_ASC', 'UPDATED_DESC']).optional(),
  page: z.number().int().positive().optional(),
  page_size: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
  subject_id: z.uuid().optional(),
  new: z.literal(1).optional(),
}));

type CatalogSearch = z.output<typeof catalogSearchSchema>;

function catalogSearchToApiParams(search: CatalogSearch): CatalogListApiParams {
  return {
    page: search.page ?? 1,
    page_size: search.page_size ?? 20,
    sort: search.sort ?? 'NAME_ASC',
    ...(search.q ? { q: search.q } : {}),
    ...(search.subject_type ? { subject_type: search.subject_type } : {}),
    ...(search.is_active !== undefined ? { is_active: search.is_active } : {}),
    ...(search.product_id ? { product_id: search.product_id } : {}),
    ...(search.parent_subject_id ? { parent_subject_id: search.parent_subject_id } : {}),
  };
}

function isCanonicalCatalogSearch(raw: Record<string, unknown>, search: CatalogSearch) {
  return Object.keys(raw).length === Object.keys(search).length
    && Object.entries(search).every(([key, value]) => (
      (typeof raw[key] === 'string' || typeof raw[key] === typeof value)
      && String(raw[key]) === String(value)
    ));
}

function catalogEditorIdentity(search: Pick<CatalogSearch, 'new' | 'subject_id'>) {
  if (search.new === 1) return 'new';
  return search.subject_id ? `subject:${search.subject_id}` : 'none';
}

function shouldBlockCatalogNavigation(
  current: { pathname: string; search: unknown },
  next: { pathname: string; search: unknown },
) {
  if (current.pathname !== next.pathname) return true;
  return catalogEditorIdentity(catalogSearchSchema.parse(current.search))
    !== catalogEditorIdentity(catalogSearchSchema.parse(next.search));
}

export {
  aliasKindLabels,
  blockerLabels,
  catalogEditorIdentity,
  catalogSearchSchema,
  catalogSearchToApiParams,
  domainRelationLabels,
  isCanonicalCatalogSearch,
  shouldBlockCatalogNavigation,
  stageLabels,
  subjectTypeLabels,
};
export type { CatalogListApiParams, CatalogSearch, Subject };
