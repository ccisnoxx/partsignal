import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { components, paths } from '@/shared/api/generated/schema';
import {
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
} from './catalog.api';
import { catalogSearchSchema, catalogSearchToApiParams, type Subject } from './catalog.model';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@/shared/api/client', async () => {
  const { default: createClient } = await import('openapi-fetch');
  return {
    api: createClient<paths>({
      baseUrl: 'http://localhost',
      credentials: 'include',
      fetch: fetchMock,
    }),
  };
});

const subjectId = 'abcdef00-0000-4000-8000-abcdef000001';
const aliasId = 'abcdef00-0000-4000-8000-abcdef000002';
const domainId = 'abcdef00-0000-4000-8000-abcdef000003';
const productId = 'abcdef00-0000-4000-8000-abcdef000004';
const subjectPath = `/api/v1/geo/subjects/${subjectId}`;
const csrfToken = 'catalog-test-csrf';

const subject: Subject = {
  subject_type: 'OWN_BRAND',
  product_id: null,
  product: null,
  id: subjectId,
  canonical_name: 'PartSignal',
  display_name: 'PartSignal 品牌',
  description: '监测用途说明',
  parent_subject_id: null,
  parent: null,
  is_active: true,
  aliases: [{
    id: aliasId,
    subject_id: subjectId,
    alias: 'PS',
    normalized_alias: 'ps',
    alias_kind: 'ABBREVIATION',
    language_code: null,
    is_active: true,
    available_actions: ['UPDATE', 'DELETE'],
    created_at: '2026-10-02T08:00:00Z',
  }],
  domains: [{
    id: domainId,
    subject_id: subjectId,
    hostname: 'example.com',
    relation_type: 'OFFICIAL',
    is_active: true,
    available_actions: ['DELETE'],
    created_at: '2026-10-02T08:00:00Z',
  }],
  references: {
    child_subject_count: 1,
    monitoring_plan_count: 0,
    observation_run_count: 0,
    analysis_count: 0,
    opportunity_count: 0,
  },
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_SUBJECT',
  available_actions: ['UPDATE', 'DISABLE', 'CREATE_ALIAS', 'CREATE_DOMAIN'],
  deletion: { blockers: [{ type: 'CHILD_SUBJECT', count: 1 }] },
  revision: 23,
  created_by: 'abcdef00-0000-4000-8000-abcdef000005',
  created_at: '2026-10-02T08:00:00Z',
  updated_at: '2026-10-02T08:10:00Z',
};

const ownProductSubject: Subject = {
  ...subject,
  subject_type: 'OWN_PRODUCT',
  product_id: productId,
  product: { id: productId, part_number: 'PS-123', brand: 'PartSignal', category: '芯片', revision: 2 },
  canonical_name: 'PS-123',
  display_name: 'PartSignal PS-123',
};

const namedCreate: components['schemas']['GeoSubjectCreate'] = {
  subject_type: 'OWN_BRAND', canonical_name: 'PartSignal', display_name: 'PartSignal 品牌', description: '',
};
const ownProductCreate: components['schemas']['GeoSubjectCreate'] = {
  subject_type: 'OWN_PRODUCT', product_id: productId, parent_subject_id: subjectId, description: '',
};
const subjectUpdate: components['schemas']['GeoSubjectUpdate'] = {
  subject_type: 'OWN_BRAND', expected_revision: 22, display_name: '新品牌', description: '新说明',
};
const aliasCreate: components['schemas']['GeoSubjectAliasCreate'] = {
  expected_revision: 22, alias: 'PS', alias_kind: 'ABBREVIATION', language_code: null, is_active: false,
};
const aliasUpdate: components['schemas']['GeoSubjectAliasUpdate'] = {
  expected_revision: 22, alias: 'PS-2', language_code: 'zh-cn', is_active: false,
};
const domainCreate: components['schemas']['GeoSubjectDomainCreate'] = {
  expected_revision: 22, hostname: '例子.公司', relation_type: 'OFFICIAL',
};

