import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { RowActions } from '@/design-system/data-table/row-actions';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { changePlanStatus, copyPlan, deletePlan, PlanRequestError, planKeys, type PlanStatusCommand } from './plans.api';
import { actionLabels, assertNever, planFormSchema, roleLabels, scheduleLabels, shouldBlockPlanNavigation, stageLabels, type PlanDetail } from './plans.model';
import { parsePlanCommand, planOverflow, planPrimary } from './plan-actions';
import { PlanNotice, planErrorMessage } from './plan-controls';
import { PlanPreviewPanel } from './plan-preview';

type Command = PlanStatusCommand | 'COPY' | 'DELETE';
type Intent = { action: Command; revision: number };
type PlanDetailHandle = { request: (action: ReturnType<typeof parsePlanCommand>, focus?: HTMLElement | null) => void };
const copySchema = z.object({ name: planFormSchema.shape.name });
function PlanDetailPanel({ plan, csrfToken, initialAction, onSaved, onDeleted, onReload, onEdit, readBlocked = false, ref }: {
  plan: PlanDetail; csrfToken: string | null; initialAction?: ReturnType<typeof parsePlanCommand>;
  onSaved: (plan: PlanDetail) => void; onDeleted: (id: string) => void; onReload: () => Promise<PlanDetail>; onEdit: (step?: number) => void; readBlocked?: boolean; ref?: Ref<PlanDetailHandle>;
}) {
  const client = useQueryClient();
  const [intent, setIntent] = useState<Intent | undefined>(() => initialAction && ['ACTIVATE', 'PAUSE', 'RESUME', 'ARCHIVE', 'COPY', 'DELETE'].includes(initialAction) ? { action: initialAction as Command, revision: plan.revision } : undefined);
  const copyForm = useForm<{ name: string }>({ defaultValues: { name: `${plan.name.slice(0, 195)} 副本` }, resolver: zodResolver(copySchema), mode: 'onChange' });
  const { isValid: copyValid, errors: copyErrors, isDirty: copyDirty } = copyForm.formState;
  const [error, setError] = useState<unknown>();
  const [conflicted, setConflicted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true); const inFlight = useRef(false);
  const currentPlan = useRef(plan); const blockedRead = useRef(readBlocked);
  useLayoutEffect(() => { currentPlan.current = plan; blockedRead.current = readBlocked; }, [plan, readBlocked]);
  const finalFocus = useRef<HTMLElement | null>(null);
  const preview = useRef<HTMLElement | null>(null); const conditions = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ retry: false, mutationFn: async ({ target, name, continuation }: { target: Intent; name: string; continuation: PrincipalContinuation }) => {
    await Promise.all([client.cancelQueries({ queryKey: planKeys.detail(plan.id) }), client.cancelQueries({ queryKey: planKeys.lists() })]);
    continuation.assertCurrent();
    if (!mounted.current || blockedRead.current || currentPlan.current.revision !== target.revision || !currentPlan.current.available_actions.includes(target.action)) throw new Error('当前版本、权限或工作区已变化，请重新读取并核对');
    switch (target.action) {
      case 'DELETE': await deletePlan(plan.id, target.revision, csrfToken); return undefined;
      case 'COPY': return copyPlan(plan.id, target.revision, name, csrfToken);
      case 'ACTIVATE': case 'PAUSE': case 'RESUME': case 'ARCHIVE': return changePlanStatus(plan.id, target.revision, target.action, csrfToken);
      default: return assertNever(target.action);
    }
  } });
  const held = conflicted;
  const canConfirm = Boolean(!readBlocked && intent && plan.available_actions.includes(intent.action) && plan.revision === intent.revision);
  function begin(action: ReturnType<typeof parsePlanCommand>, focus?: HTMLElement | null) {
    if (readBlocked || inFlight.current || refreshing) return;
    finalFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (action === 'VIEW_DELETION_CONDITIONS') { conditions.current?.focus(); return; }
    if (!plan.available_actions.includes(action)) return;
    switch (action) {
      case 'UPDATE': case 'CREATE_REVISION': onEdit(); break;
      case 'PREVIEW': preview.current?.focus(); break;
      case 'COPY': case 'ACTIVATE': case 'PAUSE': case 'RESUME': case 'ARCHIVE': case 'DELETE': setIntent({ action, revision: plan.revision }); if (!held) setError(undefined); break;
      default: return assertNever(action);
    }
  }
  useImperativeHandle(ref, () => ({ request: begin }));
  async function confirm() {
    if (!intent || !canConfirm || held || inFlight.current || intent.action === 'COPY' && !copyValid) return;
    const target = intent;
    inFlight.current = true; setError(undefined);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ target, name: copyForm.getValues('name'), continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await Promise.all([client.cancelQueries({ queryKey: planKeys.detail(plan.id) }), client.cancelQueries({ queryKey: planKeys.lists() }), ...(canonical && canonical.id !== plan.id ? [client.cancelQueries({ queryKey: planKeys.detail(canonical.id) })] : [])]);
      if (!continuation.isCurrent() || !mounted.current) return;
      setConflicted(false); setIntent(undefined); setMessage(`${actionLabels[target.action]}已完成。`);
      if (canonical) { client.setQueryData(planKeys.detail(canonical.id), canonical); copyForm.reset({ name: copyForm.getValues('name') }); onSaved(canonical); }
      else onDeleted(plan.id);
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) { setError(failure); if (failure instanceof PlanRequestError && failure.status === 409) setConflicted(true); } }
    finally { inFlight.current = false; }
  }
  async function reloadIntent() {
    if (refreshing || inFlight.current) return;
    setRefreshing(true); let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client); const canonical = await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      setIntent((current) => current ? { ...current, revision: canonical.revision } : undefined); setError(undefined); setConflicted(false);
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false); }
  }
  const busy = mutation.isPending || refreshing;
  const primary = planPrimary(plan);
  return <section aria-label="监测计划详情" className="min-w-0 space-y-5">
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockPlanNavigation(current, next)} when={busy || Boolean(intent?.action === 'COPY' && copyDirty)} />
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={plan.workflow_stage === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[plan.workflow_stage]}</Badge><span className="text-sm">Revision {plan.revision}</span></div><RowActions objectLabel="当前计划" onCommand={(action, focus) => begin(parsePlanCommand(action), focus)} overflow={planOverflow(plan, busy || readBlocked)} primary={primary ? { ...primary, enabled: primary.enabled && !busy && !readBlocked } : undefined} /></header>
    {message && <PlanNotice>{message}</PlanNotice>}
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-text-muted">计划名称</dt><dd className="break-words">{plan.name}</dd></div><div className="sm:col-span-2"><dt className="text-text-muted">说明</dt><dd className="whitespace-pre-wrap break-words">{plan.description || '未填写说明'}</dd></div><div><dt className="text-text-muted">调度配置</dt><dd className="break-words">{scheduleLabels[plan.schedule_kind]} · {plan.cron_expression ?? '按需触发'} · {plan.timezone}</dd></div><div><dt className="text-text-muted">预算上限</dt><dd>{plan.budget_limit ?? '未设置'}</dd></div><div className="sm:col-span-2"><dt className="text-text-muted">监测对象与角色</dt><dd className="space-y-1">{plan.subjects.map((item) => <p className="break-all" key={item.subject_id}>{roleLabels[item.role]} · {item.subject_id}</p>)}</dd></div><div className="sm:col-span-2"><dt className="text-text-muted">问题变体</dt><dd className="space-y-1">{plan.prompt_variant_ids.map((id) => <p className="break-all" key={id}><a className="text-interaction-primary underline" href={`/geo/questions?selected=${id}`} rel="noopener noreferrer" target="_blank">{id}</a></p>)}</dd></div><div className="sm:col-span-2"><dt className="text-text-muted">采集配置</dt><dd className="space-y-1">{plan.collection_profile_ids.map((id) => <p className="break-all" key={id}>{id}</p>)}</dd></div></dl>
    <section className="min-w-0 space-y-3" ref={preview} tabIndex={-1}><PlanPreviewPanel onFix={plan.available_actions.includes('UPDATE') || plan.available_actions.includes('CREATE_REVISION') ? (step) => onEdit(step) : undefined} preview={plan.preview} /></section>
    <PlanNotice>R1 当前提供配置与预览。立即运行尚未开放（{plan.run_entry.reason_code}），定时执行和批次历史将在后续任务交付。</PlanNotice>
    {plan.deletion.blockers.length > 0 && <section aria-label="删除条件" className="space-y-2 border-t border-border-subtle pt-3" ref={conditions} tabIndex={-1}><h3 className="type-section-title">删除条件</h3>{plan.deletion.blockers.map((code) => <p className="text-sm" key={code}>{deletionReason(code)}</p>)}</section>}
    <Dialog onOpenChange={(open) => { if (!open && !busy) setIntent(undefined); }} open={Boolean(intent)}><DialogContent finalFocus={() => finalFocus.current?.isConnected ? finalFocus.current : null} showCloseButton={!busy}><DialogHeader><DialogTitle>确认{intent ? actionLabels[intent.action] : '操作'}</DialogTitle><DialogDescription>{intent ? confirmationText(intent.action) : ''} Revision {intent?.revision}。</DialogDescription></DialogHeader>
      {intent?.action === 'COPY' && <div className="space-y-1 text-sm"><label htmlFor="plan-copy-name">新计划名称</label><Input {...copyForm.register('name')} aria-describedby={copyErrors.name ? 'plan-copy-error' : undefined} aria-invalid={Boolean(copyErrors.name)} disabled={busy} id="plan-copy-name" maxLength={200} />{copyErrors.name && <span className="text-danger" id="plan-copy-error">{copyErrors.name.message}</span>}</div>}
      {Boolean(error) && <PlanNotice error>{planErrorMessage(error)}</PlanNotice>}
      {held && <p role="alert">此前操作返回409，本地输入保留。请显式重新读取并核对后再次确认。</p>}
      {!canConfirm && <p role="alert">当前版本或服务端动作已变化，请重新读取并核对。</p>}
      {(held || !canConfirm) && <Button disabled={busy} onClick={() => void reloadIntent()} type="button" variant="outline">重新读取并重新确认</Button>}
      <DialogFooter><Button disabled={busy} onClick={() => setIntent(undefined)} type="button" variant="outline">取消</Button><Button disabled={!canConfirm || held || busy || !csrfToken || intent?.action === 'COPY' && !copyValid} onClick={() => void confirm()} type="button" variant={intent?.action === 'DELETE' || intent?.action === 'ARCHIVE' ? 'destructive' : 'default'}>{busy ? '提交中…' : '确认操作'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
function deletionReason(code: PlanDetail['deletion']['blockers'][number]) { switch (code) { case 'PLAN_NOT_DISABLED': return '当前计划不是未启用状态，服务端不允许删除；可按可用动作归档。'; case 'ARCHIVED': return '归档计划只读，不能删除；可复制为新计划。'; default: return assertNever(code); } }
function confirmationText(action: Command) { switch (action) {
  case 'ACTIVATE': return '服务端会重新检查当前资源资格。启用仅保存计划状态，R1 尚未执行调度或采集。';
  case 'PAUSE': return '暂停计划，不改变已保存的配置或历史。';
  case 'RESUME': return '恢复前由服务端重新检查资源资格，不改写历史。';
  case 'ARCHIVE': return '归档后只读且不能重新启用，可以复制为新计划。';
  case 'DELETE': return '删除后不能恢复。服务端会再次检查删除条件。';
  case 'COPY': return '复制当前服务端配置为独立的新计划，初始未启用；源计划保持原样。';
  default: return assertNever(action);
} }
export { PlanDetailPanel };
export type { PlanDetailHandle };
