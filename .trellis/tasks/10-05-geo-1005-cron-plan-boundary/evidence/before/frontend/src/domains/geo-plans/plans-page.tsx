import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/design-system/primitives/sheet';
import type { components } from '@/shared/api/generated/schema';
import { PlanRequestError, planDetailOptions, planKeys } from './plans.api';
import { planEditorIdentity, planSearchSchema, type PlanDetail, type PlanSearch } from './plans.model';
import { PlanNotice, planErrorMessage } from './plan-controls';
import { PlanDetailPanel, type PlanDetailHandle } from './plan-detail';
import { PlanList, type OpenPlan } from './plan-list';
import { PlanWizard } from './plan-wizard';
function PlansPage({ search, csrfToken, onSearchChange }: { search: PlanSearch; csrfToken: string | null; onSearchChange: (next: PlanSearch, replace?: boolean, ignoreBlocker?: boolean) => void }) {
  const client = useQueryClient();
  const detail = useQuery(planDetailOptions(search.selected ?? '', Boolean(search.selected)));
  const [request, setRequest] = useState<{ id: string; command?: Parameters<OpenPlan>[1] }>();
  const [editStep, setEditStep] = useState(0);
  const [refreshError, setRefreshError] = useState<unknown>();
  const latestSearch = useRef(search); const mounted = useRef(true); const returnFocus = useRef<HTMLElement | null>(null); const detailActions = useRef<PlanDetailHandle | null>(null);
  useEffect(() => { latestSearch.current = search; }, [search]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = planEditorIdentity(search);
  const open = useCallback<OpenPlan>((plan, command, focus) => {
    returnFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (latestSearch.current.selected === plan.id && command && !latestSearch.current.edit) { detailActions.current?.request(command, focus); return; }
    setEditStep(0);
    setRequest({ id: plan.id, command });
    onSearchChange(planSearchSchema.parse({ ...latestSearch.current, new: undefined, selected: plan.id, edit: command === 'UPDATE' || command === 'CREATE_REVISION' ? 1 : undefined }));
  }, [onSearchChange]);
  async function refreshLists() {
    let continuation: PrincipalContinuation | undefined;
    setRefreshError(undefined);
    try { continuation = capturePrincipalContinuation(client); await client.invalidateQueries({ queryKey: planKeys.lists() }, { throwOnError: true }); }
    catch (error) { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshError(error); }
  }
  function saved(plan: PlanDetail) {
    void refreshLists();
    const current = latestSearch.current;
    if (current.new || current.edit || current.selected !== plan.id) onSearchChange(planSearchSchema.parse({ ...current, new: undefined, edit: undefined, selected: plan.id }), true, true);
  }
  function deleted(id: string) {
    client.setQueriesData<components['schemas']['GeoMonitoringPlanListPage']>({ queryKey: planKeys.lists() }, (current) => current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current);
    void client.invalidateQueries({ queryKey: planKeys.detail(id), refetchType: 'none' });
    onSearchChange(planSearchSchema.parse({ ...latestSearch.current, selected: undefined, edit: undefined }), true, true);
    void refreshLists();
  }
  async function reload() {
    const id = latestSearch.current.selected;
    if (!id) throw new Error('没有可读取的计划');
    const requestedIdentity = planEditorIdentity(latestSearch.current); const continuation = capturePrincipalContinuation(client);
    await client.cancelQueries({ queryKey: planKeys.detail(id) }); continuation.assertCurrent();
    const canonical = await client.fetchQuery({ ...planDetailOptions(id), staleTime: 0 }); continuation.assertCurrent();
    if (!mounted.current || planEditorIdentity(latestSearch.current) !== requestedIdentity) throw new Error('计划已切换，已丢弃旧读取结果');
    return canonical;
  }
  const close = () => onSearchChange(planSearchSchema.parse({ ...latestSearch.current, selected: undefined, new: undefined, edit: undefined }));
  const edit = (step = 0) => { setEditStep(step); onSearchChange(planSearchSchema.parse({ ...latestSearch.current, edit: 1 })); };
  const unrecoverable = detail.error instanceof PlanRequestError && (detail.error.status === 403 || detail.error.status === 404);
  const readState = <>{detail.data && detail.error && <PlanNotice error>后台读取失败，本地输入已保留：{planErrorMessage(detail.error)}{!unrecoverable && <Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情读取</Button>}{unrecoverable && <p>当前计划已不可访问，输入保留供核对，请关闭工作区。</p>}</PlanNotice>}{detail.isFetching && <p role="status">正在读取计划详情…</p>}{!detail.data && (detail.isPending ? <PlanNotice>正在读取计划…</PlanNotice> : <PlanNotice error>{planErrorMessage(detail.error)}{!unrecoverable && <Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情读取</Button>}<Button onClick={close} type="button" variant="outline">关闭工作区</Button></PlanNotice>)}</>;
  return <section aria-labelledby="plans-title" className="min-w-0 space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><h1 className="type-page-title" id="plans-title">监测计划</h1><p className="max-w-3xl text-text-secondary">组合监测对象、问题变体和采集配置，预览运行矩阵并管理计划状态。</p></div><Button onClick={(event) => { returnFocus.current = event.currentTarget; onSearchChange(planSearchSchema.parse({ ...latestSearch.current, selected: undefined, edit: undefined, new: 1 })); }} type="button">新建监测计划</Button></header>
    {Boolean(refreshError) && <PlanNotice error>操作已完成，但列表刷新失败：{planErrorMessage(refreshError)}<Button onClick={() => void refreshLists()} type="button" variant="outline">重新读取列表</Button></PlanNotice>}
    <PlanList onChange={onSearchChange} onOpen={open} search={search} />
    {(search.new || search.edit && search.selected) && <section aria-label="计划配置工作区" className="min-w-0 space-y-4 rounded-xl border border-border-default bg-surface-panel p-4"><h2 className="type-section-title">{search.new ? '新建监测计划向导' : '修订监测计划配置'}</h2>{!search.new && readState}{search.new || detail.data ? <PlanWizard initialStep={search.new ? 0 : editStep} csrfToken={csrfToken} key={identity} onCancel={close} onReload={search.new ? undefined : reload} onSaved={saved} plan={search.new ? undefined : detail.data} readBlocked={!search.new && unrecoverable} /> : null}</section>}
    <Sheet onOpenChange={(isOpen) => { if (!isOpen) close(); }} open={Boolean(search.selected && !search.edit)}>{search.selected && !search.edit && <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : null}><SheetHeader><SheetTitle>监测计划工作区</SheetTitle><SheetDescription>完整配置、服务端预览与可用动作。</SheetDescription></SheetHeader><div className="min-w-0 space-y-4 px-4 pb-6">{readState}{detail.data && <PlanDetailPanel csrfToken={csrfToken} initialAction={request?.id === search.selected ? request.command : undefined} key={identity} onDeleted={deleted} onEdit={edit} onReload={reload} onSaved={saved} plan={detail.data} readBlocked={unrecoverable} ref={detailActions} />}</div></SheetContent>}</Sheet>
  </section>;
}
export { PlansPage };
