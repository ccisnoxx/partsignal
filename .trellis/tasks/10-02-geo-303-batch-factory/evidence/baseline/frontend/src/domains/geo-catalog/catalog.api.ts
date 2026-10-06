import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components, operations } from '@/shared/api/generated/schema';
import { catalogSearchToApiParams, type CatalogListApiParams, type CatalogSearch } from './catalog.model';

type ErrorDetail = components['schemas']['ErrorDetail'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type SubjectCreate = components['schemas']['GeoSubjectCreate'];
type SubjectUpdate = components['schemas']['GeoSubjectUpdate'];
type AliasCreate = components['schemas']['GeoSubjectAliasCreate'];
type AliasUpdate = components['schemas']['GeoSubjectAliasUpdate'];
type DomainCreate = components['schemas']['GeoSubjectDomainCreate'];
type ProductOptionsParams = NonNullable<operations['listProducts']['parameters']['query']>;

class CatalogRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: ErrorDetail,
  ) {
    super(message);
    this.name = 'CatalogRequestError';
  }
}

// openapi-fetch 0.17 Readable 会误删纯 null 属性；响应仍按 generated 合同保留 product/product_id，不能补默认值。
const catalogKeys = {
  root: () => ['geo', 'catalog'] as const,
  lists: () => ['geo', 'catalog', 'list'] as const,
  list: (params: CatalogListApiParams) => ['geo', 'catalog', 'list', params] as const,
  detail: (subjectId: string) => ['geo', 'catalog', 'detail', subjectId] as const,
  productOptions: (params: ProductOptionsParams) => (
    ['geo', 'catalog', 'product-options', params] as const
  ),
};

function catalogListQueryOptions(search: CatalogSearch) {
  const params = catalogSearchToApiParams(search);
  return queryOptions({
    queryKey: catalogKeys.list(params),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/subjects', {
        params: { query: params },
        signal,
      });
      if (!result.data) throw catalogRequestError('读取监测对象列表', result);
      return result.data as components['schemas']['GeoSubjectListPage'];
    },
    retry: false,
    staleTime: 30_000,
  });
}

function catalogDetailQueryOptions(subjectId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: catalogKeys.detail(subjectId),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/subjects/{subject_id}', {
        params: { path: { subject_id: subjectId } },
        signal,
      });
      if (!result.data) throw catalogRequestError('读取监测对象详情', result);
      return result.data as components['schemas']['GeoSubjectOut'];
    },
    retry: false,
    staleTime: 30_000,
  });
}

function catalogProductOptionsQueryOptions(search: string, page: number) {
  const params: ProductOptionsParams = {
    search,
    page,
    page_size: 10,
    sort: 'MODEL_ASC',
  };
  return queryOptions({
    queryKey: catalogKeys.productOptions(params),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/products', { params: { query: params }, signal });
      if (!result.data) throw catalogRequestError('读取产品选项', result);
      return result.data;
    },
    retry: false,
    staleTime: 30_000,
  });
}

async function createSubject(body: SubjectCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/subjects', {
    body,
    params: { header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) } },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('创建监测对象', result);
}

async function updateSubject(subjectId: string, body: SubjectUpdate, csrfToken: string | null) {
  const result = await api.PATCH('/api/v1/geo/subjects/{subject_id}', {
    body,
    params: {
      path: { subject_id: subjectId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('更新监测对象', result);
}

async function deleteSubject(subjectId: string, expectedRevision: number, csrfToken: string | null) {
  const result = await api.DELETE('/api/v1/geo/subjects/{subject_id}', {
    params: {
      path: { subject_id: subjectId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.response.status === 204) return;
  throw catalogRequestError('删除监测对象', result);
}

async function setSubjectActive(
  subjectId: string,
  expectedRevision: number,
  isActive: boolean,
  csrfToken: string | null,
) {
  const path = isActive
    ? '/api/v1/geo/subjects/{subject_id}/enable' as const
    : '/api/v1/geo/subjects/{subject_id}/disable' as const;
  const result = await api.POST(path, {
    body: { expected_revision: expectedRevision },
    params: {
      path: { subject_id: subjectId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError(isActive ? '启用监测对象' : '停用监测对象', result);
}

async function createAlias(subjectId: string, body: AliasCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/subjects/{subject_id}/aliases', {
    body,
    params: {
      path: { subject_id: subjectId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('创建别名', result);
}

async function updateAlias(
  subjectId: string,
  aliasId: string,
  body: AliasUpdate,
  csrfToken: string | null,
) {
  const result = await api.PATCH('/api/v1/geo/subjects/{subject_id}/aliases/{alias_id}', {
    body,
    params: {
      path: { subject_id: subjectId, alias_id: aliasId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('更新别名', result);
}

async function deleteAlias(
  subjectId: string,
  aliasId: string,
  expectedRevision: number,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/geo/subjects/{subject_id}/aliases/{alias_id}', {
    params: {
      path: { subject_id: subjectId, alias_id: aliasId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('删除别名', result);
}

async function createDomain(subjectId: string, body: DomainCreate, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/subjects/{subject_id}/domains', {
    body,
    params: {
      path: { subject_id: subjectId },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('创建域名', result);
}

async function deleteDomain(
  subjectId: string,
  domainId: string,
  expectedRevision: number,
  csrfToken: string | null,
) {
  const result = await api.DELETE('/api/v1/geo/subjects/{subject_id}/domains/{domain_id}', {
    params: {
      path: { subject_id: subjectId, domain_id: domainId },
      query: { expected_revision: expectedRevision },
      header: { 'X-CSRF-Token': requireCsrfToken(csrfToken) },
    },
  });
  if (result.data) return result.data as components['schemas']['GeoSubjectOut'];
  throw catalogRequestError('删除域名', result);
}

function requireCsrfToken(csrfToken: string | null) {
  if (csrfToken) return csrfToken;
  throw new CatalogRequestError('缺少会话安全令牌，无法管理监测对象');
}

function catalogRequestError(action: string, result: { error?: unknown; response: Response }) {
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    return new CatalogRequestError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail,
    );
  }
  return new CatalogRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  const detail = value.error;
  return isRecord(detail)
    && Object.keys(detail).length === 4
    && typeof detail.code === 'string'
    && typeof detail.message === 'string'
    && typeof detail.request_id === 'string'
    && isRecord(detail.details);
}

export {
  CatalogRequestError,
  catalogDetailQueryOptions,
  catalogKeys,
  catalogListQueryOptions,
  catalogProductOptionsQueryOptions,
  createAlias,
  createDomain,
  createSubject,
  deleteAlias,
  deleteDomain,
  deleteSubject,
  setSubjectActive,
  updateAlias,
  updateSubject,
};
