import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import type { components } from '@/shared/api/generated/schema';
import { Button } from '@/design-system/primitives/button';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs';
import { CatalogNotice } from './catalog-controls';
import { ProfileForm } from './profile-form';
import { SurfaceForm } from './surface-form';
import { profileQueryOptions, surfaceQueryOptions, surfacesKeys } from './surfaces.api';
import { SurfacesDetail } from './surfaces-detail';
import { SurfacesList } from './surfaces-list';
import { SurfacesRequestError, surfacesErrorMessage } from './surfaces-error';
import type { ConfigurationResource } from './surfaces.model';
import { surfacesEditorIdentity, surfacesSearchSchema, type SurfacesSearch } from './surfaces-search.model';

function SurfacesPage({ search, token, isAdmin, onSearchChange }: {
  search: SurfacesSearch; token: string | null; isAdmin: boolean;
  onSearchChange: (search: SurfacesSearch, replace?: boolean, ignoreBlocker?: boolean) => void;
}) {
  const client = useQueryClient();
  const profiles = search.tab === 'profiles';
  const surface = useQuery(surfaceQueryOptions(search.surface_id ?? '', !profiles && Boolean(search.surface_id)));
  const profile = useQuery(profileQueryOptions(search.profile_id ?? '', profiles && Boolean(search.profile_id)));
  const detail = profiles ? profile : surface;
  const selected = profiles ? search.profile_id : search.surface_id;
  const identity = surfacesEditorIdentity(search);
  const [refreshError, setRefreshError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const latestSearch = useRef(search);
  useEffect(() => { latestSearch.current = search; }, [search]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unavailable = Boolean(detail.error instanceof SurfacesRequestError && (detail.error.status === 401 || detail.error.status === 403 || detail.error.status === 404));
  async function refreshConsumers(changedProfile: boolean) {
    let continuation: PrincipalContinuation | undefined;
    setRefreshError(undefined);
    try {
      continuation = capturePrincipalContinuation(client);
      // 无缓存的首次 GET 会被 invalidateQueries 复用；先取消才能读取提交后的快照。
      await Promise.all([client.cancelQueries({ queryKey: surfacesKeys.lists() }), ...(!changedProfile ? [client.cancelQueries({ queryKey: surfacesKeys.profileDetails() })] : [])]);
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.invalidateQueries({ queryKey: surfacesKeys.root(), refetchType: 'none' });
      if (!continuation.isCurrent() || !mounted.current) return;
      await Promise.all([client.invalidateQueries({ queryKey: surfacesKeys.lists() }, { throwOnError: true }), ...(!changedProfile ? [client.invalidateQueries({ queryKey: surfacesKeys.profileDetails() }, { throwOnError: true })] : [])]);
    } catch (error) { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshError(error); }
  }
  function saved(resource: ConfigurationResource) {
    const changedProfile = 'activation_blockers' in resource;
    void refreshConsumers(changedProfile);
    const current = latestSearch.current;
    if (current.new) {
      onSearchChange(surfacesSearchSchema.parse({ ...current, new: undefined, editor: 1, ...(changedProfile ? { tab: 'profiles', profile_id: resource.summary.id } : { surface_id: resource.summary.id }) }), true, true);
    }
  }
  function deleted() {
    if (!selected) return;
    type Page = components['schemas']['GeoEngineSurfaceListPage'] | components['schemas']['GeoCollectionProfileListPage'];
    client.setQueriesData<Page>({ queryKey: surfacesKeys.lists() }, (current) => current ? { ...current, items: current.items.filter((item) => item.summary.id !== selected) } as Page : current);
    void client.invalidateQueries({ queryKey: profiles ? surfacesKeys.profile(selected) : surfacesKeys.surface(selected), refetchType: 'none' });
    onSearchChange(surfacesSearchSchema.parse({ ...latestSearch.current, editor: undefined, ...(profiles ? { profile_id: undefined } : { surface_id: undefined }) }), true, true);
    setMessage(profiles ? '采集配置已删除。' : '观测面已删除。');
    void refreshConsumers(profiles);
  }
  async function reload(): Promise<ConfigurationResource> {
    if (!selected) throw new Error('当前没有选中的配置');
    const continuation = capturePrincipalContinuation(client);
    const requestedIdentity = identity;
    const key = profiles ? surfacesKeys.profile(selected) : surfacesKeys.surface(selected);
    await client.cancelQueries({ queryKey: key });
    continuation.assertCurrent();
    const canonical = profiles ? await client.fetchQuery({ ...profileQueryOptions(selected), staleTime: 0 }) : await client.fetchQuery({ ...surfaceQueryOptions(selected), staleTime: 0 });
    continuation.assertCurrent();
    if (!mounted.current || surfacesEditorIdentity(latestSearch.current) !== requestedIdentity) throw new Error('当前配置已切换，已丢弃旧配置读取结果');
    return canonical;
  }
  const closeEditor = () => onSearchChange(surfacesSearchSchema.parse({ ...latestSearch.current, new: undefined, editor: undefined }));
  return <section aria-labelledby="geo-surfaces-title" className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><h1 className="type-page-title" id="geo-surfaces-title">GEO 平台与采集配置</h1><p className="max-w-3xl text-text-secondary">维护观测面及人工、API、浏览器模式的非敏感配置。管理操作不执行采集。</p></div>{isAdmin && <Button onClick={() => onSearchChange(surfacesSearchSchema.parse({ ...search, new: 1, editor: undefined }))} type="button">{profiles ? '新建采集配置' : '新建观测面'}</Button>}</header>
    {!isAdmin && <CatalogNotice>ENGINEER 只读：可查看非敏感摘要，配置由管理员维护。</CatalogNotice>}
    {message && <CatalogNotice>{message}</CatalogNotice>}
    <Tabs onValueChange={(tab) => { if (tab === 'surfaces' || tab === 'profiles') onSearchChange(surfacesSearchSchema.parse({ tab })); }} value={profiles ? 'profiles' : 'surfaces'}><TabsList aria-label="GEO 配置类别"><TabsTrigger value="surfaces">观测面</TabsTrigger><TabsTrigger value="profiles">采集配置</TabsTrigger></TabsList></Tabs>
    {Boolean(refreshError) && <CatalogNotice error>操作已完成，但关联列表刷新失败：{surfacesErrorMessage(refreshError)}<Button onClick={() => void refreshConsumers(profiles)} type="button" variant="outline">重新读取关联列表</Button></CatalogNotice>}
    <SurfacesList onChange={onSearchChange} search={search} />
    {search.new && (isAdmin ? <section aria-label={profiles ? '创建采集配置' : '创建观测面'} className="min-w-0 space-y-4 rounded-xl border border-border-default bg-surface-panel p-4"><h2 className="type-section-title">{profiles ? '新建采集配置' : '新建观测面'}</h2>{profiles ? <ProfileForm key={identity} onCancel={closeEditor} onSaved={saved} surfaceId={search.surface_id} token={token} /> : <SurfaceForm key={identity} onCancel={closeEditor} onSaved={saved} token={token} />}</section> : <CatalogNotice>当前账号没有创建 GEO 配置的权限。</CatalogNotice>)}
    {selected && <>
      {detail.data ? <>
        {detail.error && <CatalogNotice error>{detail.error instanceof SurfacesRequestError && detail.error.status === 404 ? '资源已删除。' : '后台详情刷新失败，当前编辑输入已保留：'}{surfacesErrorMessage(detail.error)}<Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情刷新</Button></CatalogNotice>}
        {detail.isFetching && <p role="status">正在刷新配置详情…</p>}
        <SurfacesDetail editing={search.editor === 1} key={identity} onCloseEditor={closeEditor} onDeleted={deleted} onEdit={() => onSearchChange(surfacesSearchSchema.parse({ ...latestSearch.current, editor: 1 }))} onProfiles={() => onSearchChange(surfacesSearchSchema.parse({ tab: 'profiles', surface_id: detail.data!.summary.id }))} onReload={reload} onSaved={saved} reading={detail.isFetching} resource={detail.data} token={token} unavailable={unavailable} />
      </> : detail.isPending ? <CatalogNotice>正在读取配置详情…</CatalogNotice> : <CatalogNotice error>{detail.error instanceof SurfacesRequestError && detail.error.status === 404 ? '资源不存在或已删除。' : detail.error instanceof SurfacesRequestError && detail.error.status === 403 ? '当前账号无权读取此配置。' : '配置详情读取失败。'}{surfacesErrorMessage(detail.error)}<div className="flex flex-wrap gap-2"><Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情</Button><Button onClick={() => onSearchChange(surfacesSearchSchema.parse({ ...latestSearch.current, editor: undefined, ...(profiles ? { profile_id: undefined } : { surface_id: undefined }) }))} type="button" variant="outline">关闭详情</Button></div></CatalogNotice>}
    </>}
  </section>;
}
export { SurfacesPage };
