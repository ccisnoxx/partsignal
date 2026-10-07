import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { TableShell } from '@/design-system/data-table/table-shell';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { OpportunityRequestError } from './opportunities.api';
import type { Opportunity, OpportunityDetail } from './opportunities.model';
import { createOpportunityRetest, invalidateOpportunityBusiness, opportunityRetestPreviewOptions } from './opportunity-business.api';
import { baselineBatchChoices, businessErrorMessage, businessFailureKind, businessRequest, opportunityRetestFormSchema, retestDifferenceLabels, type BusinessRequest, type OpportunityRetestValues, type RetestCommand } from './opportunity-business.model';
import { OpportunityNotice } from './opportunity-controls';

export function OpportunityRetest({ opportunityId, detail, blocked, csrfToken, onReload, onDenied, onCreated }: {
  opportunityId: string; detail?: OpportunityDetail; blocked: boolean; csrfToken: string | null;
  onReload: () => Promise<Opportunity>; onDenied: (error: OpportunityRequestError) => void; onCreated: (batchId: string) => void;
}) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false); const [baseline, setBaseline] = useState<Opportunity>();
  const [requestedBaseline, setRequestedBaseline] = useState<string>();
  const [held, setHeld] = useState(false); const [unknown, setUnknown] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(); const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<components['schemas']['GeoRetestCreated']>();
  const request = useRef<BusinessRequest<RetestCommand> | undefined>(undefined);
  const inFlight = useRef(false); const mounted = useRef(true); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const form = useForm<OpportunityRetestValues>({ defaultValues: { baseline_batch_id: '' }, resolver: zodResolver(opportunityRetestFormSchema), mode: 'onChange' });
  const selectedBaseline = useWatch({ control: form.control, name: 'baseline_batch_id' });
  const { isDirty, isValid, isSubmitting, errors } = form.formState;
  const offered = detail?.available_action_types.includes('ADDITIONAL_MONITORING') === true;
  const previewQuery = useQuery(opportunityRetestPreviewOptions(opportunityId, requestedBaseline, open && owner.isCurrent() && !unknown));
  const preview = requestedBaseline === selectedBaseline ? previewQuery.data : undefined;
  const current = () => mounted.current && owner.isCurrent();
  const denied = businessFailureKind(error) === 'denied' || businessFailureKind(previewQuery.error) === 'denied';
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async (command: BusinessRequest<RetestCommand>) => {
    owner.assertCurrent();
    if (!controller.current) throw new Error('Retest 请求缺少取消边界');
    return createOpportunityRetest(opportunityId, command, csrfToken, controller.current.signal);
  } });
  const busy = mutation.isPending || refreshing || isSubmitting;
  const stale = Boolean(baseline && detail && baseline.revision !== detail.opportunity.revision) || Boolean(preview && baseline && preview.opportunity_revision !== baseline.revision);
  const unavailable = blocked || !offered || !csrfToken || busy || held || denied || stale || !owner.isCurrent();
  useEffect(() => { if (previewQuery.error instanceof OpportunityRequestError && businessFailureKind(previewQuery.error) === 'denied' && owner.isCurrent()) onDenied(previewQuery.error); }, [previewQuery.error, onDenied, owner]);

  function changeBaseline(value: string) {
    if (inFlight.current || unknown) return;
    setRequestedBaseline(undefined); setError(undefined); setMessage(''); setReceipt(undefined);
    form.setValue('baseline_batch_id', value, { shouldDirty: true, shouldValidate: true });
  }
  async function previewRetest(values: OpportunityRetestValues) {
    if (inFlight.current || unavailable || unknown || previewQuery.isFetching || !current()) return;
    setError(undefined); setMessage('');
    form.setValue('baseline_batch_id', values.baseline_batch_id);
    if (requestedBaseline === values.baseline_batch_id) await previewQuery.refetch();
    else setRequestedBaseline(values.baseline_batch_id);
  }
  async function create() {
    if (inFlight.current || !current() || busy || denied || !csrfToken || (unknown && blocked)) return;
    if (!unknown && (unavailable || previewQuery.isFetching || previewQuery.error || !preview?.comparable || preview.requires_new_baseline || !baseline)) return;
    const command = unknown ? request.current : preview ? businessRequest<RetestCommand>({ expected_revision: preview.opportunity_revision, baseline_batch_id: preview.baseline_batch_id }, request.current) : undefined;
    if (!command) return;
    request.current = command; inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage('');
    let committed = false;
    try {
      const result = await mutation.mutateAsync(command);
      if (!current()) return;
      committed = true;
      request.current = undefined; setUnknown(false); setHeld(false); setReceipt(result); setRequestedBaseline(undefined); form.reset(form.getValues()); setOpen(false);
      setMessage(`${result.replayed ? '已确认原 Retest 创建结果' : '已创建 Retest'}：${result.requested_run_count} 次运行，机会 revision ${result.opportunity_revision}。复测不会自动解决机会，结果变化不能证明因果。`);
      await invalidateOpportunityBusiness(client, opportunityId, 'retest');
      if (current()) onCreated(result.batch_id);
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (committed) return;
      const kind = businessFailureKind(failure); setUnknown(kind === 'unknown'); setHeld(kind === 'conflict');
      if (kind === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const issues = failure.detail?.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (issue && typeof issue === 'object' && 'loc' in issue && 'msg' in issue && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && issue.loc[1] === 'baseline_batch_id' && typeof issue.msg === 'string') form.setError('baseline_batch_id', { message: issue.msg });
        }
      }
    } finally { inFlight.current = false; controller.current = null; if (current()) mutation.reset(); }
  }
  async function reload() {
    if (inFlight.current || busy || unknown || !current()) return;
    setRefreshing(true); setMessage('');
    try {
      const canonical = await onReload();
      if (!current()) return;
      setBaseline(canonical); setRequestedBaseline(undefined); setHeld(false); setError(undefined); form.clearErrors();
      if (error instanceof OpportunityRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') request.current = undefined;
      setMessage(`已读取机会 revision ${canonical.revision}，原基线 ID 已保留；请重新预览同一基线并核对，不会自动更换基线。`);
    } catch (failure) { if (current()) { setError(failure); if (businessFailureKind(failure) === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure); } }
    finally { if (current()) setRefreshing(false); }
  }
  if (!owner.isCurrent()) return <p role="alert">认证主体已变化，请重新进入机会详情。</p>;
  if (!offered && !open && !receipt) return null;
  return <section aria-label="Retest 预览与创建" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">Retest 复测</h3>
    <DirtyGuard when={!receipt && (isDirty || busy || unknown || previewQuery.isFetching)} description={unknown ? 'Retest 创建结果尚未确认，离开会丢失原载荷和幂等键。请先确认原请求结果。' : undefined} shouldBlockNavigation={({ current: location, next }) => location.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {!open && offered && <Button type="button" disabled={blocked || !csrfToken} variant="outline" onClick={() => { setBaseline(detail?.opportunity); setOpen(true); setReceipt(undefined); }}>预览并创建 Retest</Button>}
    {message && <OpportunityNotice>{message}</OpportunityNotice>}
    {receipt && Boolean(error) && <OpportunityNotice error>Retest 已创建，关联列表刷新失败：{businessErrorMessage(error)}。可打开已确认的批次核对。</OpportunityNotice>}
    {receipt && <OpportunityNotice><p className="break-all">Retest 批次：{receipt.batch_id} · 冻结基线：{receipt.baseline_id}</p><a className="text-interaction-primary underline underline-offset-4" href={`/geo/runs?batch_id=${receipt.batch_id}`}>打开新 Retest 批次</a></OpportunityNotice>}
    {open && baseline && !denied && <>
      <p className="break-all text-sm">来源 Opportunity：{opportunityId} · 提交 revision {baseline.revision}</p>
      <p className="text-sm text-text-secondary">从当前来源页选择冻结批次，或明确填写其他历史来源基线 ID。最终来源资格与可比性由服务端预览裁决。</p>
      {!offered && <OpportunityNotice>服务端当前未提供 Retest 创建动作；原基线已保留，新提交暂停。</OpportunityNotice>}
      <FormProvider {...form}><form aria-label="Retest 基线预览表单" className="space-y-3" onSubmit={(event) => void form.handleSubmit(previewRetest)(event)}>
        <fieldset disabled={busy || unknown || held || blocked || stale} className="space-y-3">
          <div className="flex flex-col gap-2">{detail && baselineBatchChoices(detail).map((choice) => <Button key={choice.value} type="button" variant="outline" className="h-auto justify-start whitespace-normal break-all text-left" aria-pressed={choice.value === selectedBaseline} onClick={() => changeBaseline(choice.value)}>{choice.label}</Button>)}</div>
          {detail?.sources.items.length === 0 && <p className="text-sm">当前来源页没有批次候选。可切换来源页，或明确填写已知的基线批次 ID。</p>}
          <FormField<OpportunityRetestValues, 'baseline_batch_id'> name="baseline_batch_id" id="opportunity-retest-baseline" label="Retest 基线批次 ID" description="必须是明确的 UUID；修改基线后需要重新预览。" required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => <Input {...field} id={inputId} onChange={(event) => changeBaseline(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid} aria-required />} />
        </fieldset>
        <ErrorSummary errors={errors.baseline_batch_id?.message ? [{ id: 'baseline', fieldId: 'opportunity-retest-baseline', message: errors.baseline_batch_id.message }] : []} />
        <Button type="submit" variant="outline" disabled={unavailable || unknown || !isValid || previewQuery.isFetching}>预览 Retest</Button>
      </form></FormProvider>
      {previewQuery.isFetching && <p role="status">正在核对基线与冻结矩阵…</p>}
      {Boolean(error) && <OpportunityNotice error>{businessErrorMessage(error)}</OpportunityNotice>}
      {previewQuery.error && <OpportunityNotice error>{businessErrorMessage(previewQuery.error)}{businessFailureKind(previewQuery.error) !== 'denied' && businessFailureKind(previewQuery.error) !== 'conflict' && <Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void previewQuery.refetch()}>重试 Retest 预览</Button>}</OpportunityNotice>}
      {(held || stale || businessFailureKind(previewQuery.error) === 'conflict') && <OpportunityNotice><p>机会修订号或复测依据已变化，基线 ID 已保留；提交暂停，请显式刷新、重新预览并确认。</p><Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void reload()}>加载最新机会并保留 Retest 基线</Button></OpportunityNotice>}
      {preview && !previewQuery.error && <RetestPreview preview={preview} />}
      {unknown ? <OpportunityNotice><p>Retest 创建结果未知。原载荷与幂等键已冻结；可显式使用同一请求确认，不会自动重发。</p><Button type="button" disabled={busy || blocked || !csrfToken} onClick={() => void create()}>确认原 Retest 创建结果</Button></OpportunityNotice> : preview && <Button type="button" disabled={unavailable || previewQuery.isFetching || Boolean(previewQuery.error) || !preview.comparable || preview.requires_new_baseline} onClick={() => void create()}>确认创建 Retest</Button>}
      <Button type="button" variant="ghost" disabled={busy || unknown} onClick={() => { form.reset({ baseline_batch_id: '' }); setRequestedBaseline(undefined); setOpen(false); setError(undefined); setHeld(false); request.current = undefined; }}>取消 Retest 创建</Button>
    </>}
    {denied && <p role="alert">{businessErrorMessage(error ?? previewQuery.error)}</p>}
  </section>;
}
function RetestPreview({ preview }: { preview: components['schemas']['GeoRetestPreview'] }) {
  return <section aria-label="Retest 可比性预览" className="min-w-0 space-y-3">
    <OpportunityNotice><p>可比性：{preview.comparable ? '可比较' : '不可比较'} · requires_new_baseline：{preview.requires_new_baseline ? '是，需要新基线' : '否'}</p><p className="break-all">预览 Opportunity revision {preview.opportunity_revision} · 原基线批次 {preview.baseline_batch_id}</p>{!preview.comparable && <p>当前预览禁止创建 Retest。请核对具体差异；页面不会自动更换基线。</p>}</OpportunityNotice>
    <section aria-label="Retest 具体差异" className="space-y-2"><h4 className="type-label">differences：{preview.differences.length} 项</h4>{preview.differences.map((difference, index) => <p key={`${difference.code}-${difference.field}-${index}`} className="break-all text-sm">{retestDifferenceLabels[difference.code]}（{difference.code}） · {difference.field} · 资源 {difference.resource_id ?? '无'}{difference.reason && ` · ${difference.reason}`}</p>)}{preview.differences.length === 0 && <p className="text-sm">服务端未发现可比性差异。</p>}</section>
    <section aria-label="Retest 冻结矩阵" className="min-w-0 space-y-2"><h4 className="type-label">冻结矩阵：{preview.snapshot.cells.length} 次运行（只读）</h4><p className="text-xs text-text-secondary">复测复制历史问题、采集配置、对象和事实绑定；不使用当前计划重新生成矩阵。</p>
      <TableShell regionLabel="Retest 冻结运行矩阵"><thead><tr><th scope="col">原运行 / 重复序号</th><th scope="col">冻结问题 / 采集方式</th><th scope="col">实际产品 / 模型 / 版本</th><th scope="col">完整冻结输入</th></tr></thead><tbody>{preview.snapshot.cells.map((cell) => <tr key={cell.root_run_id}><td className="max-w-sm break-all">{cell.root_run_id}<p>重复 {cell.repeat_index}</p></td><td className="max-w-sm whitespace-pre-wrap break-words">{cell.input_snapshot.prompt.prompt_text}<p>{cell.input_snapshot.profile.collection_mode}</p></td><td className="max-w-sm break-words">{cell.source_product ?? '未记录'} · {cell.source_model ?? '未记录'} · {cell.source_version ?? '未记录'}</td><td className="max-w-sm"><details><summary className="cursor-pointer text-sm">冻结输入与事实绑定</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{JSON.stringify(cell.input_snapshot, null, 2)}</pre></details></td></tr>)}</tbody></TableShell>
      <details><summary className="cursor-pointer text-sm">完整冻结基线、计划与规则</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{JSON.stringify(preview.snapshot, null, 2)}</pre></details>
    </section>
    <p className="text-xs text-text-secondary">创建和复测结果都不会自动解决机会；后续比较与恢复判断仍需显式确认，变化不证明因果。</p>
  </section>;
}
