import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import { OpportunityRequestError } from './opportunities.api';
import type { Opportunity, OpportunityDetail } from './opportunities.model';
import { businessErrorMessage, businessFailureKind, businessRequest, opportunityFactRevisionFormSchema, type BusinessRequest, type FactRevisionCommand, type OpportunityFactRevisionValues } from './opportunity-business.model';
import { OpportunityNotice, OpportunitySelect } from './opportunity-controls';
import { invalidateFactRevision, opportunityFactRevisionOptions, startOpportunityFactRevision } from './opportunity-fact-revision.api';

const emptyValues: OpportunityFactRevisionValues = { product_id: '' };
export function OpportunityFactRevision({ opportunityId, detail, blocked, csrfToken, onReload, onDenied }: {
  opportunityId: string; detail?: OpportunityDetail; blocked: boolean; csrfToken: string | null;
  onReload: () => Promise<Opportunity>; onDenied: (error: OpportunityRequestError) => void;
}) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false); const [baseline, setBaseline] = useState<Opportunity>();
  const [held, setHeld] = useState(false); const [unknown, setUnknown] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(); const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<components['schemas']['GeoOpportunityActionResult']>();
  const request = useRef<BusinessRequest<FactRevisionCommand> | undefined>(undefined);
  const mounted = useRef(true); const inFlight = useRef(false); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const current = () => mounted.current && owner.isCurrent();
  const form = useForm<OpportunityFactRevisionValues>({ defaultValues: emptyValues, resolver: zodResolver(opportunityFactRevisionFormSchema), mode: 'onChange' });
  const productId = useWatch({ control: form.control, name: 'product_id' });
  const offered = detail?.available_action_types.includes('FACT_REVISION') === true;
  const options = useQuery(opportunityFactRevisionOptions(opportunityId, open && offered && owner.isCurrent()));
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async (command: BusinessRequest<FactRevisionCommand>) => {
    owner.assertCurrent();
    if (!controller.current) throw new Error('事实修订请求缺少取消边界');
    return startOpportunityFactRevision(opportunityId, command, csrfToken, controller.current.signal);
  } });
  const busy = mutation.isPending || refreshing || form.formState.isSubmitting;
  const denied = businessFailureKind(error) === 'denied' || businessFailureKind(options.error) === 'denied';
  const stale = Boolean(baseline && (detail && baseline.revision !== detail.opportunity.revision || options.data && options.data.opportunity_revision !== baseline.revision));
  const eligible = options.data?.available_action_types.includes('FACT_REVISION') === true;
  const product = options.data?.products.find((item) => item.product_id === productId);
  const unavailable = blocked || !offered || !eligible || !csrfToken || busy || held || denied || stale || !owner.isCurrent();
  useEffect(() => { if (options.error instanceof OpportunityRequestError && businessFailureKind(options.error) === 'denied' && owner.isCurrent()) onDenied(options.error); }, [options.error, onDenied, owner]);

  async function submit(values?: OpportunityFactRevisionValues) {
    if (inFlight.current || !current() || busy || denied || !csrfToken || (unknown && blocked)) return;
    if (!unknown && (unavailable || options.isFetching || options.error || !baseline || !values || !product)) return;
    const command = unknown ? request.current : baseline && values ? businessRequest<FactRevisionCommand>({ expected_revision: baseline.revision, product_id: values.product_id }, request.current) : undefined;
    if (!command) return;
    request.current = command; inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage('');
    let committed = false;
    try {
      const result = await mutation.mutateAsync(command);
      if (!current()) return;
      committed = true; request.current = undefined; setHeld(false); setUnknown(false); setReceipt(result); setOpen(false); form.reset(form.getValues());
      setMessage(`${result.replayed ? '已确认原事实修订结果' : '已登记事实修订行动'}，请进入产品事实工作区继续编辑、提交与审核。`);
      await invalidateFactRevision(client, opportunityId, command.body.product_id, owner);
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (committed) return;
      const kind = businessFailureKind(failure); setUnknown(kind === 'unknown'); setHeld(kind === 'conflict');
      if (kind === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const issues = failure.detail?.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (issue && typeof issue === 'object' && 'loc' in issue && 'msg' in issue && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && issue.loc[1] === 'product_id' && typeof issue.msg === 'string') form.setError('product_id', { message: issue.msg });
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
      const refreshed = await options.refetch({ throwOnError: true });
      if (!current()) return;
      if (!refreshed.data) throw new OpportunityRequestError('事实修订选项缺少读取结果');
      setBaseline(canonical); setHeld(false); setError(undefined); form.clearErrors();
      if (error instanceof OpportunityRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') request.current = undefined;
      setMessage(`已读取机会 revision ${canonical.revision} 和最新产品范围；原选择已保留，请核对后重新确认。`);
    } catch (failure) { if (current()) { setError(failure); if (businessFailureKind(failure) === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure); } }
    finally { if (current()) setRefreshing(false); }
  }
  if (!owner.isCurrent()) return <p role="alert">认证主体已变化，请重新进入机会详情。</p>;
  if (!offered && !open && !receipt) return null;
  const productError = form.formState.errors.product_id?.message;
  return <section aria-label="从机会发起事实修订" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">事实修订</h3>
    <DirtyGuard when={!receipt && (form.formState.isDirty || busy || unknown)} description={unknown ? '事实修订结果尚未确认，离开会丢失原请求。请先确认原请求结果。' : undefined} shouldBlockNavigation={({ current: location, next }) => location.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {!open && offered && <Button type="button" disabled={blocked || !csrfToken} onClick={() => { setBaseline(detail?.opportunity); setReceipt(undefined); setOpen(true); }}>发起事实修订</Button>}
    {message && <OpportunityNotice>{message}</OpportunityNotice>}
    {receipt && Boolean(error) && <OpportunityNotice error>行动已登记，关联数据刷新失败：{businessErrorMessage(error)}。可进入已确认的工作区核对。</OpportunityNotice>}
    {receipt && <OpportunityNotice><p className="break-all">关联产品：{receipt.action.target_id} · 行动 ID：{receipt.action.id}</p>{receipt.action.target_available === true && receipt.action.navigation_path && <a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={receipt.action.navigation_path}>打开产品事实工作区</a>}{receipt.action.target_available === false && <p>目标产品当前不可用，行动来源仍保留。</p>}</OpportunityNotice>}
    {open && baseline && !denied && <>
      <p className="break-all text-sm">来源机会：{opportunityId} · 提交 revision {baseline.revision}</p>
      <p className="text-sm text-text-secondary">可选产品来自机会保存的历史来源。登记行动后请在原产品事实工作区修订，按原流程提交与审核。</p>
      {(!offered || options.data && !eligible) && <OpportunityNotice>服务端当前未提供事实修订动作；原选择已保留，提交暂停。</OpportunityNotice>}
      {Boolean(error) && <OpportunityNotice error>{businessErrorMessage(error)}</OpportunityNotice>}
      {options.isFetching && <p role="status">正在读取事实修订产品…</p>}
      {options.error && <OpportunityNotice error>{businessErrorMessage(options.error)}{businessFailureKind(options.error) !== 'denied' && <Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void options.refetch()}>重试读取修订产品</Button>}</OpportunityNotice>}
      {(held || stale) && <OpportunityNotice><p>机会或选项已变化，原选择已保留；请显式刷新后重新确认。</p><Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void reload()}>加载最新机会与修订产品</Button></OpportunityNotice>}
      {unknown && <OpportunityNotice><p>登记结果未知，原载荷和幂等键已冻结；不会自动重发。</p><Button type="button" disabled={busy || blocked || !csrfToken} onClick={() => void submit()}>确认原事实修订结果</Button></OpportunityNotice>}
      {options.data && <FormProvider {...form}><form aria-label="机会事实修订表单" className="space-y-3" onSubmit={(event) => void form.handleSubmit((values) => submit(values))(event)}>
        <fieldset disabled={busy || unknown || blocked || held || stale} className="min-w-0 space-y-3">
          <FormField<OpportunityFactRevisionValues, 'product_id'> id="opportunity-fact-product" label="修订产品" name="product_id" required render={({ field, inputId, ...aria }) => <OpportunitySelect id={inputId} label="修订产品" value={field.value} onChange={(value) => form.setValue('product_id', value, { shouldDirty: true, shouldValidate: true })} choices={[{ value: '', label: '请选择产品' }, ...options.data!.products.map((item) => ({ value: item.product_id, label: `${item.brand} · ${item.part_number}` }))]} describedBy={aria['aria-describedby']} invalid={aria['aria-invalid']} />} />
          {!options.data.products.length && <p>当前没有可修订的来源产品，请核对保存来源及产品是否仍处于活动状态。</p>}
        </fieldset>
        {productId && <p className="break-all text-xs text-text-secondary">所选产品：{product ? `${product.brand} · ${product.part_number} · ${productId}` : `${productId}（当前不在可用范围）`}</p>}
        <ErrorSummary errors={productError ? [{ id: 'product_id', fieldId: 'opportunity-fact-product', message: productError }] : []} />
        {!unknown && <Button type="submit" disabled={unavailable || !form.formState.isValid || !product || options.isFetching || Boolean(options.error)}>确认登记事实修订</Button>}
        <Button type="button" variant="ghost" disabled={busy || unknown} onClick={() => { setOpen(false); setError(undefined); setHeld(false); request.current = undefined; form.reset(emptyValues); }}>取消事实修订</Button>
      </form></FormProvider>}
    </>}
  </section>;
}
