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
import { acknowledgeOpportunity, dismissOpportunity, opportunityKeys, OpportunityRequestError } from './opportunities.api';
import { dismissFormSchema, type DismissValues, type LegacyOpportunityAction, type Opportunity, type OpportunityComparisonRead, type OpportunityDetail, type OpportunityList } from './opportunities.model';
import { OpportunityNotice } from './opportunity-controls';

type Command = { action: LegacyOpportunityAction; values?: DismissValues; continuation: PrincipalContinuation; signal: AbortSignal };
export function OpportunityCommands({ opportunityId, opportunity, csrfToken, blocked, intent, onReload, onDenied }: {
  opportunityId: string; opportunity?: Opportunity; csrfToken: string | null; blocked: boolean; intent?: components['schemas']['GeoOpportunityAction']; onReload: () => Promise<Opportunity>; onDenied: (error: OpportunityRequestError) => void;
}) {
  const client = useQueryClient();
  const form = useForm<DismissValues>({ defaultValues: { resolution_code: '', resolution_comment: '' }, resolver: zodResolver(dismissFormSchema), mode: 'onChange' });
  const { isDirty, isValid, isSubmitting, errors } = form.formState;
  const [baseline, setBaseline] = useState(opportunity);
  if (!baseline && opportunity) setBaseline(opportunity);
  const [dismissOpen, setDismissOpen] = useState(intent === 'DISMISS');
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const mounted = useRef(true); const inFlight = useRef(false); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async ({ action, values, continuation, signal }: Command) => {
    await Promise.all([client.cancelQueries({ queryKey: opportunityKeys.details(opportunityId) }), client.cancelQueries({ queryKey: opportunityKeys.comparisons(opportunityId) })]);
    continuation.assertCurrent();
    if (!baseline) throw new Error('机会尚无已读取的提交基线');
    if (action === 'ACKNOWLEDGE') return acknowledgeOpportunity(opportunityId, baseline.revision, csrfToken, signal);
    if (!values) throw new Error('忽略机会缺少完整原因');
    return dismissOpportunity(opportunityId, { ...values, expected_revision: baseline.revision }, csrfToken, signal);
  } });
  const busy = mutation.isPending || refreshing || isSubmitting;
  const denied = error instanceof OpportunityRequestError && (error.status === 401 || error.status === 403 || error.status === 404);
  const disabled = blocked || !opportunity || !baseline || busy || conflict || denied || !csrfToken;
  async function execute(action: Command['action'], values?: DismissValues) {
    if (inFlight.current || disabled || !opportunity?.available_actions.includes(action)) return;
    inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage(''); form.clearErrors();
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ action, values, continuation, signal: controller.current.signal });
      if (!mounted.current || !continuation.isCurrent()) return;
      await Promise.all([client.cancelQueries({ queryKey: opportunityKeys.lists() }), client.cancelQueries({ queryKey: opportunityKeys.details(canonical.id) }), client.cancelQueries({ queryKey: opportunityKeys.comparisons(canonical.id) })]);
      if (!mounted.current || !continuation.isCurrent()) return;
      client.setQueriesData<OpportunityDetail>({ queryKey: opportunityKeys.details(canonical.id) }, (current) => current ? { ...current, opportunity: canonical } : current);
      client.setQueriesData<OpportunityList>({ queryKey: opportunityKeys.lists() }, (current) => current ? { ...current, items: current.items.map((item) => item.id === canonical.id ? canonical : item) } : current);
      client.setQueriesData<OpportunityComparisonRead>({ queryKey: opportunityKeys.comparisons(canonical.id) }, (current) => current ? { ...current, opportunity: canonical, opportunity_revision: canonical.revision } : current);
      setBaseline(canonical); form.reset(); setDismissOpen(false); setMessage(`${action === 'ACKNOWLEDGE' ? '已确认' : '已忽略'}机会（revision ${canonical.revision}）。历史证据继续保留。`);
      void client.invalidateQueries({ queryKey: opportunityKeys.root() });
    } catch (failure) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setError(failure);
      if (failure instanceof OpportunityRequestError && [401, 403, 404].includes(failure.status ?? 0)) onDenied(failure);
      setConflict(failure instanceof OpportunityRequestError && failure.status === 409);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const issues = failure.detail?.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (issue && typeof issue === 'object' && 'loc' in issue && 'msg' in issue && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && (issue.loc[1] === 'resolution_code' || issue.loc[1] === 'resolution_comment') && typeof issue.msg === 'string') form.setError(issue.loc[1], { message: issue.msg });
        }
      }
    } finally { inFlight.current = false; controller.current = null; if (mounted.current) mutation.reset(); }
  }
  async function reload() {
    if (refreshing || inFlight.current) return;
    let continuation: PrincipalContinuation | undefined;
    setRefreshing(true);
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await onReload();
      if (!mounted.current || !continuation.isCurrent()) return;
      // 被动 query 更新不更换编辑基线；409 只能由显式读取的新修订号解冻。
      if (conflict && baseline && canonical.revision <= baseline.revision) { setError(new Error('服务端修订号尚未更新，提交仍暂停。请核对后重新读取。')); return; }
      setBaseline(canonical); setConflict(false); setError(undefined); form.clearErrors(); setMessage(`已加载 revision ${canonical.revision}，本地原因已保留，请核对后再次提交。`);
    } catch (failure) { if (mounted.current && (!continuation || continuation.isCurrent())) setError(failure); }
    finally { if (mounted.current && (!continuation || continuation.isCurrent())) setRefreshing(false); }
  }
  const summary = Object.entries(errors).flatMap(([name, value]) => value?.message ? [{ id: name, fieldId: `opportunity-${name}`, message: value.message }] : []);
  return <section aria-label="机会处理" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">机会处理</h3>
    <DirtyGuard when={isDirty || busy} shouldBlockNavigation={({ current, next }) => current.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {message && <OpportunityNotice>{message}</OpportunityNotice>}{Boolean(error) && <OpportunityNotice error>{error instanceof Error ? error.message : '机会操作失败'}</OpportunityNotice>}
    {conflict && <OpportunityNotice><p>机会已被其他操作更新。原因草稿已保留，提交暂停；请显式刷新新修订号并重新确认。</p><Button type="button" disabled={busy} variant="outline" onClick={() => void reload()}>加载最新机会并保留原因</Button></OpportunityNotice>}
    {denied && <p role="alert" className="text-sm">当前机会不可操作，请关闭详情并返回列表。</p>}
    {opportunity?.available_actions.length === 0 && <p className="text-sm text-text-secondary">当前机会没有可执行操作，历史证据只读。</p>}
    <div className="flex flex-wrap gap-2">{opportunity?.available_actions.map((action) => {
      switch (action) {
        case 'ACKNOWLEDGE': return <Button key={action} type="button" disabled={disabled} onClick={() => void execute(action)}>确认机会</Button>;
        case 'DISMISS': return <Button key={action} type="button" variant="outline" disabled={disabled} onClick={() => setDismissOpen(true)}>忽略机会</Button>;
        case 'RESOLVE': case 'CONTINUE': return null;
      }
    })}</div>
    {dismissOpen && opportunity?.available_actions.includes('DISMISS') && <FormProvider {...form}><form aria-label="忽略机会原因" className="space-y-3" onSubmit={(event) => void form.handleSubmit((values) => execute('DISMISS', values))(event)}>
      <p className="text-sm text-text-secondary">忽略会关闭此机会并保存原因；首次触发快照和历史来源继续保留。</p>
      <fieldset className="space-y-3" disabled={busy || blocked || denied}>
        <FormField<DismissValues, 'resolution_code'> id="opportunity-resolution_code" name="resolution_code" label="忽略原因代码" description="去除首尾空白后 1–40 个字符。" required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid, 'aria-required': required }) => <Input {...field} id={inputId} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} />} />
        <FormField<DismissValues, 'resolution_comment'> id="opportunity-resolution_comment" name="resolution_comment" label="忽略原因说明" description="去除首尾空白后 1–2000 个字符；历史证据继续保留。" required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid, 'aria-required': required }) => <Textarea {...field} id={inputId} rows={4} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} />} />
      </fieldset><ErrorSummary errors={summary} />
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="destructive" disabled={disabled || !isValid}>确认忽略</Button><Button type="button" disabled={busy} variant="ghost" onClick={() => { form.reset(); setDismissOpen(false); }}>取消忽略</Button></div>
    </form></FormProvider>}
    {opportunity && opportunity.available_actions.length > 0 && baseline && <p className="text-xs text-text-muted">提交基线 revision {baseline.revision}{busy ? ' · 处理中…' : isDirty ? ' · 有未提交的原因' : ''}</p>}
  </section>;
}
