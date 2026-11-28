import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

export type Article = components['schemas']['ArticleOut'];
export type ArticleDetail = components['schemas']['ArticleDetail'];
export type ArticleList = components['schemas']['ArticleList'];
export type ArticlePublication = components['schemas']['ArticlePublicationOut'];
export type ArticleCreateRequest = components['schemas']['ArticleCreateRequest'];
export type ArticleUpdateRequest = components['schemas']['ArticleUpdateRequest'];
export type ArticlePublicationCreateRequest = components['schemas']['ArticlePublicationCreateRequest'];
export type ArticlePublicationUpdateRequest = components['schemas']['ArticlePublicationUpdateRequest'];
export type ProductPromptCopyBundleRequest = components['schemas']['ProductPromptCopyBundleRequest'];
export type ProductPromptCopyBundleOut = components['schemas']['ProductPromptCopyBundleOut'];

export type ArticlesFilterParams = {
  product_id?: string;
  origin_type?: components['schemas']['ArticleOriginType'];
  status?: components['schemas']['ArticleStatus'];
  q?: string;
  page?: number;
  page_size?: number;
};

export const articleKeys = {
  lists: () => ['articles', 'list'] as const,
  list: (params: ArticlesFilterParams) => ['articles', 'list', params] as const,
  details: () => ['articles', 'detail'] as const,
  detail: (id: string) => ['articles', 'detail', id] as const,
  publications: () => ['articles', 'publications'] as const,
};

function unwrapError(action: string, result: { error?: unknown; response: Response }): Error {
  const err = result.error as { error?: { message?: string } } | undefined;
  const msg = err?.error?.message ?? `${action}失败（HTTP ${result.response.status}）`;
  return new Error(msg);
}

export function articlesListQueryOptions(params: ArticlesFilterParams) {
  return queryOptions({
    queryKey: articleKeys.list(params),
    queryFn: async (): Promise<ArticleList> => {
      const result = await api.GET('/api/v1/articles', { params: { query: params } });
      if (!result.data) throw unwrapError('读取文章列表', result);
      return result.data;
    },
    staleTime: 15_000,
  });
}

export function articleDetailQueryOptions(articleId: string) {
  return queryOptions({
    queryKey: articleKeys.detail(articleId),
    queryFn: async (): Promise<ArticleDetail> => {
      const result = await api.GET('/api/v1/articles/{article_id}', {
        params: { path: { article_id: articleId } },
      });
      if (!result.data) throw unwrapError('读取文章详情', result);
      return result.data;
    },
    staleTime: 15_000,
  });
}

export async function createArticle(
  body: ArticleCreateRequest,
  csrfToken: string,
): Promise<ArticleDetail> {
  const result = await api.POST('/api/v1/articles', {
    params: { header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('录入文章', result);
  return result.data;
}

export async function updateArticle(
  articleId: string,
  body: ArticleUpdateRequest,
  csrfToken: string,
): Promise<ArticleDetail> {
  const result = await api.PATCH('/api/v1/articles/{article_id}', {
    params: { path: { article_id: articleId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('更新文章', result);
  return result.data;
}

export async function createArticlePublication(
  articleId: string,
  body: ArticlePublicationCreateRequest,
  csrfToken: string,
): Promise<ArticlePublication> {
  const result = await api.POST('/api/v1/articles/{article_id}/publications', {
    params: { path: { article_id: articleId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('登记发布位置', result);
  return result.data;
}

export async function updateArticlePublication(
  publicationId: string,
  body: ArticlePublicationUpdateRequest,
  csrfToken: string,
): Promise<ArticlePublication> {
  const result = await api.PATCH('/api/v1/article-publications/{publication_id}', {
    params: { path: { publication_id: publicationId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('更新发布记录', result);
  return result.data;
}

export async function buildProductPromptCopyBundle(
  productId: string,
  body: ProductPromptCopyBundleRequest,
  csrfToken: string,
): Promise<ProductPromptCopyBundleOut> {
  const result = await api.POST('/api/v1/products/{product_id}/prompt-copy-bundle', {
    params: { path: { product_id: productId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('生成提示词复制包', result);
  return result.data;
}
