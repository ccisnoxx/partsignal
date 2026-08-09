import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  productsSearchToApiParams,
  type ProductsApiParams,
  type ProductsSearch,
} from './products-list.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type Product = components['schemas']['Product'];
type ProductDetail = components['schemas']['ProductDetail'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];
type ProductFactsDraftUpdate = components['schemas']['ProductFactsDraftUpdate'];
type ProductFactReviewWorkspace = components['schemas']['ProductFactReviewWorkspace'];
type FactReviewSubmissionRequest = components['schemas']['FactReviewSubmissionRequest'];
type FactVersion = components['schemas']['FactVersion'];
type CommandRequest = components['schemas']['CommandRequest'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];
type ProductUpdate = components['schemas']['ProductUpdate'];

class ProductRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'ProductRequestError';
  }
}

const productsKeys = {
  lists: () => ['products', 'list'] as const,
  list: (params: ProductsApiParams) => ['products', 'list', params] as const,
  details: () => ['products', 'detail'] as const,
  detail: (productId: string) => ['products', 'detail', productId] as const,
  facts: () => ['products', 'facts'] as const,
  fact: (productId: string) => ['products', 'facts', productId] as const,
  factReview: (productId: string) => ['products', 'fact-review', productId] as const,
};

function productsListQueryOptions(search: ProductsSearch) {
  const params = productsSearchToApiParams(search);
  return queryOptions({
    queryKey: productsKeys.list(params),
    queryFn: async () => {
      const result = await api.GET('/api/v1/products', { params: { query: params } });
      if (!result.data) throw productRequestError('读取产品列表', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function productDetailQueryOptions(productId: string) {
  return queryOptions({
    queryKey: productsKeys.detail(productId),
    queryFn: async (): Promise<ProductDetail> => {
      const result = await api.GET('/api/v1/products/{product_id}/detail', {
        params: { path: { product_id: productId } },
      });
      if (!result.data) throw productRequestError('读取产品详情', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function productFactsQueryOptions(productId: string) {
  return queryOptions({
    queryKey: productsKeys.fact(productId),
    queryFn: async (): Promise<ProductFactsDraft> => {
      const result = await api.GET('/api/v1/products/{product_id}/facts', {
        params: { path: { product_id: productId } },
      });
      if (!result.data) throw productRequestError('读取事实工作区', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

function productFactReviewQueryOptions(productId: string) {
  return queryOptions({
    queryKey: productsKeys.factReview(productId),
    queryFn: async (): Promise<ProductFactReviewWorkspace> => {
      const result = await api.GET('/api/v1/products/{product_id}/fact-review-context', {
        params: { path: { product_id: productId } },
      });
      if (!result.data) throw productRequestError('读取事实审核工作台', result);
      return result.data;
    },
    refetchOnWindowFocus: 'always',
    retry: false,
    retryOnMount: false,
    staleTime: 30_000,
  });
}

async function replaceProductFacts(
  productId: string,
  body: ProductFactsDraftUpdate,
  csrfToken: string | null,
): Promise<ProductFactsDraft> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法保存事实工作区');
  const result = await api.PUT('/api/v1/products/{product_id}/facts', {
    body,
    params: {
      path: { product_id: productId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (result.data) return result.data;
  throw productRequestError('保存事实工作区', result);
}

async function submitProductFactReview(
  productId: string,
  body: FactReviewSubmissionRequest,
  csrfToken: string | null,
): Promise<FactVersion> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法提交事实审核');
  const result = await api.POST('/api/v1/products/{product_id}/fact-review-submissions', {
    body,
    params: {
      path: { product_id: productId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (result.data) return result.data;
  throw productRequestError('提交事实审核', result);
}

async function approveFactVersion(
  factVersionId: string,
  expectedRevision: number,
  csrfToken: string | null,
): Promise<FactVersion> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法批准事实版本');
  const body = { expected_revision: expectedRevision, comment: '' } satisfies CommandRequest;
  const result = await api.POST('/api/v1/fact-versions/{fact_version_id}/approve', {
    body,
    params: {
      path: { fact_version_id: factVersionId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (result.data) return result.data;
  throw productRequestError('批准事实版本', result);
}

async function requestFactVersionChanges(
  factVersionId: string,
  body: RequestChangesCommand,
  csrfToken: string | null,
): Promise<FactVersion> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法退回事实版本');
  const result = await api.POST('/api/v1/fact-versions/{fact_version_id}/request-changes', {
    body,
    params: {
      path: { fact_version_id: factVersionId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (result.data) return result.data;
  throw productRequestError('退回事实版本', result);
}

async function updateProduct(
  productId: string,
  body: ProductUpdate,
  csrfToken: string | null,
): Promise<Product> {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法更新产品');
  const result = await api.PATCH('/api/v1/products/{product_id}', {
    body,
    params: {
      path: { product_id: productId },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (result.data) return result.data;
  throw productRequestError('更新产品', result);
}

async function deleteProduct(product: Product, csrfToken: string | null) {
  if (!csrfToken) throw new ProductRequestError('缺少会话安全令牌，无法删除产品');
  const result = await api.DELETE('/api/v1/products/{product_id}', {
    params: {
      path: { product_id: product.id },
      query: { expected_revision: product.revision },
      header: { 'X-CSRF-Token': csrfToken },
    },
  });
  if (!result.response.ok) throw productRequestError('删除产品', result);
}

function productRequestError(
  action: string,
  result: { error?: unknown; response: Response },
) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new ProductRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new ProductRequestError(
    `${action}失败（HTTP ${result.response.status}）`,
    result.response.status,
  );
}

function mapProductFormError(error: unknown, allowedFields: ReadonlySet<string>) {
  if (!(error instanceof ProductRequestError) || !error.detail) {
    return {
      fields: {} as Record<string, string>,
      formMessage: error instanceof Error ? error.message : '产品请求失败',
    };
  }

  const fields: Record<string, string> = {};
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
      if (typeof field === 'string' && allowedFields.has(field) && typeof message === 'string') {
        fields[field] ??= message;
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

export {
  ProductRequestError,
  approveFactVersion,
  deleteProduct,
  mapProductFormError,
  productDetailQueryOptions,
  productFactReviewQueryOptions,
  productFactsQueryOptions,
  productRequestError,
  productsKeys,
  productsListQueryOptions,
  replaceProductFacts,
  requestFactVersionChanges,
  submitProductFactReview,
  updateProduct,
};
