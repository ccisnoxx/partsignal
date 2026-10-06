import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { paths } from '@/shared/api/generated/schema';
import { createProfile, createSurface, deleteProfile, deleteSurface, profileListQueryOptions, profileQueryOptions, setProfileActive, setSurfaceActive, surfaceListQueryOptions, surfaceQueryOptions, surfacesKeys, updateProfile, updateSurface } from './surfaces.api';
import { SurfacesRequestError } from './surfaces-error';
import { profileCreate, profileUpdate, profileValues, surfaceCreate, surfaceUpdate, surfaceValues } from './surfaces-form.model';
import { profileListParams, surfaceListParams } from './surfaces.model';
import { surfacesSearchSchema } from './surfaces-search.model';
import { profileFixture, profileId, surfaceFixture, surfaceId } from './surfaces.test-support';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/shared/api/client', async () => {
  const { default: createClient } = await import('openapi-fetch');
  return { api: createClient<paths>({ baseUrl: 'http://localhost', credentials: 'include', fetch: fetchMock }) };
});
function request() { return fetchMock.mock.calls.at(-1)![0] as Request; }
beforeEach(() => { fetchMock.mockReset().mockRejectedValue(new Error('测试收到未声明请求')); });
const surface = surfaceFixture();
const profile = profileFixture();
const surfaceBody = surfaceCreate(surfaceValues(surface));
const profileBody = profileCreate(profileValues(profile));
const surfacePatch = surfaceUpdate(surfaceValues(surface), 4);
const profilePatch = profileUpdate(profileValues(profile), 7);
const commands = [
  { name: '创建观测面', execute: (token: string | null) => createSurface(surfaceBody, token), method: 'POST', path: '/api/v1/geo/engine-surfaces', body: surfaceBody, canonical: surface },
  { name: '更新观测面', execute: (token: string | null) => updateSurface(surfaceId.toUpperCase(), surfacePatch, token), method: 'PATCH', path: `/api/v1/geo/engine-surfaces/${surfaceId}`, body: surfacePatch, canonical: surface },
  { name: '启用观测面', execute: (token: string | null) => setSurfaceActive(surfaceId, 4, true, token), method: 'POST', path: `/api/v1/geo/engine-surfaces/${surfaceId}/enable`, body: { expected_revision: 4 }, canonical: surface },
  { name: '停用观测面', execute: (token: string | null) => setSurfaceActive(surfaceId, 4, false, token), method: 'POST', path: `/api/v1/geo/engine-surfaces/${surfaceId}/disable`, body: { expected_revision: 4 }, canonical: surface },
  { name: '删除观测面', execute: (token: string | null) => deleteSurface(surfaceId, 4, token), method: 'DELETE', path: `/api/v1/geo/engine-surfaces/${surfaceId}?expected_revision=4`, body: undefined, canonical: undefined },
  { name: '创建采集配置', execute: (token: string | null) => createProfile(profileBody, token), method: 'POST', path: '/api/v1/geo/collection-profiles', body: profileBody, canonical: profile },
  { name: '更新采集配置', execute: (token: string | null) => updateProfile(profileId.toUpperCase(), profilePatch, token), method: 'PATCH', path: `/api/v1/geo/collection-profiles/${profileId}`, body: profilePatch, canonical: profile },
  { name: '启用采集配置', execute: (token: string | null) => setProfileActive(profileId, 7, true, token), method: 'POST', path: `/api/v1/geo/collection-profiles/${profileId}/enable`, body: { expected_revision: 7 }, canonical: profile },
  { name: '停用采集配置', execute: (token: string | null) => setProfileActive(profileId, 7, false, token), method: 'POST', path: `/api/v1/geo/collection-profiles/${profileId}/disable`, body: { expected_revision: 7 }, canonical: profile },
  { name: '删除采集配置', execute: (token: string | null) => deleteProfile(profileId, 7, token), method: 'DELETE', path: `/api/v1/geo/collection-profiles/${profileId}?expected_revision=7`, body: undefined, canonical: undefined },
];
describe('GEO 配置 HTTP 边界', () => {
  it.each(commands)('$name 使用准确路径、CSRF/revision，完整 body 含显式 null 且不自动重放', async ({ execute, method, path, body, canonical }) => {
    fetchMock.mockResolvedValueOnce(canonical ? Response.json(canonical) : new Response(null, { status: 204 }));
    await expect(execute('geo-csrf')).resolves.toEqual(canonical);
    expect(request().url).toBe(`http://localhost${path}`); expect(request().method).toBe(method);
    expect(request().headers.get('X-CSRF-Token')).toBe('geo-csrf');
    expect(request().headers.has('Idempotency-Key')).toBe(false);
    if (body) expect(await request().json()).toEqual(body); else expect(await request().text()).toBe('');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(commands)('$name 缺少 CSRF 不发网', async ({ execute }) => {
    await expect(execute(null)).rejects.toBeInstanceOf(SurfacesRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('两种列表读取独立 typed URL 参数和唯一 key；编辑身份不影响列表请求', async () => {
    const search = surfacesSearchSchema.parse({ tab: 'profiles', surface_id: surfaceId.toUpperCase(), profile_id: profileId, q: '人工', collection_mode: 'MANUAL', is_active: false, sort: 'UPDATED_DESC', page: 2, page_size: 10, editor: 1 });
    const page = { items: [profile], page: 2, page_size: 10, total: 11 };
    fetchMock.mockResolvedValueOnce(Response.json(page));
    const client = new QueryClient();
    const query = profileListQueryOptions(search);
    await expect(client.fetchQuery(query)).resolves.toEqual(page);
    expect(query.queryKey).toEqual(surfacesKeys.profiles(profileListParams(search)));
    expect(profileListQueryOptions({ ...search, profile_id: undefined, editor: undefined, new: 1 }).queryKey).toEqual(query.queryKey);
    expect(Object.fromEntries(new URL(request().url).searchParams)).toEqual({ q: '人工', engine_surface_id: surfaceId, collection_mode: 'MANUAL', is_active: 'false', sort: 'UPDATED_DESC', page: '2', page_size: '10' });
    expect(query).toMatchObject({ retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always' });
    const surfaceSearch = surfacesSearchSchema.parse({ surface_kind: 'MANUAL_SITE', surface_id: surfaceId });
    fetchMock.mockResolvedValueOnce(Response.json({ items: [surface], page: 1, page_size: 20, total: 1 }));
    await client.fetchQuery(surfaceListQueryOptions(surfaceSearch));
    expect(surfaceListQueryOptions(surfaceSearch).queryKey).toEqual(surfacesKeys.surfaces(surfaceListParams(surfaceSearch)));
    expect(Object.fromEntries(new URL(request().url).searchParams)).toEqual({ surface_kind: 'MANUAL_SITE', sort: 'NAME_ASC', page: '1', page_size: '20' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('详情支持只读 null 投影和实际 AbortSignal，取消不会填充旧 cache', async () => {
    const client = new QueryClient();
    const readonly = { ...surface, configuration: null, available_actions: [], deletion: null, primary_task: 'VIEW_SUMMARY' };
    fetchMock.mockResolvedValueOnce(Response.json(readonly));
    await expect(client.fetchQuery(surfaceQueryOptions(surfaceId))).resolves.toEqual(readonly);
    expect(request().signal).toBeInstanceOf(AbortSignal);
    expect(profileQueryOptions('', false).enabled).toBe(false);
    fetchMock.mockImplementationOnce((pending: Request) => new Promise<Response>((_, reject) => pending.signal.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')))));
    const options = profileQueryOptions(profileId);
    const rejection = expect(client.fetchQuery(options)).rejects.toBeInstanceOf(Error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await client.cancelQueries({ queryKey: options.queryKey }); await rejection;
    expect(request().signal.aborted).toBe(true); expect(client.getQueryData(options.queryKey)).toBeUndefined();
  });
  it('409 保留结构化错误和 request ID；任何命令失败只有一次请求', async () => {
    const detail = { code: 'GEO_PROFILE_INELIGIBLE', message: '当前不能启用', details: { blockers: [{ code: 'ADAPTER_NOT_APPROVED', field: 'adapter_key' }] }, request_id: 'geo-api-conflict' };
    fetchMock.mockResolvedValueOnce(Response.json({ error: detail }, { status: 409 }));
    await expect(setProfileActive(profileId, 7, true, 'geo-csrf')).rejects.toMatchObject({ status: 409, detail, message: '当前不能启用（请求 ID：geo-api-conflict）' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('未知失败不展示原始响应或秘密，不把畸形成功当删除完成', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'UNKNOWN', message: 'secret-sentinel' } }, { status: 500 }));
    await expect(deleteSurface(surfaceId, 4, 'geo-csrf')).rejects.toMatchObject({ status: 500, detail: undefined, message: '删除观测面失败（HTTP 500）' });
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(deleteProfile(profileId, 7, 'geo-csrf')).rejects.toMatchObject({ status: 200 });
  });
});
