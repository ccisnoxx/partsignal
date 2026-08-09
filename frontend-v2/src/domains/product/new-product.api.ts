import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type { NewProductField } from './new-product.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type Product = components['schemas']['Product'];
type ProductCreate = components['schemas']['ProductCreate'];

class ProductCreateRequestError extends Error {
  constructor(
    message: string,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'ProductCreateRequestError';
  }
}

async function createProduct(body: ProductCreate, csrfToken: string | null): Promise<Product> {
  if (!csrfToken) throw new ProductCreateRequestError('缺少会话安全令牌，无法创建产品');
  const result = await api.POST('/api/v1/products', {
    body,
    params: { header: { 'X-CSRF-Token': csrfToken } },
  });
  if (result.data) return result.data;
  throw new ProductCreateRequestError(result.error.error.message, result.error.error);
}

type ProductCreateErrorMapping = {
  fields: Partial<Record<NewProductField, string>>;
  formMessage?: string;
  requestId?: string;
};

const newProductFields = new Set<NewProductField>(['part_number', 'brand', 'category']);

function mapProductCreateError(error: unknown): ProductCreateErrorMapping {
  if (!(error instanceof ProductCreateRequestError) || !error.detail) {
    return {
      fields: {},
      formMessage: error instanceof Error ? error.message : '创建产品失败',
    };
  }

  const fields: Partial<Record<NewProductField, string>> = {};
  const issues = error.detail.details.errors;
  let hasUnknownIssue = false;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        hasUnknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      const field = Array.isArray(loc) && loc.length === 2 && loc[0] === 'body' ? loc[1] : undefined;
      if (typeof field === 'string' && newProductFields.has(field as NewProductField) && typeof message === 'string') {
        fields[field as NewProductField] ??= message;
      } else {
        hasUnknownIssue = true;
      }
    }
  }

  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || hasUnknownIssue ? error.detail.message : undefined,
    requestId: error.detail.request_id,
  };
}

export { ProductCreateRequestError, createProduct, mapProductCreateError };
export type { ProductCreateErrorMapping };