const commands = [
  { name: '创建具名对象', method: 'POST', path: '/api/v1/geo/subjects', body: namedCreate,
    execute: (token: string | null) => createSubject(namedCreate, token) },
  { name: '创建自有产品对象', method: 'POST', path: '/api/v1/geo/subjects', body: ownProductCreate, response: ownProductSubject,
    execute: (token: string | null) => createSubject(ownProductCreate, token) },
  { name: '更新对象', method: 'PATCH', path: subjectPath, body: subjectUpdate,
    execute: (token: string | null) => updateSubject(subjectId, subjectUpdate, token) },
  { name: '启用对象', method: 'POST', path: `${subjectPath}/enable`, body: { expected_revision: 22 },
    execute: (token: string | null) => setSubjectActive(subjectId, 22, true, token) },
  { name: '停用对象', method: 'POST', path: `${subjectPath}/disable`, body: { expected_revision: 22 },
    execute: (token: string | null) => setSubjectActive(subjectId, 22, false, token) },
  { name: '创建别名', method: 'POST', path: `${subjectPath}/aliases`, body: aliasCreate,
    execute: (token: string | null) => createAlias(subjectId, aliasCreate, token) },
  { name: '更新别名', method: 'PATCH', path: `${subjectPath}/aliases/${aliasId}`, body: aliasUpdate,
    execute: (token: string | null) => updateAlias(subjectId, aliasId, aliasUpdate, token) },
  { name: '删除别名', method: 'DELETE', path: `${subjectPath}/aliases/${aliasId}?expected_revision=22`, body: undefined,
    execute: (token: string | null) => deleteAlias(subjectId, aliasId, 22, token) },
  { name: '创建域名', method: 'POST', path: `${subjectPath}/domains`, body: domainCreate,
    execute: (token: string | null) => createDomain(subjectId, domainCreate, token) },
  { name: '删除域名', method: 'DELETE', path: `${subjectPath}/domains/${domainId}?expected_revision=22`, body: undefined,
    execute: (token: string | null) => deleteDomain(subjectId, domainId, 22, token) },
];

function sentRequest(index = 0): Request {
  return fetchMock.mock.calls[index]![0] as Request;
}

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error('测试未声明的请求'));
});

