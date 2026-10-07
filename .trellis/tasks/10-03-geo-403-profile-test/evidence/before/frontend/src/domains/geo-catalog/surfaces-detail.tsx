import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { RowActions } from '@/design-system/data-table/row-actions';
import type { OverflowRowAction } from '@/design-system/data-table/types';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { CatalogNotice } from './catalog-controls';
import { ProfileForm } from './profile-form';
import { SurfaceForm } from './surface-form';
import { deleteProfile, deleteSurface, setProfileActive, setSurfaceActive, surfacesKeys } from './surfaces.api';
import { SurfacesRequestError, surfacesErrorMessage } from './surfaces-error';
import { actionLabel, activationLabels, complianceLabels, deletionLabels, kindLabels, loginLabels, modeLabels, stageLabels, testLabels, webPolicyLabels, type ConfigurationAction, type ConfigurationResource, type Profile, type Surface } from './surfaces.model';
import { shouldBlockSurfacesNavigation } from './surfaces-search.model';

type Intent = { action: Exclude<ConfigurationAction, 'UPDATE'> | 'VIEW_DELETION'; focus: HTMLElement | null };
function SurfacesDetail({ resource, token, editing, unavailable, reading, onEdit, onCloseEditor, onSaved, onDeleted, onReload, onProfiles }: {
  resource: ConfigurationResource; token: string | null; editing: boolean; unavailable: boolean; reading: boolean;
  onEdit: () => void; onCloseEditor: () => void; onSaved: (resource: ConfigurationResource) => void;
  onDeleted: () => void; onReload: () => Promise<ConfigurationResource>; onProfiles: () => void;
}) {
  const client = useQueryClient();
  const profile = 'activation_blockers' in resource;
  const key = profile ? surfacesKeys.profile(resource.summary.id) : surfacesKeys.surface(resource.summary.id);
  const [intent, setIntent] = useState<Intent>();
  const [error, setError] = useState<unknown>();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ retry: false, mutationFn: async ({ action, revision, continuation }: { action: Exclude<ConfigurationAction, 'UPDATE'>; revision: number; continuation: PrincipalContinuation }) => {
    await client.cancelQueries({ queryKey: key });
    continuation.assertCurrent();
    const id = resource.summary.id;
    if (action === 'DELETE') { if (profile) await deleteProfile(id, revision, token); else await deleteSurface(id, revision, token); return undefined; }
    return profile ? setProfileActive(id, revision, action === 'ENABLE', token) : setSurfaceActive(id, revision, action === 'ENABLE', token);
  } });
  const held = error instanceof SurfacesRequestError && error.status === 409;
  const blockedDelete = Boolean(resource.deletion?.blockers.length);
  const canConfirm = Boolean(intent && intent.action !== 'VIEW_DELETION' && resource.available_actions.includes(intent.action) && !(intent.action === 'DELETE' && blockedDelete) && !unavailable && !reading);
  const busy = mutation.isPending || refreshing;
  function begin(action: Intent['action'], focus?: HTMLElement | null) {
    returnFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setIntent({ action, focus: returnFocus.current }); setError(undefined);
  }
  async function confirm() {
    if (!intent || intent.action === 'VIEW_DELETION' || inFlight.current || held || !canConfirm) return;
    const state = client.getQueryState(key);
    const current = client.getQueryData<ConfigurationResource>(key);
    // 确认事件消费此 detail 的最新投影；名称、资格和 revision 不复制到 dialog state。
    if (state?.fetchStatus === 'fetching' || state?.error || !current || !current.available_actions.includes(intent.action) || (intent.action === 'DELETE' && current.deletion?.blockers.length)) {
      setError(new Error('当前配置尚未安全读取，请显式重新读取并确认。')); return;
    }
    inFlight.current = true;
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ action: intent.action, revision: current.summary.revision, continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: key });
      if (!continuation.isCurrent() || !mounted.current) return;
      setIntent(undefined); setError(undefined);
      if (canonical) { client.setQueryData(key, canonical); onSaved(canonical); setMessage(`${actionLabel(intent.action, profile)}已完成。`); }
      else onDeleted();
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { inFlight.current = false; }
  }
  async function reloadIntent() {
    if (busy) return;
    let continuation: PrincipalContinuation | undefined;
    setRefreshing(true);
    try {
      continuation = capturePrincipalContinuation(client);
      await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      setError(undefined);
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false); }
  }
  const overflow: OverflowRowAction[] = resource.available_actions.map((action) => ({ key: action, command: action, label: actionLabel(action, profile), enabled: !editing && !unavailable && (action === 'UPDATE' || !reading), ...(action === 'DELETE' ? { intent: 'danger' as const, confirmation: 'custom' as const } : { intent: 'secondary' as const, ...(action !== 'UPDATE' ? { confirmation: 'custom' as const } : {}) }) }));
  if (blockedDelete) {
    const deleteIndex = overflow.findIndex((item) => item.key === 'DELETE');
    if (deleteIndex >= 0) overflow.splice(deleteIndex, 1);
    overflow.push({ key: 'VIEW_DELETION', command: 'VIEW_DELETION', label: '查看删除条件', enabled: !editing && !unavailable, intent: 'secondary', confirmation: 'custom' });
  }
  function saved(canonical: ConfigurationResource) { onSaved(canonical); setMessage('已保存当前配置。'); }
  const summary = resource.summary;
  return <section aria-label={profile ? '采集配置详情' : '观测面详情'} className="min-w-0 space-y-4 rounded-xl border border-border-default bg-surface-panel p-4">
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockSurfacesNavigation(current, next)} when={busy} />
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-2"><h2 className="type-section-title break-words">{summary.name}</h2><div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant={resource.workflow_stage === 'ACTIVE' ? 'success' : resource.workflow_stage === 'BLOCKED' ? 'warning' : 'secondary'}>{stageLabels[resource.workflow_stage]}</Badge><span>Revision {summary.revision}</span></div></div><div className="shrink-0"><RowActions objectLabel={summary.name} onCommand={(action, focus) => { if (action === 'UPDATE') onEdit(); else if (action === 'ENABLE' || action === 'DISABLE' || action === 'DELETE' || action === 'VIEW_DELETION') begin(action, focus); else throw new Error('GEO 配置返回未知命令'); }} overflow={overflow} /></div></header>
    {message && <CatalogNotice>{message}</CatalogNotice>}
    {!resource.configuration && <CatalogNotice>当前为只读摘要。配置由管理员维护。</CatalogNotice>}
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      {'collection_mode' in summary ? <>
        <div><dt className="text-text-muted">所属观测面</dt><dd className="break-words">{summary.engine_surface.name} · {summary.engine_surface_id}</dd></div>
        <div><dt className="text-text-muted">采集模式</dt><dd>{modeLabels[summary.collection_mode]}</dd></div>
        <div><dt className="text-text-muted">语言 / 地区 / 登录</dt><dd>{summary.language_code} · {summary.region_code} · {loginLabels[summary.login_state]}</dd></div>
        <div><dt className="text-text-muted">搜索策略</dt><dd>{webPolicyLabels[summary.web_search_policy]}</dd></div>
        <div><dt className="text-text-muted">测试事实</dt><dd>{testLabels[summary.last_test_status]}（{summary.last_test_status}） · {summary.last_tested_at ? new Date(summary.last_tested_at).toLocaleString('zh-CN') : '无测试时间'}</dd></div>
      </> : <>
        <div><dt className="text-text-muted">标识</dt><dd className="break-words">{summary.slug}</dd></div><div><dt className="text-text-muted">类型 / 提供商</dt><dd>{kindLabels[summary.surface_kind]} · {summary.provider_brand}</dd></div><div><dt className="text-text-muted">合规状态</dt><dd>{complianceLabels[summary.compliance_status]}</dd></div>
      </>}
      <div><dt className="text-text-muted">更新时间</dt><dd><time dateTime={summary.updated_at}>{new Date(summary.updated_at).toLocaleString('zh-CN')}</time></dd></div>
    </dl>
    {resource.configuration && !editing && <ConfigurationView resource={resource} />}
    {!profile && <Button onClick={onProfiles} type="button" variant="outline">查看此观测面的采集配置</Button>}
    {profile && resource.activation_blockers !== null && <section aria-label="启用条件" className="space-y-2 border-t border-border-subtle pt-3"><h3 className="type-section-title">启用条件</h3>{resource.activation_blockers.length ? <CatalogNotice><ul className="list-disc space-y-1 pl-5">{resource.activation_blockers.map((blocker, index) => <li key={`${blocker.code}:${blocker.field}:${index}`}>{activationLabels[blocker.code]} <span className="text-text-muted">（{blocker.field}）</span></li>)}</ul></CatalogNotice> : <p className="text-sm" role="status">服务端当前没有启用阻断；提交时会再次核实。</p>}</section>}
    {resource.deletion && <DeletionConditions resource={resource} />}
    {editing && (profile ? resource.configuration && <ProfileForm onCancel={onCloseEditor} onReload={async () => await onReload() as Profile} onSaved={saved} profile={resource} token={token} unavailable={unavailable} /> : resource.configuration && <SurfaceForm onCancel={onCloseEditor} onReload={async () => await onReload() as Surface} onSaved={saved} surface={resource} token={token} unavailable={unavailable} />)}
    <Dialog onOpenChange={(open) => { if (!open && !busy) setIntent(undefined); }} open={Boolean(intent)}>
      <DialogContent finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : null} showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{intent?.action === 'VIEW_DELETION' ? '删除条件' : `确认${intent ? actionLabel(intent.action, profile) : '操作'}`}</DialogTitle><DialogDescription>{summary.name} · 当前 Revision {summary.revision}。{intent?.action === 'DELETE' ? '删除不能撤销；当前引用与历史保护由服务端再次核实。' : '只改变当前配置，不执行采集或测试，不改写历史。'}</DialogDescription></DialogHeader>
        {Boolean(error) && <CatalogNotice error>{surfacesErrorMessage(error)}</CatalogNotice>}
        {intent?.action === 'VIEW_DELETION' || intent?.action === 'DELETE' && blockedDelete ? <DeletionConditions resource={resource} /> : null}
        {intent?.action !== 'VIEW_DELETION' && !canConfirm && <CatalogNotice error>服务端当前未提供此动作，请关闭或显式重新读取。</CatalogNotice>}
        {(held || error || !canConfirm) && <Button disabled={busy} onClick={() => void reloadIntent()} type="button" variant="outline">重新读取并重新确认</Button>}
        <DialogFooter><Button disabled={busy} onClick={() => setIntent(undefined)} type="button" variant="outline">取消</Button>{intent?.action !== 'VIEW_DELETION' && <Button disabled={busy || held || !canConfirm || !token} onClick={() => void confirm()} type="button" variant={intent?.action === 'DELETE' ? 'destructive' : 'default'}>{mutation.isPending ? '提交中…' : '确认操作'}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
function DeletionConditions({ resource }: { resource: ConfigurationResource }) {
  return <section aria-label="删除条件" className="space-y-2 text-sm"><h3 className="type-section-title">删除条件</h3>{resource.deletion ? resource.deletion.blockers.length ? <ul className="list-disc space-y-1 pl-5">{resource.deletion.blockers.map((blocker) => <li key={blocker.type}>{deletionLabels[blocker.type]}：{blocker.count}{blocker.type === 'COLLECTION_PROFILE' && <a className="ml-2 underline underline-offset-2" href={`/configuration/geo-surfaces?tab=profiles&surface_id=${resource.summary.id}`} rel="noopener noreferrer" target="_blank">查看引用</a>}</li>)}</ul> : <p>服务端当前没有删除阻断，删除时会再次核实。</p> : <p>当前响应未提供删除管理上下文。</p>}</section>;
}
function ConfigurationView({ resource }: { resource: ConfigurationResource }) {
  const config = resource.configuration;
  if (!config) return null;
  return <section aria-label="管理员非敏感配置" className="space-y-2 border-t border-border-subtle pt-3"><h3 className="type-section-title">管理员配置</h3>{'collection_mode' in config ? <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-text-muted">适配器</dt><dd className="break-words">{config.adapter_key}</dd></div>{config.collection_mode === 'API' ? <><div><dt className="text-text-muted">模型绑定</dt><dd className="break-all">渠道 {config.ai_channel_id ?? '无'} · 模型 {config.ai_model_id ?? '无'}</dd></div><div><dt className="text-text-muted">温度 / 输出 token 上限</dt><dd>{config.settings.temperature ?? '未指定'} / {config.settings.max_output_tokens ?? '未指定'}</dd></div></> : <><div><dt className="text-text-muted">要求截图</dt><dd>{config.settings.require_screenshot ? '是' : '否'}</dd></div>{config.collection_mode === 'BROWSER' && <div><dt className="text-text-muted">回答超时</dt><dd>{config.settings.answer_timeout_seconds} 秒</dd></div>}</>}</dl> : <><p className="break-words text-sm">公开网站：{config.website_url ?? '未填写'}</p><p className="break-words text-sm">支持能力：{Object.entries(config.capabilities).filter(([, supported]) => supported).map(([field]) => ({ answer_text: '回答正文', citations: '引用', web_search_signal: '搜索信号', model_version: '模型版本', usage: '使用量', cost: '费用' })[field]).join('、')}</p></>}</section>;
}
export { SurfacesDetail };
