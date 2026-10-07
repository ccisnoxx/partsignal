import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import type { components } from '@/shared/api/generated/schema';
import { OpportunityRequestError } from './opportunities.api';
import type { Opportunity, OpportunityDetail } from './opportunities.model';
import { createOpportunityContentTask, invalidateOpportunityBusiness, opportunityContentOptions } from './opportunity-business.api';
import { businessErrorMessage, businessFailureKind, businessRequest, opportunityContentFormSchema, type BusinessRequest, type ContentCommand, type OpportunityContentValues } from './opportunity-business.model';
import { OpportunityNotice } from './opportunity-controls';

const emptyValues: OpportunityContentValues = { product_id: '', fact_version_id: '', platform_profile_id: '' };
const classificationLabels = { PUBLIC: '公开', INTERNAL: '内部', RESTRICTED: '受限' } satisfies Record<components['schemas']['Confidentiality'], string>;
export function OpportunityContentTask({ opportunityId, detail, blocked, csrfToken, onReload, onDenied }: {
  opportunityId: string; detail?: OpportunityDetail; blocked: boolean; csrfToken: string | null;
  onReload: () => Promise<Opportunity>; onDenied: (error: OpportunityRequestError) => void;
}) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<Opportunity>();
  const [productSearch, setProductSearch] = useState(''); const [platformSearch, setPlatformSearch] = useState('');
  const [held, setHeld] = useState(false); const [unknown, setUnknown] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(); const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<components['schemas']['GeoOpportunityActionResult']>();
  const request = useRef<BusinessRequest<ContentCommand> | undefined>(undefined);
  const inFlight = useRef(false); const mounted = useRef(true); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const form = useForm<OpportunityContentValues>({ defaultValues: emptyValues, resolver: zodResolver(opportunityContentFormSchema), mode: 'onChange' });
  const values = useWatch({ control: form.control });
  const { isDirty, isValid, isSubmitting, errors } = form.formState;
  const offered = detail?.available_action_types.includes('CONTENT_TASK') === true;
  const options = useQuery(opportunityContentOptions(detail?.opportunity.product_id ?? undefined, open && offered && owner.isCurrent()));
  const mutation = useMutation({ retry: false, gcTime: 0, mutationFn: async (command: BusinessRequest<ContentCommand>) => {
    owner.assertCurrent();
    if (!controller.current) throw new Error('Content Task 请求缺少取消边界');
    return createOpportunityContentTask(opportunityId, command, csrfToken, controller.current.signal);
  } });
  const busy = mutation.isPending || refreshing || isSubmitting;
  const current = () => mounted.current && owner.isCurrent();
  const denied = businessFailureKind(error) === 'denied' || businessFailureKind(options.error) === 'denied';
  const stale = Boolean(baseline && detail && baseline.revision !== detail.opportunity.revision);
  const unavailable = blocked || !offered || !csrfToken || busy || held || denied || stale || !owner.isCurrent();
  const product = options.data?.products.find((item) => item.id === values.product_id);
  const fact = product?.approved_fact_versions.find((item) => item.id === values.fact_version_id);
  const platform = options.data?.platforms.find((item) => item.id === values.platform_profile_id);
  const optionSelectionValid = Boolean(product && fact && platform);
  useEffect(() => { if (options.error instanceof OpportunityRequestError && businessFailureKind(options.error) === 'denied' && owner.isCurrent()) onDenied(options.error); }, [options.error, onDenied, owner]);

  async function submit(input?: OpportunityContentValues) {
    if (inFlight.current || !current() || busy || denied || !csrfToken || (unknown && blocked)) return;
    if (!unknown && (unavailable || options.isFetching || options.error || !baseline || !input || !optionSelectionValid)) return;
    const command = unknown ? request.current : baseline && input ? businessRequest<ContentCommand>({ expected_revision: baseline.revision, ...input }, request.current) : undefined;
    if (!command) return;
    request.current = command; inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage('');
    let committed = false;
    try {
      const result = await mutation.mutateAsync(command);
      if (!current()) return;
      committed = true;
      request.current = undefined; setUnknown(false); setHeld(false); setReceipt(result); form.reset(form.getValues()); setOpen(false);
      setMessage(`${result.replayed ? '已确认原请求结果' : '已创建 Content Task'}，机会 revision ${result.opportunity_revision}；行动完成后仍需显式处理机会。`);
      await invalidateOpportunityBusiness(client, opportunityId, 'content');
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (committed) return;
      const kind = businessFailureKind(failure); setUnknown(kind === 'unknown'); setHeld(kind === 'conflict');
      if (kind === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure);
      if (failure instanceof OpportunityRequestError && failure.status === 422) {
        const issues = failure.detail?.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (issue && typeof issue === 'object' && 'loc' in issue && 'msg' in issue && Array.isArray(issue.loc) && issue.loc.length === 2 && issue.loc[0] === 'body' && ['product_id', 'fact_version_id', 'platform_profile_id'].includes(issue.loc[1]) && typeof issue.msg === 'string') form.setError(issue.loc[1] as keyof OpportunityContentValues, { message: issue.msg });
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
      if (!refreshed.data) throw new OpportunityRequestError('创建选项缺少读取结果');
      setBaseline(canonical); setHeld(false); setError(undefined); form.clearErrors();
      if (error instanceof OpportunityRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') request.current = undefined;
      setMessage(`已读取机会 revision ${canonical.revision} 与最新创建选项，原选择已保留；请核对来源和三项选择后重新确认。`);
    } catch (failure) { if (current()) { setError(failure); if (businessFailureKind(failure) === 'denied' && failure instanceof OpportunityRequestError) onDenied(failure); } }
    finally { if (current()) setRefreshing(false); }
  }
  if (!owner.isCurrent()) return <p role="alert">认证主体已变化，请重新进入机会详情。</p>;
  if (!offered && !open && !receipt) return null;
  const summary = Object.entries(errors).flatMap(([name, value]) => value?.message ? [{ id: name, fieldId: `opportunity-content-${name}`, message: value.message }] : []);
  return <section aria-label="从机会创建 Content Task" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">Content Task 行动</h3>
    <DirtyGuard when={!receipt && (isDirty || busy || unknown)} description={unknown ? '创建结果尚未确认，离开会丢失原载荷和幂等键。请先确认原请求结果。' : undefined} shouldBlockNavigation={({ current: location, next }) => location.pathname !== next.pathname || (next.search as Record<string, unknown>).opportunity_id !== opportunityId} />
    {!open && offered && <Button type="button" disabled={blocked || !csrfToken} onClick={() => { setBaseline(detail?.opportunity); setOpen(true); setReceipt(undefined); }}>创建 Content Task</Button>}
    {message && <OpportunityNotice>{message}</OpportunityNotice>}
    {receipt && Boolean(error) && <OpportunityNotice error>Content Task 已创建，关联列表刷新失败：{businessErrorMessage(error)}。可打开已确认的任务核对。</OpportunityNotice>}
    {receipt && <OpportunityNotice><p className="break-all">目标任务 ID：{receipt.action.target_id} · {receipt.action.status_snapshot}</p>{receipt.action.target_available === true && receipt.action.navigation_path && <a href={receipt.action.navigation_path} className="text-interaction-primary underline underline-offset-4">打开新 Content Task</a>}{receipt.action.target_available === false && <p>目标任务已不可用，行动来源快照仍保留。</p>}</OpportunityNotice>}
    {open && baseline && !denied && <>
      <p className="break-all text-sm">来源 Opportunity：{opportunityId} · 提交 revision {baseline.revision}</p>
      <p className="text-sm text-text-secondary">选择来自服务端创建选项；事实版本均已批准，服务端提交时再次校验。</p>
      {!offered && <OpportunityNotice>服务端当前未提供 Content Task 创建动作；原选择已保留，新提交暂停。</OpportunityNotice>}
      {options.data?.requested_product && options.data.requested_product.eligibility !== 'ELIGIBLE' && <OpportunityNotice>机会关联产品创建资格：{options.data.requested_product.eligibility}。请核对产品事实；页面不会自动改选产品。</OpportunityNotice>}
      {Boolean(error) && <OpportunityNotice error>{businessErrorMessage(error)}</OpportunityNotice>}
      {options.isFetching && <p role="status">正在读取 Content Task 创建选项…</p>}
      {options.error && <OpportunityNotice error>{businessErrorMessage(options.error)}{businessFailureKind(options.error) !== 'denied' && <Button type="button" variant="outline" disabled={busy} onClick={() => void options.refetch()}>重试创建选项</Button>}</OpportunityNotice>}
      {(held || stale) && <OpportunityNotice><p>机会修订号或创建依据已变化，原选择已保留，提交暂停；请显式刷新并重新确认。</p><Button type="button" variant="outline" disabled={busy || unknown} onClick={() => void reload()}>加载最新机会与创建选项</Button></OpportunityNotice>}
      {unknown && <OpportunityNotice><p>创建结果未知。原载荷与幂等键已冻结；可显式使用同一请求确认，不会自动重发。</p><Button type="button" disabled={busy || blocked || !csrfToken} onClick={() => void submit()}>确认原 Content Task 创建结果</Button></OpportunityNotice>}
      {options.data && <FormProvider {...form}><form aria-label="Opportunity Content Task 创建表单" className="space-y-3" onSubmit={(event) => void form.handleSubmit((input) => submit(input))(event)}>
        <fieldset disabled={busy || unknown || blocked || held || stale} className="min-w-0 space-y-3">
          <label className="block space-y-1 text-sm">搜索 Content Task 产品<Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} /></label>
          <BusinessSelect name="product_id" label="Content Task 产品" choices={options.data.products.filter((item) => item.id === values.product_id || `${item.brand} ${item.part_number}`.toLowerCase().includes(productSearch.trim().toLowerCase())).map((item) => ({ value: item.id, label: `${item.brand} · ${item.part_number}` }))} onChange={(value) => { form.setValue('product_id', value, { shouldDirty: true, shouldValidate: true }); form.setValue('fact_version_id', '', { shouldDirty: true, shouldValidate: true }); }} />
          {!options.data.products.length && <p>没有可用产品，请先在产品事实页面批准事实版本。</p>}
          <BusinessSelect name="fact_version_id" label="Content Task 已批准事实版本" choices={product?.approved_fact_versions.map((item) => ({ value: item.id, label: `FactVersion v${item.version} · ${classificationLabels[item.classification]} · ${item.id}` })) ?? []} />
          <label className="block space-y-1 text-sm">搜索 Content Task 平台<Input value={platformSearch} onChange={(event) => setPlatformSearch(event.target.value)} /></label>
          <BusinessSelect name="platform_profile_id" label="Content Task 目标平台" choices={options.data.platforms.filter((item) => item.id === values.platform_profile_id || item.name.toLowerCase().includes(platformSearch.trim().toLowerCase())).map((item) => ({ value: item.id, label: item.name }))} />
          {!options.data.platforms.length && <p>没有活动平台，请先配置可用平台。</p>}
        </fieldset>
        <dl className="space-y-1 break-all text-xs text-text-secondary"><div><dt>产品核对</dt><dd>{product ? `${product.brand} · ${product.part_number} · ${product.id}` : values.product_id ? `所选产品当前不在可用选项中：${values.product_id}` : '尚未选择'}</dd></div><div><dt>FactVersion 核对</dt><dd>{fact ? `v${fact.version} · ${classificationLabels[fact.classification]} · ${fact.id}` : values.fact_version_id ? `所选事实版本当前不可用：${values.fact_version_id}` : '尚未选择'}</dd></div><div><dt>PlatformProfile 核对</dt><dd>{platform ? `${platform.name} · ${platform.id}` : values.platform_profile_id ? `所选平台当前不可用：${values.platform_profile_id}` : '尚未选择'}</dd></div></dl>
        <ErrorSummary errors={summary} />
        {!unknown && <Button type="submit" disabled={unavailable || !isValid || !optionSelectionValid || options.isFetching || Boolean(options.error)}>确认创建 Content Task</Button>}
        <Button type="button" variant="ghost" disabled={busy || unknown} onClick={() => { form.reset(emptyValues); setOpen(false); setError(undefined); setHeld(false); request.current = undefined; }}>取消 Content Task 创建</Button>
      </form></FormProvider>}
    </>}
    {denied && <p role="alert">{businessErrorMessage(error ?? options.error)}</p>}
  </section>;
}
function BusinessSelect({ name, label, choices, onChange }: { name: keyof OpportunityContentValues; label: string; choices: { value: string; label: string }[]; onChange?: (value: string) => void }) {
  return <FormField<OpportunityContentValues, keyof OpportunityContentValues> name={name} id={`opportunity-content-${name}`} label={label} required render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => <Select items={choices} value={field.value} onValueChange={(value) => { if (value !== null) (onChange ?? field.onChange)(value); }}><SelectTrigger className="w-full max-w-full min-w-0" id={inputId} ref={field.ref} onBlur={field.onBlur} aria-describedby={describedBy} aria-invalid={invalid} aria-required><SelectValue className="min-w-0 overflow-hidden" placeholder="请选择" /></SelectTrigger><SelectContent>{choices.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>} />;
}
