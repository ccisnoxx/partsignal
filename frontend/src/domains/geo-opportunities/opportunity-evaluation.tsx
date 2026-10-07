import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { opportunityKeys, OpportunityRequestError } from './opportunities.api';
import { formatTime, modeLabels } from './opportunities.model';
import { OpportunityNotice, OpportunitySelect } from './opportunity-controls';
import { evaluateOpportunities } from './opportunity-evaluation.api';
import { evaluationFormSchema, evaluationReason, evaluationRequest, type EvaluationValues } from './opportunity-evaluation.model';
import { EvaluationOptions } from './opportunity-evaluation-options';

type Command = { body: components['schemas']['GeoOpportunityEvaluationRequest']; key: string; continuation: PrincipalContinuation };
const initial: EvaluationValues = { scope: 'FILTERED', date_from: '', date_to: '', rule_set_revision: 1, subject_ids: [], engine_surface_ids: [], collection_profile_ids: [], collection_modes: ['MANUAL'] };
export function OpportunityEvaluation({ csrfToken }: { csrfToken: string | null }) {
  const client = useQueryClient();
  const form = useForm<EvaluationValues>({ defaultValues: initial, resolver: zodResolver(evaluationFormSchema), mode: 'onChange' });
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<Command>(); const [error, setError] = useState<unknown>();
  const [receipt, setReceipt] = useState<components['schemas']['GeoOpportunityEvaluationReceipt']>();
  const mounted = useRef(true); const inFlight = useRef(false); const controller = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const values = useWatch({ control: form.control }) as EvaluationValues;
  const denied = error instanceof OpportunityRequestError && [401, 403].includes(error.status ?? 0);
  const locked = busy || Boolean(command) || Boolean(receipt) || denied;
  async function execute(values?: EvaluationValues) {
    if (inFlight.current || denied || !csrfToken || receipt) return;
    let pending = command;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (!pending) {
        if (!values) return;
        pending = { body: evaluationRequest(values), key: crypto.randomUUID(), continuation: capturePrincipalContinuation(client) };
        setCommand(pending);
      }
      pending.continuation.assertCurrent(); controller.current = new AbortController();
      const result = await evaluateOpportunities(pending.body, pending.key, csrfToken, controller.current.signal);
      if (!mounted.current || !pending.continuation.isCurrent()) return;
      setReceipt(result); setCommand(undefined); form.reset(form.getValues());
      void client.invalidateQueries({ queryKey: opportunityKeys.root() });
    } catch (failure) {
      if (!mounted.current || (pending && !pending.continuation.isCurrent())) return;
      setError(failure);
      // 已确认的HTTP拒绝允许修正输入；网络/5xx结果未知，继续保留同一冻结命令。
      if (failure instanceof OpportunityRequestError && failure.status && failure.status >= 400 && failure.status < 500) setCommand(undefined);
    } finally { inFlight.current = false; controller.current = null; if (mounted.current && (!pending || pending.continuation.isCurrent())) setBusy(false); }
  }
  const errors = Object.entries(form.formState.errors).flatMap(([name, value]) => value?.message ? [{ id: name, fieldId: `evaluation-${name}`, message: String(value.message) }] : []);
  return <section aria-label="管理员机会评估" className="min-w-0 space-y-3">
    <Button type="button" ref={trigger} variant="outline" aria-expanded={open} onClick={() => setOpen(true)}>评估 Opportunity</Button>
    <DirtyGuard when={form.formState.isDirty || busy || Boolean(command)} />
    {open && <FormProvider {...form}><form aria-label="管理员显式评估" className="min-w-0 space-y-4 rounded-lg border border-border-default p-4" onSubmit={(event) => void form.handleSubmit((value) => execute(value))(event)}>
      <h2 className="type-section-title">管理员显式评估</h2>
      <p className="text-sm text-text-secondary">仅评估已保存观测；不会自动采集、创建行动或复测。时间为含开始、不含结束的窗口，最长 31 天；提交后规则与范围冻结。</p>
      <fieldset className="min-w-0 space-y-4" disabled={locked}>
        <div className="grid gap-3 sm:grid-cols-2">{(['date_from', 'date_to', 'rule_set_revision'] as const).map((name) => <FormField<EvaluationValues, typeof name> key={name} name={name} id={`evaluation-${name}`} label={name === 'date_from' ? '评估开始时间' : name === 'date_to' ? '评估结束时间' : '评估规则修订号'} description={name === 'rule_set_revision' ? '明确填写已存在的规则修订号；可使用历史规则。' : '带时区的 ISO 时间，例如 2026-10-07T00:00:00Z。'} required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => <Input {...field} type={name === 'rule_set_revision' ? 'number' : 'text'} min={name === 'rule_set_revision' ? 1 : undefined} id={inputId} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => field.onChange(name === 'rule_set_revision' ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />} />)}</div>
        <FormField<EvaluationValues, 'scope'> name="scope" id="evaluation-scope" label="评估范围" required render={({ field, inputId }) => <OpportunitySelect id={inputId} label="评估范围" value={field.value} choices={[{ value: 'FILTERED', label: '明确筛选对象' }, { value: 'ALL', label: '全部对象（不带实体过滤）' }]} onChange={field.onChange} />} />
        <p className="text-xs">全部范围必须先移除已选对象；切换范围不会静默清空输入。产品范围通过已关联产品的 Subject 选择。</p>
        {values.scope === 'ALL' && (values.subject_ids.length + values.engine_surface_ids.length + values.collection_profile_ids.length > 0) && <Button type="button" variant="outline" disabled={locked} onClick={() => { for (const key of ['subject_ids', 'engine_surface_ids', 'collection_profile_ids'] as const) form.setValue(key, [], { shouldDirty: true, shouldValidate: true }); }}>明确清除实体过滤</Button>}
        {values.scope === 'FILTERED' && <div className="grid min-w-0 gap-4 lg:grid-cols-3">{([{ kind: 'subject_ids', label: 'Subject / 产品' }, { kind: 'engine_surface_ids', label: 'Surface' }, { kind: 'collection_profile_ids', label: 'Profile' }] as const).map(({ kind, label }) => <EvaluationOptions key={kind} kind={kind} label={label} value={values[kind]} disabled={locked} onChange={(ids) => form.setValue(kind, ids, { shouldDirty: true, shouldValidate: true })} />)}</div>}
        <div className="space-y-2"><p className="type-label">Collection Mode（空选表示所有历史模式）</p><div className="flex flex-wrap gap-2">{(['MANUAL', 'API', 'BROWSER'] as const).map((mode) => <Button key={mode} type="button" variant="outline" aria-pressed={values.collection_modes.includes(mode)} disabled={locked} onClick={() => form.setValue('collection_modes', values.collection_modes.includes(mode) ? values.collection_modes.filter((item) => item !== mode) : [...values.collection_modes, mode], { shouldDirty: true, shouldValidate: true })}>{modeLabels[mode]}</Button>)}</div></div>
      </fieldset>
      <ErrorSummary errors={errors} />
      {busy && <p role="status">正在评估，请勿重复提交…</p>}
      {Boolean(error) && <OpportunityNotice error>{error instanceof Error ? error.message : '评估失败'}{error instanceof OpportunityRequestError && error.status === 409 && <p>请求冲突，输入已保留。请核对规则与范围，修正后显式提交新的请求。</p>}{error instanceof OpportunityRequestError && error.status === 422 && <p>窗口、范围或规则不符合合同，请修正表单。</p>}{denied && <p>当前会话没有评估权限，请确认账号权限后返回工作台。</p>}</OpportunityNotice>}
      {command && !busy && <OpportunityNotice><p>提交结果未知；输入和幂等键已保留。恢复仅发送原范围、窗口和规则，服务端去重，不创建第二次请求。</p><Button type="button" variant="outline" onClick={() => void execute()}>使用原请求核对评估结果</Button></OpportunityNotice>}
      {receipt && <section aria-label="评估冻结回执" className="min-w-0 space-y-2"><h3 className="type-section-title">评估冻结回执</h3><p className="break-all text-xs">评估 ID：{receipt.evaluation_run_id} · 规则 revision {receipt.rule_set_revision} · 截止 {formatTime(receipt.as_of)} · {receipt.replayed ? '原请求回放' : '首次提交'}</p><p>评估结果 {receipt.evaluated_cells} · 新建 {receipt.created} · 复用 {receipt.existing_reused} · 跳过 {receipt.skipped}</p><p className="text-xs">计数为规则与范围的结果数；跳过包含未触发，多个不可用原因可同时影响同一结果。</p>{receipt.unavailable_reasons.length ? <ul className="list-disc pl-5 text-sm">{receipt.unavailable_reasons.map(({ code, count }) => <li className="break-words" key={code}>{evaluationReason(code)}：{count}</li>)}</ul> : <p>服务端未报告不可用原因。</p>}</section>}
      <div className="flex flex-wrap gap-2">{!receipt && <Button type="submit" disabled={locked || !csrfToken || !form.formState.isValid}>确认执行评估</Button>}{receipt && <Button type="button" variant="outline" onClick={() => { setReceipt(undefined); setError(undefined); }}>开始新评估</Button>}<Button type="button" variant="ghost" disabled={busy || Boolean(command)} onClick={() => { setOpen(false); queueMicrotask(() => trigger.current?.focus()); }}>收起评估表单（保留输入）</Button></div>
    </form></FormProvider>}
  </section>;
}
