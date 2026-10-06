import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch, type FieldErrors, type Path } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Button } from '@/design-system/primitives/button';
import { PlanNotice, planErrorMessage } from './plan-controls';
import { planFieldStep } from './plan-preview.model';
import { PlanPreviewPanel } from './plan-preview';
import { PlanConfigurationSummary, PlanWizardStep, planStepLabels, stepFields } from './plan-wizard-steps';
import { createPlan, PlanRequestError, planKeys, previewPlan, updatePlan } from './plans.api';
import { planCreate, planFormSchema, planUpdate, planValues, shouldBlockPlanNavigation, type PlanDetail, type PlanPreview, type PlanValues } from './plans.model';

type PreviewSnapshot = { generation: number; snapshot: string; result: PlanPreview };
function formIssues(errors: FieldErrors<PlanValues>) {
  const issues: { field: string; message: string }[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== 'object') return;
    if ('message' in value && typeof value.message === 'string') issues.push({ field: path, message: value.message });
    for (const [key, entry] of Object.entries(value)) if (key !== 'ref' && key !== 'message' && key !== 'type' && key !== 'types') visit(entry, key === 'root' ? path : path ? `${path}.${key}` : key);
  }
  visit(errors, '');
  return issues;
}
function PlanWizard({ plan, csrfToken, onSaved, onReload, onCancel, readBlocked = false, initialStep = 0 }: {
  plan?: PlanDetail; csrfToken: string | null; onSaved: (plan: PlanDetail) => void;
  onReload?: () => Promise<PlanDetail>; onCancel: () => void; readBlocked?: boolean; initialStep?: number;
}) {
  const client = useQueryClient();
  const form = useForm<PlanValues>({ defaultValues: planValues(plan), resolver: zodResolver(planFormSchema), mode: 'onChange' });
  const values = useWatch({ control: form.control }) as PlanValues;
  const { isDirty, isValid, errors } = form.formState;
  const [step, setStep] = useState(() => Number.isInteger(initialStep) && initialStep >= 0 && initialStep < planStepLabels.length ? initialStep : 0);
  const [baseline, setBaseline] = useState(plan);
  const [latest, setLatest] = useState<PlanDetail>();
  const [preview, setPreview] = useState<PreviewSnapshot>();
  const [previewPending, setPreviewPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [focusTarget, setFocusTarget] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const lastDraft = useRef(JSON.stringify(form.getValues()));
  const previewFlight = useRef<{ controller: AbortController; generation: number } | null>(null);
  const allowed = !readBlocked && !writeBlocked && (!plan || plan.available_actions.includes('UPDATE') || plan.available_actions.includes('CREATE_REVISION')) && (!baseline || baseline.available_actions.includes('UPDATE') || baseline.available_actions.includes('CREATE_REVISION'));
  const allowedRef = useRef(allowed);
  useLayoutEffect(() => { allowedRef.current = allowed; }, [allowed]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = form.subscribe({ formState: { values: true }, callback: ({ values: draft }) => {
      const snapshot = JSON.stringify(draft);
      if (snapshot === lastDraft.current) return;
      lastDraft.current = snapshot;
      generation.current += 1;
      previewFlight.current?.controller.abort();
      previewFlight.current = null;
      setPreview(undefined); setPreviewPending(false); setSavedMessage('');
    } });
    return () => { mounted.current = false; previewFlight.current?.controller.abort(); unsubscribe(); };
  }, [form]);
  useEffect(() => {
    const target = focusTarget || 'plan-step-heading';
    document.getElementById(target)?.focus();
  }, [step, focusTarget]);
  function goToField(field: string, resourceId?: string | null) {
    const root = field.split('.')[0] ?? field;
    const target = `plan-${root}${resourceId ? `-${resourceId}` : ''}`;
    setStep(planFieldStep(root));
    setFocusTarget(target);
    document.getElementById(target)?.focus();
  }
  function fix(targetStep: number, resourceId?: string | null) {
    const field = targetStep === 1 ? 'subjects' : targetStep === 2 ? 'prompt_variant_ids' : targetStep === 3 ? 'collection_profile_ids' : 'budget_limit';
    goToField(field, targetStep === 4 ? null : resourceId);
  }
  function move(target: number) { setFocusTarget(''); setStep(target); }
  function invalid(fields: FieldErrors<PlanValues>) {
    const first = formIssues(fields)[0];
    if (first) goToField(first.field);
  }
  function recordFailure(failure: unknown) {
    setError(failure);
    if (!(failure instanceof PlanRequestError)) return;
    if (failure.status === 403 || failure.status === 404) setWriteBlocked(true);
    if (failure.status === 409) setConflict(true);
    if (failure.status !== 422 || !failure.detail) return;
    const details = failure.detail.details.errors;
    if (!Array.isArray(details)) return;
    for (const issue of details) {
      if (!issue || typeof issue !== 'object' || !('loc' in issue) || !Array.isArray(issue.loc) || !('msg' in issue) || typeof issue.msg !== 'string') continue;
      const path = issue.loc[0] === 'body' ? issue.loc.slice(1) : issue.loc;
      const root = path[0];
      if (typeof root !== 'string' || !stepFields.flat().includes(root as keyof PlanValues) || !path.every((part: unknown) => typeof part === 'string' || typeof part === 'number')) continue;
      form.setError(path.join('.') as Path<PlanValues>, { type: 'server', message: issue.msg });
    }
  }
  const previewMutation = useMutation({ retry: false, mutationFn: async ({ draft, continuation, flight }: { draft: PlanValues; continuation: PrincipalContinuation; flight: NonNullable<typeof previewFlight.current> }) => {
    continuation.assertCurrent();
    if (!mounted.current || !allowedRef.current || flight.generation !== generation.current) throw new Error('当前草稿或权限已变化，请重新预览');
    const result = await previewPlan(planCreate(draft), csrfToken, flight.controller.signal);
    continuation.assertCurrent();
    return result;
  } });
  async function runPreview(draft: PlanValues) {
    if (inFlight.current || previewFlight.current || !allowedRef.current || !csrfToken) return;
    const flight = { controller: new AbortController(), generation: generation.current };
    const snapshot = JSON.stringify(draft);
    previewFlight.current = flight; setPreviewPending(true); setError(undefined);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      continuation.assertCurrent();
      const result = await previewMutation.mutateAsync({ draft, continuation, flight });
      if (!continuation.isCurrent() || !mounted.current || previewFlight.current !== flight || generation.current !== flight.generation || JSON.stringify(form.getValues()) !== snapshot) return;
      setPreview({ generation: flight.generation, snapshot, result });
      if (!baseline) setConflict(false);
    } catch (failure) {
      if ((!continuation || continuation.isCurrent()) && mounted.current && previewFlight.current === flight && generation.current === flight.generation) recordFailure(failure);
    } finally {
      if (previewFlight.current === flight) {
        previewFlight.current = null;
        if ((!continuation || continuation.isCurrent()) && mounted.current) setPreviewPending(false);
      }
    }
  }
  const saveMutation = useMutation({ retry: false, mutationFn: async ({ draft, continuation, previewGeneration, revision }: { draft: PlanValues; continuation: PrincipalContinuation; previewGeneration: number; revision?: number }) => {
    continuation.assertCurrent();
    if (!mounted.current || !allowedRef.current || generation.current !== previewGeneration) throw new Error('当前草稿或权限已变化，请重新预览');
    const result = baseline ? await updatePlan(baseline.id, planUpdate(draft, revision!), csrfToken) : await createPlan(planCreate(draft), csrfToken);
    continuation.assertCurrent();
    return result;
  } });
  const currentPreview = preview && preview.snapshot === JSON.stringify(values) ? preview : undefined;
  const busy = saveMutation.isPending || refreshing || previewPending;
  async function save(draft: PlanValues) {
    if (inFlight.current || conflict || !allowedRef.current || !preview || preview.generation !== generation.current || preview.snapshot !== JSON.stringify(draft)) return;
    inFlight.current = true; setError(undefined);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      continuation.assertCurrent();
      const canonical = await saveMutation.mutateAsync({ draft, continuation, previewGeneration: preview.generation, revision: baseline?.revision });
      if (!continuation.isCurrent() || !mounted.current) return;
      await Promise.all([client.cancelQueries({ queryKey: planKeys.lists() }), client.cancelQueries({ queryKey: planKeys.detail(canonical.id) })]);
      if (!continuation.isCurrent() || !mounted.current) return;
      client.setQueryData(planKeys.detail(canonical.id), canonical);
      generation.current += 1; setPreview(undefined);
      setBaseline(canonical); form.reset(planValues(canonical));
      setSavedMessage(`已保存 · Revision ${canonical.revision}`);
      onSaved(canonical);
    } catch (failure) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) recordFailure(failure);
    } finally { inFlight.current = false; }
  }
  async function reload() {
    if (!onReload || inFlight.current || refreshing || previewFlight.current) return;
    inFlight.current = true; setRefreshing(true);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      continuation.assertCurrent();
      const canonical = await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      // 只采用 CAS 基线；完整服务端配置单独展示供核对，任何本地输入都不合并或重置。
      setBaseline(canonical); setLatest(canonical); setConflict(false); setError(undefined); setPreview(undefined);
      generation.current += 1; form.clearErrors();
    } catch (failure) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) recordFailure(failure);
    } finally {
      inFlight.current = false;
      if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false);
    }
  }
  async function next() {
    if (inFlight.current || !mounted.current) return;
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const valid = await form.trigger(stepFields[step]);
      if (!continuation.isCurrent() || !mounted.current) return;
      if (valid) move(step + 1); else invalid(form.formState.errors);
    } catch (failure) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) recordFailure(failure);
    }
  }
  const issues = formIssues(errors);
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next: destination }) => shouldBlockPlanNavigation(current, destination)} when={isDirty || busy} />
    <form aria-label={plan ? '编辑监测计划' : '新建监测计划'} className="min-w-0 space-y-4" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (step < 6) void next();
      else void form.handleSubmit(step === 6 ? runPreview : save, invalid)(event);
    }}>
      <nav aria-label="计划向导步骤"><ol className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">{planStepLabels.map((label, index) => <li className="min-w-0" key={label}><Button aria-current={step === index ? 'step' : undefined} className="min-h-11 w-full whitespace-normal px-2 text-left" disabled={saveMutation.isPending || refreshing} onClick={() => move(index)} type="button" variant={step === index ? 'secondary' : 'outline'}>{index + 1}. {label}</Button></li>)}</ol></nav>
      <h2 className="type-section-title" id="plan-step-heading" tabIndex={-1}>{step + 1}. {planStepLabels[step]}</h2>
      {!allowed && <PlanNotice error>当前计划只读或读取权限已变化，已阻止提交。本地草稿保留，请先核对资源或会话权限。</PlanNotice>}
      <fieldset className="min-w-0 space-y-4" disabled={saveMutation.isPending || refreshing || !allowed}>
        <PlanWizardStep disabled={saveMutation.isPending || refreshing || !allowed} step={step} />
        {step === 6 && <><p className="text-sm text-text-secondary">预览当前完整草稿。任何字段或选择变化后都必须重新预览。</p><Button className="min-h-11 sm:min-h-8" disabled={previewPending || !csrfToken} type="submit">{previewPending ? '服务端预览中…' : '预览当前配置'}</Button>{currentPreview ? <PlanPreviewPanel onFix={fix} preview={currentPreview.result} /> : <PlanNotice>当前草稿尚无有效服务端预览。</PlanNotice>}</>}
        {step === 7 && <><PlanConfigurationSummary values={values} />{currentPreview ? <PlanPreviewPanel onFix={fix} preview={currentPreview.result} /> : <PlanNotice>请返回“服务端预览”，预览当前草稿后保存。</PlanNotice>}<PlanNotice>保存仅提交完整配置。新计划保存后为未启用；请在详情明确确认启用。运行阻断不会阻止结构完整的未启用或已暂停计划保存，已启用计划的修改由服务端重新裁决。</PlanNotice></>}
      </fieldset>
      {issues.length > 0 && <section aria-label="请修正以下问题" className="space-y-2 rounded-lg border border-danger/30 p-3" role="alert"><h3 className="font-medium text-danger">请修正以下问题</h3><ul className="space-y-1">{issues.map((issue) => <li key={issue.field}><Button className="h-auto min-h-11 whitespace-normal text-left sm:min-h-8" onClick={() => goToField(issue.field)} type="button" variant="link">{issue.message}</Button></li>)}</ul></section>}
      {Boolean(error) && <PlanNotice error>{planErrorMessage(error)}</PlanNotice>}
      {conflict && <PlanNotice><p>服务端拒绝了当前提交。本地全部输入与预览已保留；不会自动重放。{baseline ? '请显式读取最新计划并核对，再重新预览和保存。' : '请核对或修正配置，重新预览后再手动创建。'}</p>{onReload && <Button disabled={busy} onClick={() => void reload()} type="button" variant="outline">加载最新计划并保留输入</Button>}</PlanNotice>}
      {latest && <section aria-label="最新服务端配置供比较" className="min-w-0 space-y-2 rounded-lg border border-border-default p-3"><h3 className="font-medium">最新服务端配置 · Revision {latest.revision}</h3><PlanConfigurationSummary values={planValues(latest)} /><p className="text-xs text-text-secondary">本地输入保持不变，提交基线已更新。请比较配置并重新预览。</p></section>}
      {baseline && <p className="text-xs text-text-muted">提交基线 Revision {baseline.revision}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted" role="status">{saveMutation.isPending ? '保存中…' : refreshing ? '读取最新配置中…' : previewPending ? '服务端预览中…' : savedMessage || (isDirty ? '有未保存的修改' : '未修改')}</p><div className="flex flex-wrap gap-2"><Button className="min-h-11 sm:min-h-8" disabled={saveMutation.isPending || refreshing} onClick={onCancel} type="button" variant="outline">关闭向导</Button>{step > 0 && <Button className="min-h-11 sm:min-h-8" disabled={saveMutation.isPending || refreshing} onClick={() => move(step - 1)} type="button" variant="outline">上一步</Button>}{step < 7 && <Button className="min-h-11 sm:min-h-8" disabled={saveMutation.isPending || refreshing || (step === 6 && !currentPreview)} onClick={() => step === 6 ? move(7) : void next()} type="button">下一步</Button>}{step === 7 && allowed && <Button className="min-h-11 sm:min-h-8" disabled={busy || conflict || !isValid || !currentPreview || !csrfToken} type="submit">{plan ? '保存计划配置' : '创建监测计划'}</Button>}</div></div>
    </form>
  </FormProvider>;
}
export { PlanWizard };