describe('Catalog 查询边界', () => {
  it('列表使用完整 canonical API 参数，选中/新建身份不改变 key 或请求', async () => {
    const search = catalogSearchSchema.parse({
      q: '品牌', subject_type: 'OWN_BRAND', is_active: 'false',
      product_id: productId, parent_subject_id: subjectId,
      page: '2', page_size: '10', sort: 'UPDATED_DESC', new: 1,
    });
    const page = { items: [subject], page: 2, page_size: 10, total: 11 };
    fetchMock.mockResolvedValueOnce(Response.json(page));
    const options = catalogListQueryOptions(search);
    const client = new QueryClient();
    await expect(client.fetchQuery(options)).resolves.toEqual(page);
    const params = catalogSearchToApiParams(search);
    expect(options.queryKey).toEqual(catalogKeys.list(params));
    expect(catalogListQueryOptions({ ...search, new: undefined, subject_id: subjectId }).queryKey)
      .toEqual(options.queryKey);
    expect(catalogKeys.lists()).toEqual([...catalogKeys.root(), 'list']);
    expect(options).toMatchObject({ retry: false, staleTime: 30_000 });
    const request = sentRequest();
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/v1/geo/subjects');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '品牌', subject_type: 'OWN_BRAND', is_active: 'false', product_id: productId,
      parent_subject_id: subjectId, page: '2', page_size: '10', sort: 'UPDATED_DESC',
    });
    expect(request.method).toBe('GET');
    expect(request.credentials).toBe('include');
    expect(request.headers.has('X-CSRF-Token')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('详情返回完整父聚合，支持关闭读取和 AbortSignal', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(subject));
    const options = catalogDetailQueryOptions(subjectId);
    const client = new QueryClient();
    await expect(client.fetchQuery(options)).resolves.toEqual(subject);
    expect(options.queryKey).toEqual(catalogKeys.detail(subjectId));
    expect(options).toMatchObject({ enabled: true, retry: false, staleTime: 30_000 });
    expect(catalogDetailQueryOptions('', false).enabled).toBe(false);
    expect(new URL(sentRequest().url).pathname).toBe(subjectPath);
    expect(sentRequest().signal).toBeInstanceOf(AbortSignal);
  });

  it('取消详情 Query 会取消实际 Request', async () => {
    fetchMock.mockImplementationOnce((request: Request) => new Promise<Response>((_, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')));
    }));
    const options = catalogDetailQueryOptions(subjectId);
    const client = new QueryClient();
    const rejection = expect(client.fetchQuery(options)).rejects.toMatchObject({ name: 'Error' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await client.cancelQueries({ queryKey: options.queryKey });
    await rejection;
    expect(sentRequest().signal.aborted).toBe(true);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  });

  it('产品选择器只请求分页 ProductList，不读取详情或事实', async () => {
    const page: components['schemas']['ProductList'] = { items: [], page: 3, page_size: 10, total: 0 };
    fetchMock.mockResolvedValueOnce(Response.json(page));
    const options = catalogProductOptionsQueryOptions('PS-12', 3);
    const client = new QueryClient();
    await expect(client.fetchQuery(options)).resolves.toEqual(page);
    expect(options.queryKey).toEqual(catalogKeys.productOptions({
      search: 'PS-12', page: 3, page_size: 10, sort: 'MODEL_ASC',
    }));
    expect(new URL(sentRequest().url).pathname).toBe('/api/v1/products');
    expect(Object.fromEntries(new URL(sentRequest().url).searchParams)).toEqual({
      search: 'PS-12', page: '3', page_size: '10', sort: 'MODEL_ASC',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Catalog 命令边界', () => {
  it.each(commands)('$name 使用准确路径、CSRF 和父 revision，返回完整父聚合', async (command) => {
    const response = command.response ?? subject;
    fetchMock.mockResolvedValueOnce(Response.json(response));
    await expect(command.execute(csrfToken)).resolves.toEqual(response);
    const request = sentRequest();
    expect(request.method).toBe(command.method);
    expect(request.url).toBe(`http://localhost${command.path}`);
    expect(request.headers.get('X-CSRF-Token')).toBe(csrfToken);
    expect(request.headers.has('Idempotency-Key')).toBe(false);
    if (command.body) expect(await request.json()).toEqual(command.body);
    else expect(await request.text()).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(commands)('$name 缺少 CSRF 时发网前拒绝', async (command) => {
    await expect(command.execute(null)).rejects.toBeInstanceOf(CatalogRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Subject DELETE 携带 revision，并只接受无 body 的 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteSubject(subjectId, 0, csrfToken)).resolves.toBeUndefined();
    expect(sentRequest().method).toBe('DELETE');
    expect(sentRequest().url).toBe(`http://localhost${subjectPath}?expected_revision=0`);
    expect(sentRequest().headers.get('X-CSRF-Token')).toBe(csrfToken);
    expect(sentRequest().headers.has('Idempotency-Key')).toBe(false);
    expect(await sentRequest().text()).toBe('');
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(deleteSubject(subjectId, 0, csrfToken)).rejects.toMatchObject({ status: 200 });
  });

  it('Subject DELETE 缺少 CSRF 时不发送请求', async () => {
    await expect(deleteSubject(subjectId, 22, null)).rejects.toThrow('缺少会话安全令牌');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('409 保留结构化 code/details/request ID，失败不重放或自动读取', async () => {
    const detail: components['schemas']['ErrorDetail'] = {
      code: 'REVISION_CONFLICT', message: '对象已更新，请刷新后确认',
      details: { expected_revision: 22, actual_revision: 23 }, request_id: 'req-catalog-conflict',
    };
    fetchMock.mockResolvedValueOnce(Response.json({ error: detail }, { status: 409 }));
    await expect(updateAlias(subjectId, aliasId, aliasUpdate, csrfToken)).rejects.toMatchObject({
      name: 'CatalogRequestError', status: 409, detail,
      message: '对象已更新，请刷新后确认（请求 ID：req-catalog-conflict）',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequest().method).toBe('PATCH');
  });

  it('404 Query 显式失败且不自动 retry', async () => {
    const detail = { code: 'NOT_FOUND', message: '对象不存在', details: {}, request_id: 'req-missing' };
    fetchMock.mockResolvedValueOnce(Response.json({ error: detail }, { status: 404 }));
    const options = catalogDetailQueryOptions(subjectId);
    const client = new QueryClient();
    await expect(client.fetchQuery(options)).rejects.toMatchObject({ status: 404, detail });
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('畸形信封保持显式 HTTP 错误，不猜结构或展示原始响应', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      error: { code: 'REVISION_CONFLICT', message: 'raw-sentinel', request_id: 'req-malformed' },
    }, { status: 409 }));
    await expect(deleteDomain(subjectId, domainId, 22, csrfToken)).rejects.toMatchObject({
      status: 409, detail: undefined, message: '删除域名失败（HTTP 409）',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
