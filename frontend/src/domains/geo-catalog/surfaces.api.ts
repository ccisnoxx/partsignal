import type { RequestBodyOption } from 'openapi-fetch';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuid } from '@/shared/lib/canonical-uuid';
import { requireSurfacesCsrf, surfacesRequestError } from './surfaces-error';
import { profileListParams, surfaceListParams, type Profile, type ProfileListParams, type Surface, type SurfaceListParams } from './surfaces.model';
import type { SurfacesSearch } from './surfaces-search.model';

const surfacesKeys = {
  root: () => ['geo', 'surface-management'] as const,
  lists: () => ['geo', 'surface-management', 'list'] as const,
  surfaces: (params: SurfaceListParams) => ['geo', 'surface-management', 'list', 'surfaces', params] as const,
  profiles: (params: ProfileListParams) => ['geo', 'surface-management', 'list', 'profiles', params] as const,
  surface: (id: string) => ['geo', 'surface-management', 'detail', 'surface', id] as const,
  profile: (id: string) => ['geo', 'surface-management', 'detail', 'profile', id] as const,
  profileDetails: () => ['geo', 'surface-management', 'detail', 'profile'] as const,
};
function surfaceListQueryOptions(search: SurfacesSearch, enabled = true) {
  const params = surfaceListParams(search);
  return queryOptions({ enabled, queryKey: surfacesKeys.surfaces(params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/engine-surfaces', { params: { query: params }, signal });
    if (!result.data) throw surfacesRequestError('读取观测面列表', result);
    return result.data as components['schemas']['GeoEngineSurfaceListPage'];
  }, retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always' });
}
function profileListQueryOptions(search: SurfacesSearch, enabled = true) {
  const params = profileListParams(search);
  return queryOptions({ enabled, queryKey: surfacesKeys.profiles(params), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/collection-profiles', { params: { query: params }, signal });
    if (!result.data) throw surfacesRequestError('读取采集配置列表', result);
    return result.data as components['schemas']['GeoCollectionProfileListPage'];
  }, retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always' });
}
function surfaceQueryOptions(id: string, enabled = true) {
  return queryOptions({ enabled, queryKey: surfacesKeys.surface(id), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/engine-surfaces/{surface_id}', { params: { path: { surface_id: canonicalUuid(id) } }, signal });
    if (!result.data) throw surfacesRequestError('读取观测面详情', result);
    return result.data as Surface;
  }, retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always' });
}
function profileQueryOptions(id: string, enabled = true) {
  return queryOptions({ enabled, queryKey: surfacesKeys.profile(id), queryFn: async ({ signal }) => {
    const result = await api.GET('/api/v1/geo/collection-profiles/{profile_id}', { params: { path: { profile_id: canonicalUuid(id) } }, signal });
    if (!result.data) throw surfacesRequestError('读取采集配置详情', result);
    return result.data as Profile;
  }, retry: false, staleTime: 30_000, refetchOnWindowFocus: 'always' });
}
async function createSurface(body: components['schemas']['GeoEngineSurfaceCreate'], token: string | null) {
  const result = await api.POST('/api/v1/geo/engine-surfaces', { body, params: { header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError('创建观测面', result);
  return result.data as Surface;
}
async function updateSurface(id: string, body: components['schemas']['GeoEngineSurfaceUpdate'], token: string | null) {
  const result = await api.PATCH('/api/v1/geo/engine-surfaces/{surface_id}', { body, params: { path: { surface_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError('更新观测面', result);
  return result.data as Surface;
}
// openapi-fetch 0.17 的 Writable 会误删纯 null 字段；wire body 必须保留 generated 合同中的显式 null。
async function createProfile(body: components['schemas']['GeoCollectionProfileCreate'], token: string | null) {
  const result = await api.POST('/api/v1/geo/collection-profiles', { body: body as RequestBodyOption<operations['createGeoCollectionProfile']>['body'], params: { header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError('创建采集配置', result);
  return result.data as Profile;
}
async function updateProfile(id: string, body: components['schemas']['GeoCollectionProfileUpdate'], token: string | null) {
  const result = await api.PATCH('/api/v1/geo/collection-profiles/{profile_id}', { body: body as RequestBodyOption<operations['updateGeoCollectionProfile']>['body'], params: { path: { profile_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError('更新采集配置', result);
  return result.data as Profile;
}
async function setSurfaceActive(id: string, expectedRevision: number, active: boolean, token: string | null) {
  const path = active ? '/api/v1/geo/engine-surfaces/{surface_id}/enable' as const : '/api/v1/geo/engine-surfaces/{surface_id}/disable' as const;
  const result = await api.POST(path, { body: { expected_revision: expectedRevision }, params: { path: { surface_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError(active ? '启用观测面' : '停用观测面', result);
  return result.data as Surface;
}
async function setProfileActive(id: string, expectedRevision: number, active: boolean, token: string | null) {
  const path = active ? '/api/v1/geo/collection-profiles/{profile_id}/enable' as const : '/api/v1/geo/collection-profiles/{profile_id}/disable' as const;
  const result = await api.POST(path, { body: { expected_revision: expectedRevision }, params: { path: { profile_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError(active ? '启用采集配置' : '停用采集配置', result);
  return result.data as Profile;
}
async function testProfile(id: string, expectedRevision: number, token: string | null) {
  const result = await api.POST('/api/v1/geo/collection-profiles/{profile_id}/test', { body: { expected_revision: expectedRevision }, params: { path: { profile_id: canonicalUuid(id) }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (!result.data) throw surfacesRequestError('测试采集配置连接', result);
  return result.data as Profile;
}
async function deleteSurface(id: string, expectedRevision: number, token: string | null) {
  const result = await api.DELETE('/api/v1/geo/engine-surfaces/{surface_id}', { params: { path: { surface_id: canonicalUuid(id) }, query: { expected_revision: expectedRevision }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (result.response.status !== 204) throw surfacesRequestError('删除观测面', result);
  // 与认证边界一致：消费空响应，让 Chromium 完整结束请求后再关闭详情。
  await result.response.text();
}
async function deleteProfile(id: string, expectedRevision: number, token: string | null) {
  const result = await api.DELETE('/api/v1/geo/collection-profiles/{profile_id}', { params: { path: { profile_id: canonicalUuid(id) }, query: { expected_revision: expectedRevision }, header: { 'X-CSRF-Token': requireSurfacesCsrf(token) } } });
  if (result.response.status !== 204) throw surfacesRequestError('删除采集配置', result);
  await result.response.text();
}
export { surfacesKeys, surfaceListQueryOptions, profileListQueryOptions, surfaceQueryOptions, profileQueryOptions, createSurface, updateSurface, createProfile, updateProfile, setSurfaceActive, setProfileActive, testProfile, deleteSurface, deleteProfile };
