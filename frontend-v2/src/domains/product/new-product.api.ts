import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type { NewProductField } from './new-product.model';
import {
  ProductRequestError,
  mapProductFormError,
  productRequestError,
} from './product.api';

type Product = components['schemas']['Product'];
type ProductCreate = components['schemas']['ProductCreate'];

async function createProduct(body: ProductCreate, csrfToken: string | null): Promise<Product> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法创建产品');
  const result = await api.POST('/api/v1/products', {
    body,
    params: { header: { 'X-CSRF-Token': csrfToken } },
  });
  if (result.data) return result.data;
  throw productRequestError('创建产品', result);
}

type ProductCreateErrorMapping = {
  fields: Partial<Record<NewProductField, string>>;
  formMessage?: string;
  requestId?: string;
};

const newProductFields = new Set<NewProductField>(['part_number', 'brand', 'category']);

function mapProductCreateError(error: unknown): ProductCreateErrorMapping {
  const mapped = mapProductFormError(error, newProductFields);
  return { ...mapped, fields: mapped.fields as Partial<Record<NewProductField, string>> };
}

export { createProduct, mapProductCreateError };
export type { ProductCreateErrorMapping };
