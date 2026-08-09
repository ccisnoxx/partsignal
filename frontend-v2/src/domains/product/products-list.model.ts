import type { SortingState } from '@tanstack/react-table';
import { z } from 'zod';

import type {
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type ProductListItem = components['schemas']['ProductListItem'];
type ProductFactStatus = components['schemas']['ProductFactStatus'];
type ProductWorkflowStage = components['schemas']['ProductWorkflowStage'];
type ProductSort = components['schemas']['ProductSort'];
type ProductPrimaryTask = ProductListItem['primary_task'];
type ProductAvailableAction = ProductListItem['available_actions'][number];
type ProductDeletionBlocker = components['schemas']['DeletionBlocker'];
type ProductsApiParams = NonNullable<operations['listProducts']['parameters']['query']>;
type ProductStatusTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info';

type ProductStatusPresentation = {
  label: string;
  tone: ProductStatusTone;
  description: string;
};

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

const productFactStatusRegistry = {
  NOT_ENTERED: { label: '未录入', tone: 'outline', description: '尚无不可变事实版本' },
  PENDING_REVIEW: { label: '待审核', tone: 'warning', description: '当前事实版本正在等待审核' },
  CHANGES_REQUESTED: { label: '待修订', tone: 'warning', description: '审核已要求修改当前事实' },
  APPROVED: { label: '已批准', tone: 'success', description: '当前事实版本已经批准' },
  RETIRED: { label: '已停用', tone: 'secondary', description: '产品及其事实已停用' },
} satisfies Record<ProductFactStatus, ProductStatusPresentation>;

const productWorkflowStageRegistry = {
  FACTS_EMPTY: { label: '事实未录入', tone: 'outline', description: '产品尚未开始录入事实' },
  FACTS_EDITING: { label: '事实编辑中', tone: 'info', description: '事实工作区包含尚未提交的修改' },
  FACT_REVIEW_PENDING: { label: '事实待审核', tone: 'warning', description: '事实快照正在等待审核' },
  FACT_CHANGES_REQUESTED: { label: '事实待修订', tone: 'warning', description: '审核已要求修订事实' },
  FACT_APPROVED: { label: '事实已批准', tone: 'success', description: '当前事实已通过审核' },
  RETIRED: { label: '已停用', tone: 'secondary', description: '产品流程已停用' },
} satisfies Record<ProductWorkflowStage, ProductStatusPresentation>;

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

function resolveProductPrimaryAction(product: ProductListItem): PrimaryRowAction {
  const productId = encodeURIComponent(product.id);
  const action: ProductPrimaryTask = product.primary_task;
  switch (action) {
    case 'ENTER_FACTS':
      return primaryLink(action, '录入事实', `/products/${productId}/facts`);
    case 'SUBMIT_FACT_REVIEW':
      return primaryLink(action, '提交审核', `/products/${productId}/facts`);
    case 'REVIEW_FACT':
      return primaryLink(action, '审核', `/products/${productId}/facts/review`);
    case 'REVISE_FACT':
      return primaryLink(action, '修订', `/products/${productId}/facts`);
    case 'CREATE_CONTENT_TASK':
      return primaryLink(action, '创建内容', `/content/tasks/new?productId=${productId}`);
    case 'VIEW_FACT_HISTORY':
      return primaryLink(action, '查看事实历史', `/products/${productId}`);
    default:
      return assertNever(action);
  }
}

function primaryLink(key: ProductPrimaryTask, label: string, href: string): PrimaryRowAction {
  return { key, label, href, intent: 'primary', enabled: true };
}

function resolveProductOverflowActions(product: ProductListItem, deleting: boolean): OverflowRowAction[] {
  const actions = product.available_actions.map((action) => resolveAvailableAction(action, product, deleting));
  if (product.deletion?.blockers.length && !product.available_actions.includes('DELETE')) {
    actions.push({
      key: 'VIEW_DELETE_CONDITIONS',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-delete-conditions',
    });
  }
  return actions;
}

function resolveAvailableAction(
  action: ProductAvailableAction,
  product: ProductListItem,
  deleting: boolean,
): OverflowRowAction {
  switch (action) {
    case 'UPDATE':
      return {
        key: action,
        label: '编辑产品',
        intent: 'secondary',
        enabled: false,
        command: 'update-product',
        disabledReason: 'V2 编辑入口待定义',
      };
    case 'DELETE':
      if (!product.deletion || product.deletion.blockers.length > 0) {
        throw new Error(`Products API 为 ${product.id} 返回了矛盾的 DELETE projection`);
      }
      return {
        key: action,
        label: deleting ? '正在删除…' : '删除产品',
        intent: 'danger',
        enabled: !deleting,
        command: 'delete-product',
        disabledReason: deleting ? '删除请求正在处理' : undefined,
        confirmation: {
          title: `确认删除产品“${product.part_number}”`,
          description: '将删除该产品及当前事实工作区；此操作不可恢复，存在事实版本、内容任务或 GEO 观测引用时服务端会拒绝。',
          confirmLabel: '确认删除',
        },
      };
    default:
      return assertNever(action);
  }
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

function formatRelativeProductTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Products API 返回了非法时间：${value}`);
  const seconds = (timestamp - now) / 1_000;
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(Math.round(seconds), 'second');
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) return formatter.format(Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return formatter.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (Math.abs(days) < 30) return formatter.format(Math.round(days), 'day');
  const months = days / 30;
  if (Math.abs(months) < 12) return formatter.format(Math.round(months), 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

function formatExactProductTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Products API 返回了非法时间：${value}`);
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function getProductDeletionBlockerLabel(blocker: ProductDeletionBlocker) {
  switch (blocker.type) {
    case 'FACT_VERSION': return '事实版本';
    case 'CONTENT_TASK': return '内容任务';
    case 'GEO_OBSERVATION': return 'GEO 观测';
    default: throw new Error(`Products API 返回了未知删除阻断类型：${blocker.type}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Products 收到未处理的合同 token：${String(value)}`);
}

export {
  canonicalProductsSearchRecord,
  formatCurrentFact,
  formatExactProductTime,
  formatRelativeProductTime,
  getProductDeletionBlockerLabel,
  hasProductsFilters,
  isCanonicalProductsSearch,
  normalizeProductPageSize,
  productFactStatusRegistry,
  productSortToSorting,
  productWorkflowStageRegistry,
  productsSearchSchema,
  productsSearchToApiParams,
  resolveProductOverflowActions,
  resolveProductPrimaryAction,
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
