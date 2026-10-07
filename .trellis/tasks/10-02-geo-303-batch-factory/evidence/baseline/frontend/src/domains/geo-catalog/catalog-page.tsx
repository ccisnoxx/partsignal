import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { catalogDetailQueryOptions, catalogKeys } from './catalog.api';
import { catalogEditorIdentity, catalogSearchSchema, type CatalogSearch, type Subject } from './catalog.model';
import { CatalogNotice, catalogErrorMessage } from './catalog-controls';
import { CatalogDetail } from './catalog-detail';
import { CatalogList } from './catalog-list';
import { CatalogSubjectForm } from './catalog-subject-form';

function CatalogPage({ search, csrfToken, isAdmin, onSearchChange, onConsumersChanged }: {
  search: CatalogSearch; csrfToken: string | null; isAdmin: boolean;
  onSearchChange: (search: CatalogSearch, replace?: boolean, ignoreBlocker?: boolean) => void;
  onConsumersChanged: () => Promise<void>;
}) {
  const client = useQueryClient();
  const detail = useQuery(catalogDetailQueryOptions(search.subject_id ?? '', Boolean(search.subject_id)));
  const [refreshError, setRefreshError] = useState<unknown>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = catalogEditorIdentity(search);
  const latestSearch = useRef(search);
  useEffect(() => { latestSearch.current = search; }, [search]);
  async function refreshConsumers() {
    let continuation: PrincipalContinuation | undefined;
    setRefreshError(undefined);
    try {
      continuation = capturePrincipalContinuation(client);
      await client.invalidateQueries({ queryKey: catalogKeys.root(), refetchType: 'none' });
      if (!continuation.isCurrent()) return;
      await Promise.all([client.invalidateQueries({ queryKey: catalogKeys.lists() }, { throwOnError: true }), onConsumersChanged()]);
    } catch (error) { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshError(error); }
  }
  function saved(subject: Subject) {
    void refreshConsumers();
    const current = latestSearch.current;
    if (current.new) onSearchChange(catalogSearchSchema.parse({ ...current, new: undefined, subject_id: subject.id }), true, true);
  }
  async function reload() {
    if (!search.subject_id) throw new Error('没有可读取的监测对象');
    const continuation = capturePrincipalContinuation(client);
    const requestedIdentity = identity;
    await client.cancelQueries({ queryKey: catalogKeys.detail(search.subject_id) });
    continuation.assertCurrent();
    const subject = await client.fetchQuery({ ...catalogDetailQueryOptions(search.subject_id), staleTime: 0 });
    continuation.assertCurrent();
    if (!mounted.current || catalogEditorIdentity(latestSearch.current) !== requestedIdentity) throw new Error('当前对象已切换，已丢弃旧对象读取结果');
    return subject;
  }
  return <section aria-labelledby="catalog-title" className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><h1 className="type-page-title" id="catalog-title">监测对象与竞品</h1><p className="max-w-3xl text-text-secondary">维护自有品牌、产品、竞品和参考型号，以及后续监测使用的身份字典。</p></div>{isAdmin && <Button onClick={() => onSearchChange(catalogSearchSchema.parse({ ...search, subject_id: undefined, new: 1 }))} type="button">新建监测对象</Button>}</header>
    {!isAdmin && <CatalogNotice>ENGINEER 只读：可以搜索和查看监测对象，配置由管理员维护。</CatalogNotice>}
    {Boolean(refreshError) && <CatalogNotice error>操作已完成，但关联列表刷新失败：{catalogErrorMessage(refreshError)}<Button onClick={() => void refreshConsumers()} type="button" variant="outline">重新读取关联列表</Button></CatalogNotice>}
    <CatalogList onChange={onSearchChange} search={search} />
    {search.new && (isAdmin ? <section aria-label="创建监测身份" className="space-y-4 rounded-xl border border-border-default bg-surface-panel p-4"><h2 className="type-section-title">新建监测对象</h2><CatalogSubjectForm csrfToken={csrfToken} key={identity} onCancel={() => onSearchChange(catalogSearchSchema.parse({ ...search, new: undefined }))} onDirtyChange={() => undefined} onSaved={saved} /></section> : <CatalogNotice>当前账号没有创建监测对象的权限。</CatalogNotice>)}
    {search.subject_id && <>
      {detail.data ? <>
        {detail.error && <CatalogNotice error>后台详情刷新失败，当前编辑输入已保留：{catalogErrorMessage(detail.error)}<Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情刷新</Button></CatalogNotice>}
        {detail.isFetching && <p role="status">正在刷新对象详情…</p>}
        <CatalogDetail csrfToken={csrfToken} key={identity}
          onDeleted={() => { client.removeQueries({ queryKey: catalogKeys.detail(search.subject_id!) }); void refreshConsumers(); onSearchChange(catalogSearchSchema.parse({ ...latestSearch.current, subject_id: undefined }), true, true); }}
          onParentFilter={() => onSearchChange(catalogSearchSchema.parse({ ...search, q: undefined, subject_type: undefined, product_id: undefined, is_active: undefined, parent_subject_id: search.subject_id, page: 1 }))}
          onReload={reload} onSaved={saved} subject={detail.data} />
      </> : detail.isPending ? <CatalogNotice>正在读取对象详情…</CatalogNotice> : <CatalogNotice error>{catalogErrorMessage(detail.error)}<div className="flex flex-wrap gap-2"><Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情</Button><Button onClick={() => onSearchChange(catalogSearchSchema.parse({ ...search, subject_id: undefined }))} type="button" variant="outline">关闭详情</Button></div></CatalogNotice>}
    </>}
  </section>;
}
export { CatalogPage };
