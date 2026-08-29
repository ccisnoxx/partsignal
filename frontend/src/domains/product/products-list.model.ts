import type { SortingState } from '@tanstack/react-table';
import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type ProductListItem = components['schemas']['ProductListItem'];
type ProductFactStatus = components['schemas']['ProductFactStatus'];
type ProductWorkflowStage = components['schemas']['ProductWorkflowStage'];
type ProductSort = components['schemas']['ProductSort'];
type ProductsApiParams = NonNullable<operations['listProducts']['parameters']['query']>;

const productSortValues = [
  'UPDATED_DESC',
  'UPDATED_ASC',
  'MODEL_ASC',
  'MODEL_DESC',
] as const satisfies readonly ProductSort[];
const productFactStatusValues = [
  'NOT_ENTERED',
  'PENDING_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'RETIRED',
] as const satisfies readonly ProductFactStatus[];
const productWorkflowStageValues = [
  'FACTS_EMPTY',
  'FACTS_EDITING',
  'FACT_REVIEW_PENDING',
  'FACT_CHANGES_REQUESTED',
  'FACT_APPROVED',
  'RETIRED',
] as const satisfies readonly ProductWorkflowStage[];

function normalizeSearchText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeFactStatus(value: unknown) {
  return typeof value === 'string' && productFactStatusValues.some((status) => status === value)
    ? value
    : undefined;
}

function normalizeWorkflowStage(value: unknown) {
  return typeof value === 'string' && productWorkflowStageValues.some((stage) => stage === value)
    ? value
    : undefined;
}

const productsSearchSchema = z.object({
  q: z.preprocess(normalizeSearchText, z.string().max(200).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(20), z.literal(50)])).catch(20).default(20),
  sort: z.enum(productSortValues).catch('UPDATED_DESC').default('UPDATED_DESC'),
  factStatus: z.preprocess(normalizeFactStatus, z.enum(productFactStatusValues).optional()),
  workflowStage: z.preprocess(normalizeWorkflowStage, z.enum(productWorkflowStageValues).optional()),
});

type ProductsSearch = z.output<typeof productsSearchSchema>;

function productsSearchToApiParams(search: ProductsSearch): ProductsApiParams {
  return {
    page: search.page,
    page_size: search.pageSize,
    search: search.q,
    sort: search.sort,
    fact_status: search.factStatus,
    workflow_stage: search.workflowStage,
  };
}

function canonicalProductsSearchRecord(search: ProductsSearch): Record<string, string | number> {
  const record: Record<string, string | number> = {};
  if (search.q) record.q = search.q;
  record.page = search.page;
  if (search.pageSize !== 20) record.pageSize = search.pageSize;
  if (search.sort !== 'UPDATED_DESC') record.sort = search.sort;
  if (search.factStatus) record.factStatus = search.factStatus;
  if (search.workflowStage) record.workflowStage = search.workflowStage;
  return record;
}

function isCanonicalProductsSearch(raw: Record<string, unknown>, search: ProductsSearch) {
  const expected = canonicalProductsSearchRecord(search);
  const rawKeys = Object.keys(raw);
  const expectedKeys = Object.keys(expected);
  return rawKeys.length === expectedKeys.length
    && expectedKeys.every((key) => {
      const value = raw[key];
      return (typeof value === 'string' || typeof value === 'number')
        && String(value) === String(expected[key]);
    });
}

function hasProductsFilters(search: ProductsSearch) {
  return Boolean(search.q || search.factStatus || search.workflowStage);
}

function productSortToSorting(sort: ProductSort): SortingState {
  switch (sort) {
    case 'UPDATED_DESC': return [{ id: 'updated_at', desc: true }];
    case 'UPDATED_ASC': return [{ id: 'updated_at', desc: false }];
    case 'MODEL_ASC': return [{ id: 'part_number', desc: false }];
    case 'MODEL_DESC': return [{ id: 'part_number', desc: true }];
    default: return assertNever(sort);
  }
}

function sortingToProductSort(sorting: SortingState): ProductSort {
  const current = sorting[0];
  if (!current || current.id === 'updated_at') return current?.desc === false ? 'UPDATED_ASC' : 'UPDATED_DESC';
  if (current.id === 'part_number') return current.desc ? 'MODEL_DESC' : 'MODEL_ASC';
  throw new Error(`Products 表格收到未知排序列：${current.id}`);
}

function normalizeProductPageSize(value: number): ProductsSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`Products 表格收到未知分页大小：${value}`);
}

function formatCurrentFact(currentFact: ProductListItem['current_fact']) {
  if (!currentFact) return '暂无';
  switch (currentFact.status) {
    case 'APPROVED': return `Approved v${currentFact.version}`;
    case 'PENDING_REVIEW': return `Pending v${currentFact.version}`;
    case 'CHANGES_REQUESTED': return `Changes requested v${currentFact.version}`;
    case 'RETIRED': return `Retired v${currentFact.version}`;
    default: return assertNever(currentFact.status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Products 收到未处理的合同 token：${String(value)}`);
}

export {
  canonicalProductsSearchRecord,
  formatCurrentFact,
  hasProductsFilters,
  isCanonicalProductsSearch,
  normalizeProductPageSize,
  productSortToSorting,
  productsSearchSchema,
  productsSearchToApiParams,
  sortingToProductSort,
};
export type {
  ProductFactStatus,
  ProductListItem,
  ProductSort,
  ProductWorkflowStage,
  ProductsApiParams,
  ProductsSearch,
};
