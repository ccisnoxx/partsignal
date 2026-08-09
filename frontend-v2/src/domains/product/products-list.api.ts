import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  productsSearchToApiParams,
  type ProductListItem,
  type ProductsApiParams,
  type ProductsSearch,
} from './products-list.model';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

const productsKeys = {
  lists: () => ['products', 'list'] as const,
  list: (params: ProductsApiParams) => ['products', 'list', params] as const,
};

function productsListQueryOptions(search: ProductsSearch) {
  const params = productsSearchToApiParams(search);
  return queryOptions({
    queryKey: productsKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/products', { params: { query: params } });
      if (!result.data) throw productsRequestError('读取产品列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function deleteProduct(product: ProductListItem, csrfToken: string | null) {
  if (!csrfToken) throw new Error('缺少会话安全令牌，无法删除产品');
  const result = await api.DELETE('/api/v1/products/{product_id}', {
    params: {
      path: { product_id: product.id },
      query: { expected_revision: product.revision },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (!result.response.ok) throw productsRequestError('删除产品', result);
}

function productsRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new Error(`${detail.message}（请求 ID：${detail.request_id}）`);
  }
  return new Error(`${action}失败（HTTP ${result.response.status}）`);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const detail = value.error;
  return Boolean(
    detail
    && typeof detail === 'object'
    && 'code' in detail
    && typeof detail.code === 'string'
    && 'message' in detail
    && typeof detail.message === 'string'
    && 'request_id' in detail
    && typeof detail.request_id === 'string',
  );
}

export { deleteProduct, productsKeys, productsListQueryOptions };
