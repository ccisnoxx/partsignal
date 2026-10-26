import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import { OpportunityRequestError } from './opportunities.api';
import type { Opportunity, OpportunityDetail } from './opportunities.model';
import { businessErrorMessage, businessFailureKind, businessRequest } from './opportunity-business.model';
import { OpportunityNotice, OpportunitySelect } from './opportunity-controls';
import { invalidatePublicationRepair, publicationRepairOptions, startPublicationRepair } from './opportunity-publication-repair.api';
import { candidateId, emptyRepairValues, repairFormSchema, repairKindLabels, repairModeLabels, type RepairCommand, type RepairMode, type RepairSubmission, type RepairValues } from './opportunity-publication-repair.model';

export function OpportunityPublicationRepair({ opportunityId, detail, blocked, csrfToken, onReload, onDenied }: {
  opportunityId: string; detail?: OpportunityDetail; blocked: boolean; csrfToken: string | null;
  onReload: () => Promise<Opportunity>; onDenied: (error: OpportunityRequestError) => void;
}) {
  const client = useQueryClient(); const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false); const [baseline, setBaseline] = useState<Opportunity>();
  const [page, setPage] = useState(1); const [issueRevision, setIssueRevision] = useState<number>();
  const [held, setHeld] = useState(false); const [unknown, setUnknown] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(); const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<components['schemas']['GeoOpportunityActionResult']>();
  const request = useRef<RepairSubmission | undefined>(undefined);
  const mounted = useRef(true); const inFlight = useRef(false); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const current = () => mounted.current && owner.isCurrent();
  const form = useForm<RepairValues>({ defaultValues: emptyRepairValues, resolver: zodResolver(repairFormSchema), mode: 'onChange' });
  const values = useWatch({ control: form.control }) as RepairValues;
  const offered = detail?.available_action_types.includes('PUBLICATION_REPAIR') === true;
  const options = useQuery(publicationRepairOptions(opportunityId, values.mode, page, values.mode === 'CREATE_REPAIR' && values.target_id ? values.target_id : undefined, open && offered && owner.isCurrent()));
  const candidate = options.data?.candidates.find((item) => candidateId(item) === values.target_id);
  const context = options.data?.repair_context;
  const fact = context?.fact_candidates.find((item) => item.version.id === values.fact_version_id);
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async (submission: RepairSubmission) => {
    owner.assertCurrent();
    if (!controller.current) throw new Error('发布修复请求缺少取消边界');
    return startPublicationRepair(opportunityId, submission, csrfToken, controller.current.signal);
  } });
  const busy = mutation.isPending || refreshing || form.formState.isSubmitting;
  const denied = businessFailureKind(error) === 'denied' || businessFailureKind(options.error) === 'denied';
  const stale = Boolean(baseline && (detail && baseline.revision !== detail.opportunity.revision || options.data && options.data.opportunity_revision !== baseline.revision))
    || (issueRevision !== undefined && ((candidate && candidate.issue_revision !== issueRevision) || (context && context.issue.revision !== issueRevision)));
  const eligible = options.data?.available_action_types.includes('PUBLICATION_REPAIR') === true && candidate?.available === true
    && (values.mode !== 'CREATE_REPAIR' || Boolean(context?.issue.available_actions.includes('CREATE_REPAIR_TASK') && fact));
  const unavailable = blocked || !offered || !eligible || !csrfToken || busy || held || denied || stale || !owner.isCurrent() || options.isFetching || Boolean(options.error);
  useEffect(() => { if (options.error instanceof OpportunityRequestError && businessFailureKind(options.error) === 'denied' && owner.isCurrent()) onDenied(options.error); }, [options.error, onDenied, owner]);

  function clearTarget() {
    form.setValue('target_id', '', { shouldDirty: true, shouldValidate: true });
    form.setValue('fact_version_id', '', { shouldDirty: true, shouldValidate: true }); setIssueRevision(undefined);
  }
  async function submit(input?: RepairValues) {
    if (inFlight.current || !current() || busy || denied || !csrfToken || (unknown && blocked)) return;
    let submission = request.current;
    if (!unknown) {
      if (unavailable || !baseline || !input || !candidate) return;
      let body: RepairCommand;
      if (input.mode === 'OPEN_ISSUE') body = { mode: input.mode, expected_revision: baseline.revision, published_article_id: candidate.published_article_id, kind: input.kind, description: input.description.trim() };
      else {
        if (issueRevision === undefined || !candidate.published_content_issue_id) return;
        const shared = { expected_revision: baseline.revision, published_content_issue_id: candidate.published_content_issue_id, expected_issue_revision: issueRevision };
        body = input.mode === 'LINK_ISSUE' ? { mode: input.mode, ...shared } : { mode: input.mode, ...shared, fact_version_id: input.fact_version_id };
      }
      submission = { command: businessRequest(body, request.current?.command), articleId: candidate.published_article_id };
    }
    if (!submission) return;
    request.current = submission; inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage('');
    let committed = false;
    try {
      const result = await mutation.mutateAsync(submission);
      if (!current()) return;
      committed = true; request.current = undefined; setUnknown(false); setHeld(false); setReceipt(result); setOpen(false); form.reset(form.getValues());
      setMessage(`${result.replayed ? '已确认原发布修复结果' : '已登记发布修复行动'}。请进入目标工作区继续处理；问题不会自动解决，内容不会自动批准或发布。`);
      await invalidatePublicationRepair(client, opportunityId, owner);
    } catch (failure) {
      if (!current()) return;
      setError(failure); if (committed) return;
      const kind = businessFailureKind(failure); setUnknown(kind === 'unknown'); setHeld(kind === 'conflict');
      if (kind === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const errors = failure.detail?.details.errors;
        if (Array.isArray(errors)) for (const item of errors) {
          if (!item || typeof item !== 'object' || !('loc' in item) || !('msg' in item) || !Array.isArray(item.loc) || typeof item.msg !== 'string') continue;
          const key = item.loc.at(-1); const field = key === 'published_article_id' || key === 'published_content_issue_id' ? 'target_id' : key === 'description' || key === 'kind' || key === 'fact_version_id' ? key : undefined;
          if (field) form.setError(field, { message: item.msg });
        }
      }
    } finally { inFlight.current = false; controller.current = null; if (current()) mutation.reset(); }
  }
  async function reload() {
    if (inFlight.current || busy || unknown || !current()) return;
    setRefreshing(true); setMessage('');
    try {
      const canonical = await onReload(); if (!current()) return;
      const fresh = await options.refetch({ throwOnError: true }); if (!current()) return;
      if (!fresh.data) throw new OpportunityRequestError('发布修复选项缺少读取结果');
      const selected = fresh.data.candidates.find((item) => candidateId(item) === form.getValues('target_id'));
      setIssueRevision(fresh.data.repair_context?.issue.revision ?? selected?.issue_revision ?? undefined);
      setBaseline(canonical); setHeld(false); setError(undefined); form.clearErrors();
      if (error instanceof OpportunityRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') request.current = undefined;
      setMessage(`已刷新机会 revision ${canonical.revision}、问题修订号及候选；原输入保留，请核对后重新确认。`);
    } catch (failure) { if (current()) { setError(failure); if (businessFailureKind(failure) === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure); } }
    finally { if (current()) setRefreshing(false); }
  }
  if (!owner.isCurrent()) return <p role="alert">认证主体已变化，请重新进入机会详情。</p>;
  if (!offered && !open && !receipt) return null;
  const errors = Object.entries(form.formState.errors).flatMap(([name, item]) => item?.message ? [{ id: name, fieldId: `opportunity-repair-${name}`, message: item.message }] : []);
  return <section aria-label="从机会处理发布问题" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">发布问题与修复</h3>
    <DirtyGuard when={!receipt && (form.formState.isDirty || busy || unknown)} description={unknown ? '发布修复结果尚未确认，请先使用原请求核对结果。' : undefined} shouldBlockNavigation={({ current: location, next }) => location.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {!open && offered && <Button type="button" disabled={blocked || !csrfToken} onClick={() => { form.reset(emptyRepairValues); setPage(1); setIssueRevision(undefined); setBaseline(detail?.opportunity); setReceipt(undefined); setError(undefined); setMessage(''); setOpen(true); }}>处理发布问题</Button>}
    {message && <OpportunityNotice>{message}</OpportunityNotice>}
    {receipt && Boolean(error) && <OpportunityNotice error>行动已登记，关联数据刷新失败：{businessErrorMessage(error)}。可进入已确认的目标工作区核对。</OpportunityNotice>}
    {receipt && <OpportunityNotice><p className="break-all">行动 ID：{receipt.action.id} · 目标：{receipt.action.target_id}</p>{receipt.action.target_available === true && receipt.action.navigation_path && <a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={receipt.action.navigation_path}>{receipt.action.target_type === 'ContentTask' ? '打开修复内容任务' : '打开发布问题工作区'}</a>}{receipt.action.target_available === false && <p>目标当前不可用，行动来源仍保留。</p>}</OpportunityNotice>}
    {open && baseline && !denied && <FormProvider {...form}><form aria-label="机会发布修复表单" className="min-w-0 space-y-3" onSubmit={(event) => void form.handleSubmit((input) => submit(input))(event)}>
      <p className="break-all text-sm">来源机会：{opportunityId} · 提交 revision {baseline.revision}</p>
      <p className="text-sm text-text-secondary">候选限定在机会保存的自有产品来源。登记或关联问题不等于修复，创建修复任务也不会解决问题。</p>
      {(!offered || options.data && !options.data.available_action_types.includes('PUBLICATION_REPAIR')) && <OpportunityNotice>服务端当前未提供发布修复动作，原输入保留，提交暂停。</OpportunityNotice>}
      {Boolean(error) && <OpportunityNotice error>{businessErrorMessage(error)}</OpportunityNotice>}
      {options.isFetching && <p role="status">正在读取发布修复候选与上下文…</p>}
      {options.error && <OpportunityNotice error>{businessErrorMessage(options.error)}{businessFailureKind(options.error) !== 'denied' && <Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void options.refetch()}>重试读取发布修复选项</Button>}</OpportunityNotice>}
      {(held || stale) && <OpportunityNotice><p>机会、问题或修复上下文已变化，原输入保留；请显式刷新后重新确认。</p><Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void reload()}>加载最新机会与发布修复选项</Button></OpportunityNotice>}
      {unknown && <OpportunityNotice><p>登记结果未知，原载荷和幂等键已冻结；不会自动重发。</p><Button type="button" disabled={busy || blocked || !csrfToken} onClick={() => void submit()}>确认原发布修复结果</Button></OpportunityNotice>}
      <fieldset disabled={busy || unknown || blocked || held || Boolean(stale) || options.isFetching} className="min-w-0 space-y-3">
        <RepairSelect name="mode" label="处理方式" choices={Object.entries(repairModeLabels).map(([value, label]) => ({ value, label }))} onChange={(mode) => { form.setValue('mode', mode as RepairMode, { shouldDirty: true, shouldValidate: true }); clearTarget(); setPage(1); }} />
        {options.data && <>
          <RepairSelect name="target_id" label={values.mode === 'OPEN_ISSUE' ? '发布成果' : '开放发布问题'} choices={[{ value: '', label: '请选择目标' }, ...options.data.candidates.map((item) => ({ value: candidateId(item), label: `${item.actual_title} · ${item.platform_profile_name} · ${candidateId(item)}${item.available ? '' : '（当前不可操作）'}` }))]} onChange={(id) => { const selected = options.data!.candidates.find((item) => candidateId(item) === id); form.setValue('target_id', id, { shouldDirty: true, shouldValidate: true }); form.setValue('fact_version_id', '', { shouldDirty: true, shouldValidate: true }); setIssueRevision(selected?.issue_revision ?? undefined); }} />
          {!options.data.candidates.length && <p>当前候选页为空；没有可用目标时请先在发布工作区处理相应成果或问题。</p>}
          <div aria-label="发布修复候选分页" className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={page <= 1} onClick={() => { clearTarget(); setPage(page - 1); }}>上一页候选</Button><span className="text-sm">第 {page} 页 · 共 {options.data.total} 项</span><Button type="button" variant="outline" disabled={page * options.data.page_size >= options.data.total} onClick={() => { clearTarget(); setPage(page + 1); }}>下一页候选</Button></div>
        </>}
        {values.mode === 'OPEN_ISSUE' && <><RepairSelect name="kind" label="发布问题类型" choices={Object.entries(repairKindLabels).map(([value, label]) => ({ value, label }))} /><FormField<RepairValues, 'description'> name="description" id="opportunity-repair-description" label="发布问题描述" required render={({ field, inputId, ...aria }) => <Textarea {...field} id={inputId} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} rows={3} />} /></>}
        {values.mode === 'CREATE_REPAIR' && context && <>
          <p className="break-all text-sm">修复产品：{context.product.brand} · {context.product.part_number} · {context.product.id}<br />继承平台：{context.platform_profile_name} · 原事实 v{context.original_fact_version.version}</p>
          <RepairSelect name="fact_version_id" label="修复已批准事实版本" choices={[{ value: '', label: '请选择事实版本' }, ...context.fact_candidates.map(({ version }) => ({ value: version.id, label: `事实 v${version.version} · ${version.classification} · ${version.id}` }))]} />
          {!context.fact_candidates.length && <p>当前没有同产品已批准事实版本，请先在产品事实工作区完成批准。</p>}
        </>}
      </fieldset>
      {candidate && <div className="break-all text-xs text-text-secondary"><p>发布成果：{candidate.published_article_id} · {candidate.final_url}</p>{candidate.published_content_issue_id && <p>问题：{candidate.published_content_issue_id} · 提交问题 revision {issueRevision}</p>}{!candidate.available && <p>{candidate.unavailable_reason}</p>}</div>}
      <ErrorSummary errors={errors} />
      {!unknown && <Button type="submit" disabled={Boolean(unavailable) || !form.formState.isValid}>确认{repairModeLabels[values.mode]}</Button>}
      <Button type="button" variant="ghost" disabled={busy || unknown} onClick={() => { setOpen(false); setError(undefined); setHeld(false); request.current = undefined; form.reset(emptyRepairValues); }}>取消发布修复</Button>
    </form></FormProvider>}
  </section>;
}
function RepairSelect({ name, label, choices, onChange }: { name: keyof RepairValues; label: string; choices: { value: string; label: string }[]; onChange?: (value: string) => void }) {
  return <FormField<RepairValues, keyof RepairValues> name={name} id={`opportunity-repair-${name}`} label={label} required render={({ field, inputId, ...aria }) => <OpportunitySelect id={inputId} label={label} value={field.value} onChange={onChange ?? field.onChange} choices={choices} describedBy={aria['aria-describedby']} invalid={aria['aria-invalid']} required={aria['aria-required']} />} />;
}
