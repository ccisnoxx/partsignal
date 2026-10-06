import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import type { Comparison } from './comparison.model';
import { continueOpportunity, opportunityKeys, OpportunityRequestError, resolveOpportunity } from './opportunities.api';
import { decisionFormSchema, type DecisionValues, type Opportunity, type OpportunityComparisonRead, type OpportunityDetail, type OpportunityList } from './opportunities.model';
import { OpportunityNotice } from './opportunity-controls';

type DecisionKind = components['schemas']['GeoOpportunityDecisionKind'];
type Selection = { kind: DecisionKind; evidence?: Comparison };
type Reloaded = { opportunity: Opportunity; comparisonRead?: OpportunityComparisonRead };
type Command = { selection: Selection; values: DecisionValues; revision: number; continuation: PrincipalContinuation; signal: AbortSignal };

export function OpportunityDecisions({ opportunityId, opportunity, comparisonRead, comparisonBlocked, blocked, csrfToken, intent, onReload, onDenied }: {
  opportunityId: string; opportunity?: Opportunity; comparisonRead?: OpportunityComparisonRead; comparisonBlocked: boolean; blocked: boolean;
  csrfToken: string | null; intent?: components['schemas']['GeoOpportunityAction']; onReload: (withComparison: boolean) => Promise<Reloaded>; onDenied: (error: OpportunityRequestError) => void;
}) {
  const client = useQueryClient();
  const form = useForm<DecisionValues>({ defaultValues: { resolution_code: '', resolution_comment: '' }, resolver: zodResolver(decisionFormSchema), mode: 'onChange' });
  const { isDirty, isValid, isSubmitting, errors } = form.formState;
  const canonical = comparisonBlocked ? opportunity : comparisonRead?.opportunity ?? opportunity;
  const [baseline, setBaseline] = useState(canonical);
  if (!baseline && canonical) setBaseline(canonical);
  const [selection, setSelection] = useState<Selection | undefined>(intent === 'CONTINUE' ? { kind: 'CONTINUE' } : undefined);
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const mounted = useRef(true); const inFlight = useRef(false); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async ({ selection: chosen, values, revision, continuation, signal }: Command) => {
    await Promise.all([client.cancelQueries({ queryKey: opportunityKeys.details(opportunityId) }), client.cancelQueries({ queryKey: opportunityKeys.comparisons(opportunityId) })]);
    continuation.assertCurrent();
    const body = { ...values, expected_revision: revision };
    switch (chosen.kind) {
      case 'MANUAL_RESOLVE': return resolveOpportunity(opportunityId, { ...body, resolution_method: 'MANUAL' }, csrfToken, signal);
      case 'RETEST_RESOLVE':
        if (!chosen.evidence) throw new Error('复测恢复确认缺少已读取的比较证据');
        return resolveOpportunity(opportunityId, { ...body, resolution_method: 'RETEST', retest_batch_id: chosen.evidence.retest_batch_id, comparison_fingerprint: chosen.evidence.fingerprint }, csrfToken, signal);
      case 'CONTINUE': return continueOpportunity(opportunityId, { ...body, ...(chosen.evidence ? { retest_batch_id: chosen.evidence.retest_batch_id, comparison_fingerprint: chosen.evidence.fingerprint } : {}) }, csrfToken, signal);
    }
  } });
  const busy = mutation.isPending || refreshing || isSubmitting;
  const denied = error instanceof OpportunityRequestError && [401, 403, 404].includes(error.status ?? 0);
  const disabled = blocked || !canonical || !baseline || busy || conflict || denied || !csrfToken;
  const currentComparison = comparisonRead?.comparison;
  const evidenceReady = !comparisonBlocked && currentComparison?.comparable === true && currentComparison.recovery.status === 'RECOVERED' && comparisonRead?.opportunity_revision === baseline?.revision;
  const staleEvidence = Boolean(selection?.evidence && (comparisonBlocked || currentComparison?.fingerprint !== selection.evidence.fingerprint || comparisonRead?.opportunity_revision !== baseline?.revision));
  const permitted = selection && canonical?.available_actions.includes(selection.kind === 'CONTINUE' ? 'CONTINUE' : 'RESOLVE');
  const canSubmit = !disabled && isValid && permitted && !staleEvidence && (selection?.kind !== 'RETEST_RESOLVE' || evidenceReady);

  function choose(kind: DecisionKind) {
    if (disabled || !canonical?.available_actions.includes(kind === 'CONTINUE' ? 'CONTINUE' : 'RESOLVE') || (kind === 'RETEST_RESOLVE' && !evidenceReady)) return;
    const evidence = kind !== 'MANUAL_RESOLVE' && !comparisonBlocked && comparisonRead?.opportunity_revision === baseline?.revision ? currentComparison ?? undefined : undefined;
    setSelection({ kind, evidence }); setMessage(''); setError(undefined);
  }
  async function execute(values: DecisionValues) {
    if (inFlight.current || !canSubmit || !selection || !baseline) return;
    inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage(''); form.clearErrors();
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const result = await mutation.mutateAsync({ selection, values, revision: baseline.revision, continuation, signal: controller.current.signal });
      if (!mounted.current || !continuation.isCurrent()) return;
      await Promise.all([client.cancelQueries({ queryKey: opportunityKeys.lists() }), client.cancelQueries({ queryKey: opportunityKeys.details(opportunityId) }), client.cancelQueries({ queryKey: opportunityKeys.comparisons(opportunityId) })]);
      if (!mounted.current || !continuation.isCurrent()) return;
      client.setQueriesData<OpportunityDetail>({ queryKey: opportunityKeys.details(opportunityId) }, (current) => current ? { ...current, opportunity: result.opportunity } : current);
      client.setQueriesData<OpportunityList>({ queryKey: opportunityKeys.lists() }, (current) => current ? { ...current, items: current.items.map((item) => item.id === opportunityId ? result.opportunity : item) } : current);
      client.setQueriesData<OpportunityComparisonRead>({ queryKey: opportunityKeys.comparisons(opportunityId) }, (current) => current ? { ...current, opportunity: result.opportunity, opportunity_revision: result.opportunity.revision, decisions: [...current.decisions.filter((decision) => decision.id !== result.decision.id), result.decision] } : current);
      setBaseline(result.opportunity); form.reset(); setSelection(undefined); setConflict(false);
      setMessage(result.decision.decision === 'CONTINUE' ? `已记录继续跟进依据，机会保持处理中（revision ${result.opportunity.revision}）。` : `已显式解决机会（revision ${result.opportunity.revision}）。历史证据与处理依据继续保留。`);
      void client.invalidateQueries({ queryKey: opportunityKeys.root() });
    } catch (failure) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setError(failure); setConflict(failure instanceof OpportunityRequestError && failure.status === 409);
      if (failure instanceof OpportunityRequestError && [401, 403, 404].includes(failure.status ?? 0)) onDenied(failure);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const issues = failure.detail?.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (issue && typeof issue === 'object' && 'loc' in issue && 'msg' in issue && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && (issue.loc[1] === 'resolution_code' || issue.loc[1] === 'resolution_comment') && typeof issue.msg === 'string') form.setError(issue.loc[1], { message: issue.msg });
        }
      }
    } finally { inFlight.current = false; controller.current = null; if (mounted.current) mutation.reset(); }
  }
  async function reload() {
    if (inFlight.current || refreshing) return;
    setRefreshing(true); let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const result = await onReload(Boolean(selection?.evidence) || selection?.kind === 'RETEST_RESOLVE');
      if (!mounted.current || !continuation.isCurrent()) return;
      // 比较证据可在机会 revision 不变时漂移，显式重读同时更新 CAS 与证据基线。
      setBaseline(result.opportunity);
      if (selection) setSelection({ kind: selection.kind, evidence: selection.evidence || selection.kind === 'RETEST_RESOLVE' ? result.comparisonRead?.comparison ?? undefined : undefined });
      setConflict(false); setError(undefined); form.clearErrors(); setMessage(`已重新读取 revision ${result.opportunity.revision}，处理依据草稿已保留，请核对后再次确认。`);
    } catch (failure) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setError(failure); if (failure instanceof OpportunityRequestError && [401, 403, 404].includes(failure.status ?? 0)) onDenied(failure);
    } finally { if (mounted.current && (!continuation || continuation.isCurrent())) setRefreshing(false); }
  }
  const summary = Object.entries(errors).flatMap(([name, value]) => value?.message ? [{ id: name, fieldId: `opportunity-decision-${name}`, message: value.message }] : []);
  const confirmation = selection?.kind === 'MANUAL_RESOLVE' ? '确认人工解决' : selection?.kind === 'RETEST_RESOLVE' ? '确认复测恢复并解决' : '确认继续跟进';
  return <section aria-label="解决或继续跟进" className="min-w-0 space-y-3 border-t border-border-subtle pt-4"><h3 className="type-section-title">解决或继续跟进</h3>
    <DirtyGuard when={isDirty || busy} shouldBlockNavigation={({ current, next }) => current.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {message && <OpportunityNotice>{message}</OpportunityNotice>}{Boolean(error) && <OpportunityNotice error>{error instanceof Error ? error.message : '处理机会失败'}</OpportunityNotice>}
    {conflict && <OpportunityNotice>机会或比较证据已变化。处理依据草稿已保留，提交暂停；请重新读取后再次确认，不会自动重发。</OpportunityNotice>}
    {(conflict || staleEvidence || (baseline && canonical && baseline.revision !== canonical.revision)) && <Button type="button" variant="outline" disabled={busy || denied} onClick={() => void reload()}>加载最新机会并保留处理依据</Button>}
    {staleEvidence && <p className="text-sm text-text-secondary">当前比较与选定的提交证据不一致；旧比较不能用于确认，请显式重新读取。</p>}
    <div className="flex flex-wrap gap-2">{canonical?.available_actions.includes('RESOLVE') && <><Button type="button" variant="outline" disabled={disabled} onClick={() => choose('MANUAL_RESOLVE')}>人工解决</Button><Button type="button" variant="outline" disabled={disabled || !evidenceReady} onClick={() => choose('RETEST_RESOLVE')}>复测恢复确认</Button></>}{canonical?.available_actions.includes('CONTINUE') && <Button type="button" variant="outline" disabled={disabled} onClick={() => choose('CONTINUE')}>继续跟进</Button>}</div>
    {canonical?.available_actions.includes('RESOLVE') && !evidenceReady && <p className="text-sm text-text-secondary">复测确认仅在服务器判定结果可比、达到冻结恢复条件且比较与提交修订一致后可用。人工解决可独立填写依据。</p>}
    {selection && !denied && canonical && <FormProvider {...form}><form aria-label="机会处理依据" className="space-y-3" onSubmit={(event) => void form.handleSubmit(execute)(event)}><p className="text-sm text-text-secondary">{selection.kind === 'CONTINUE' ? '继续跟进将保留处理中状态，并追加不可变处理依据。' : selection.kind === 'MANUAL_RESOLVE' ? '人工解决将关闭机会并保存人工依据；不声明复测恢复或因果关系。' : '确认所选复测达到冻结恢复条件后解决机会；单次变化不证明因果关系。'}</p>{selection.evidence && <p className="break-all text-xs">提交复测 {selection.evidence.retest_batch_id} · 比较指纹 {selection.evidence.fingerprint}</p>}<fieldset className="space-y-3" disabled={busy || blocked}>
      <FormField<DecisionValues, 'resolution_code'> id="opportunity-decision-resolution_code" name="resolution_code" label="处理原因代码" description="去除首尾空白后 1–40 个字符。" required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid, 'aria-required': required }) => <Input {...field} id={inputId} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} />} />
      <FormField<DecisionValues, 'resolution_comment'> id="opportunity-decision-resolution_comment" name="resolution_comment" label="处理原因说明" description="去除首尾空白后 1–2000 个字符，说明本次处理依据。" required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid, 'aria-required': required }) => <Textarea {...field} id={inputId} rows={4} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} />} />
    </fieldset><ErrorSummary errors={summary} /><div className="flex flex-wrap gap-2"><Button type="submit" disabled={!canSubmit}>{confirmation}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { form.reset(); setSelection(undefined); }}>取消处理</Button></div></form></FormProvider>}
    {baseline && canonical && <p className="text-xs text-text-muted">处理提交基线 revision {baseline.revision}{busy ? ' · 处理中…' : isDirty ? ' · 有未提交的处理依据' : ''}</p>}
  </section>;
}
