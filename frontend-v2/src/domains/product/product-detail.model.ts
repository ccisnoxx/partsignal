import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { ProductRequestError, mapProductFormError } from './product.api';
import { productIdentityField } from './product.model';

type ProductDetail = components['schemas']['ProductDetail'];
type ProductUpdate = components['schemas']['ProductUpdate'];
type ProductUpdateField = keyof ProductUpdateFormValues;
type ContentStage = NonNullable<ProductDetail['content']['latest_task']>['workflow_stage'];
type PublicationStatus = NonNullable<ProductDetail['publishing']['latest']>['status'];
type Confidentiality = components['schemas']['Confidentiality'];

const productUpdateFormSchema = z.object({
  part_number: productIdentityField('产品型号'),
  brand: productIdentityField('品牌'),
  category: productIdentityField('类别'),
  status: z.enum(['ACTIVE', 'RETIRED']),
});

type ProductUpdateFormValues = z.infer<typeof productUpdateFormSchema>;

const productUpdateFields = new Set<ProductUpdateField>([
  'part_number',
  'brand',
  'category',
  'status',
]);

const confidentialityRegistry = {
  PUBLIC: '公开',
  INTERNAL: '内部',
  RESTRICTED: '受限',
} satisfies Record<Confidentiality, string>;

const contentStageRegistry = {
  NO_DRAFT: '尚无首稿',
  GENERATING: '正在生成',
  GENERATION_FAILED: '生成失败',
  DRAFT: '草稿编辑中',
  REVIEW_PENDING: '内容待审核',
  CHANGES_REQUESTED: '内容待修订',
  APPROVED: '内容已批准',
  PUBLISHING: '发布处理中',
  VERIFIED: '发布已核验',
  CANCELLED: '任务已取消',
} satisfies Record<ContentStage, string>;

const publicationStatusRegistry = {
  PREPARING: '准备中',
  PLATFORM_REVIEW: '平台处理中',
  AWAITING_VERIFICATION: '等待核验',
  ACTION_REQUIRED: '需要处理',
  COMPLETED: '已完成',
  CLOSED: '已关闭',
} satisfies Record<PublicationStatus, string>;

function productToUpdateValues(product: ProductDetail['product']): ProductUpdateFormValues {
  return {
    part_number: product.part_number,
    brand: product.brand,
    category: product.category,
    status: product.status,
  };
}

function toProductUpdate(
  values: ProductUpdateFormValues,
  expectedRevision: number,
): ProductUpdate {
  return {
    expected_revision: expectedRevision,
    part_number: values.part_number,
    brand: values.brand,
    category: values.category,
    status: values.status,
  } satisfies ProductUpdate;
}

function mapProductUpdateError(error: unknown) {
  const mapped = mapProductFormError(error, productUpdateFields);
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<ProductUpdateField, string>>,
    refreshCanonical: error instanceof ProductRequestError
      && (error.detail?.code === 'REVISION_CONFLICT' || error.detail?.code === 'IMMUTABLE_VERSION'),
  };
}

function productDetailErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof ProductRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function productActivityTargetHref(
  productId: string,
  target: ProductDetail['activity'][number]['target'],
) {
  switch (target.kind) {
    case 'PRODUCT': return `/products/${encodeURIComponent(target.id)}`;
    case 'FACT_VERSION': return `/products/${encodeURIComponent(productId)}/facts/versions/${encodeURIComponent(target.id)}`;
    case 'CONTENT_TASK': return `/content/tasks/${encodeURIComponent(target.id)}`;
    case 'CONTENT_VERSION': return `/content/versions/${encodeURIComponent(target.id)}`;
    case 'PUBLICATION_WORK': return `/publishing/work/${encodeURIComponent(target.id)}`;
    case 'GEO_OBSERVATION': return `/geo/observations/${encodeURIComponent(target.id)}`;
    default: return assertNever(target.kind);
  }
}

function formatProductRate(value: number | null) {
  if (value === null) return '暂无';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function assertNever(value: never): never {
  throw new Error(`Product Detail 收到未处理的合同 token：${String(value)}`);
}

export {
  confidentialityRegistry,
  contentStageRegistry,
  formatProductRate,
  mapProductUpdateError,
  productActivityTargetHref,
  productDetailErrorKind,
  productToUpdateValues,
  productUpdateFormSchema,
  publicationStatusRegistry,
  toProductUpdate,
};
export type { ProductDetail, ProductUpdateField, ProductUpdateFormValues };
