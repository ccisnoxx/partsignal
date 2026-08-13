import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';

import { Button, buttonVariants } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import { contentKeys, contentTaskCreationOptionsQueryOptions } from '@/domains/content/content.api';
import { productsKeys } from '@/domains/product/product.api';
import type { components } from '@/shared/api/generated/schema';
import {
  createGeoOptimizationContentTask,
  geoInsightsQueryOptions,
  geoKeys,
  mapGeoOptimizationError,
} from './geo.api';
import {
  defaultGeoInsightDates,
  formatInsightGeneratedAt,
  geoInsightPrintHref,
  geoOptimizationTargetSchema,
  toGeoOptimizationCreate,
  type GeoInsightSearch,
  type GeoOptimizationTarget,
  type GeoOptimizationTargetField,
} from './geo-insights.model';
import {
  GeoInsightsReport,
  type OptimizationContext,
} from './geo-insights-report';

type GeoInsights = components['schemas']['GeoInsights'];
type GeoInsightOptimizationAction = components['schemas']['GeoInsightOptimizationAction'];

type GeoInsightsPageProps = {
  csrfToken: string | null;
  onCreated: (taskId: string) => void;
  onSearchChange: (search: GeoInsightSearch) => void;
  search: GeoInsightSearch;
};

function GeoInsightsPage({
  csrfToken,
  onCreated,
  onSearchChange,
  search,
}: GeoInsightsPageProps) {
  const insights = useQuery(geoInsightsQueryOptions(search));
  const [optimization, setOptimization] = useState<OptimizationContext>();

  if (insights.isPending) {
    return <div aria-busy="true" className="rounded-xl border border-border-subtle p-6">正在读取 GEO 洞察…</div>;
  }
  if (!insights.data) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5" role="alert">
        <p>{errorMessage(insights.error)}</p>
        <div className="flex gap-2">
          <Button onClick={() => void insights.refetch()} type="button" variant="outline">重试</Button>
          <Button onClick={() => onSearchChange(resetFilters())} type="button" variant="ghost">清除筛选</Button>
        </div>
      </div>
    );
  }

  const data = insights.data;
  return (
    <section className="min-w-0 space-y-8" aria-labelledby="geo-insights-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="type-page-title" id="geo-insights-title">GEO 洞察</h1>
          <p className="text-text-secondary">基于当前链尾人工观测与逐篇发布内容关系，定位值得跟进的内容与问题。</p>
          <p className="text-sm text-text-tertiary">
            当前周期 {data.period.current.date_from} 至 {data.period.current.date_to} · 生成于 {formatInsightGeneratedAt(data.generated_at)}
          </p>
        </div>
        <a className={buttonVariants({ variant: 'outline' })} href={geoInsightPrintHref(search)}>打印报告</a>
      </header>

      <InsightsFilters
        data={data}
        key={JSON.stringify(search)}
        onSearchChange={onSearchChange}
        search={search}
      />

      {insights.isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4" role="alert">
          <p>刷新失败，当前仍显示上一次成功快照。{errorMessage(insights.error)}</p>
          <Button onClick={() => void insights.refetch()} type="button" variant="outline">重新加载</Button>
        </div>
      )}

      <GeoInsightsReport data={data} onOptimize={setOptimization} variant="screen" />

      {optimization && (
        <OptimizationDialog
          context={optimization}
          csrfToken={csrfToken}
          onClose={() => setOptimization(undefined)}
          onCreated={onCreated}
          onReload={async () => {
            const refreshed = await insights.refetch();
            if (!refreshed.isSuccess) return false;
            const nextAction = refreshed.data
              ? findOptimizationAction(refreshed.data, optimization.action)
              : undefined;
            if (!nextAction) {
              setOptimization(undefined);
              return false;
            }
            setOptimization((current) => current ? { ...current, action: nextAction } : current);
            return true;
          }}
        />
      )}
    </section>
  );
}

function InsightsFilters({ data, onSearchChange, search }: { data: GeoInsights; onSearchChange: (search: GeoInsightSearch) => void; search: GeoInsightSearch }) {
  const [draft, setDraft] = useState(search);
  function updateDraft<K extends keyof GeoInsightSearch>(key: K, value: GeoInsightSearch[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form className="grid min-w-0 gap-3 rounded-xl border border-border-subtle p-4 md:grid-cols-4 xl:grid-cols-7" onSubmit={(event) => { event.preventDefault(); onSearchChange(draft); }}>
      <FilterDate label="开始日期" onChange={(value) => updateDraft('from', value)} value={draft.from} />
      <FilterDate label="结束日期" onChange={(value) => updateDraft('to', value)} value={draft.to} />
      <FilterSelect label="产品" onChange={(value) => updateDraft('productId', value)} options={data.filter_options.products} value={draft.productId} />
      <FilterSelect label="内容平台" onChange={(value) => updateDraft('contentPlatformId', value)} options={data.filter_options.content_platforms} value={draft.contentPlatformId} />
      <FilterSelect label="GEO 平台" onChange={(value) => updateDraft('geoPlatform', value)} options={data.filter_options.geo_platforms.map((label) => ({ id: label, label }))} value={draft.geoPlatform} />
      <FilterSelect label="发布内容" onChange={(value) => updateDraft('publishedArticleId', value)} options={data.filter_options.publications.map((item) => ({ id: item.id, label: `${item.label} · ${item.platform_name}` }))} value={draft.publishedArticleId} />
      <FilterSelect label="问题主题" onChange={(value) => updateDraft('queryTopicId', value)} options={data.filter_options.query_topics} value={draft.queryTopicId} />
      <div className="flex items-end gap-2 md:col-span-4 xl:col-span-7"><Button type="submit">应用筛选</Button><Button onClick={() => onSearchChange(resetFilters())} type="button" variant="outline">重置</Button></div>
    </form>
  );
}

function FilterDate({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <label className="min-w-0 space-y-1 text-sm"><span>{label}</span><Input onChange={(event) => onChange(event.target.value)} required type="date" value={value} /></label>;
}

function FilterSelect({ label, onChange, options, value }: { label: string; onChange: (value: string | undefined) => void; options: readonly { id: string; label: string }[]; value?: string }) {
  return (
    <label className="min-w-0 space-y-1 text-sm"><span>{label}</span>
      <select className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm" onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ''}>
        <option value="">全部</option>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
  );
}

function findOptimizationAction(
  data: GeoInsights,
  expected: GeoInsightOptimizationAction,
) {
  const actions = [
    ...data.content_rankings.declining,
    ...data.content_rankings.long_unmentioned,
    ...data.question_coverage.matrix,
  ].flatMap((item) => item.optimization_action ? [item.optimization_action] : []);
  return actions.find((action) => (
    action.rule_code === expected.rule_code
    && action.date_from === expected.date_from
    && action.date_to === expected.date_to
    && action.published_article_id === expected.published_article_id
    && action.query_topic_id === expected.query_topic_id
    && action.geo_platform === expected.geo_platform
  ));
}

function OptimizationDialog({ context, csrfToken, onClose, onCreated, onReload }: { context: OptimizationContext; csrfToken: string | null; onClose: () => void; onCreated: (taskId: string) => void; onReload: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const options = useQuery(contentTaskCreationOptionsQueryOptions(context.initialProductId));
  const idempotency = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  const form = useForm<GeoOptimizationTarget>({ defaultValues: { product_id: '', platform_profile_id: '', fact_version_id: '' }, resolver: zodResolver(geoOptimizationTargetSchema) });
  const productId = useWatch({ control: form.control, name: 'product_id' });
  const initialized = useRef(false);
  const submitting = useRef(false);
  const create = useMutation({ mutationFn: ({ body, key }: { body: ReturnType<typeof toGeoOptimizationCreate>; key: string }) => createGeoOptimizationContentTask(body, csrfToken, key) });

  useEffect(() => {
    if (!options.data || initialized.current) return;
    const product = options.data.products.find((item) => item.id === context.initialProductId);
    const platform = options.data.platforms.find((item) => item.id === context.initialPlatformId);
    form.reset({ product_id: product?.id ?? '', platform_profile_id: platform?.id ?? '', fact_version_id: '' });
    initialized.current = true;
  }, [context, form, options.data]);

  const product = options.data?.products.find((item) => item.id === productId);
  async function submit(values: GeoOptimizationTarget) {
    form.clearErrors(); setRequestId(undefined); create.reset();
    const body = toGeoOptimizationCreate(context.action, values);
    const signature = JSON.stringify(body);
    const key = idempotency.current?.signature === signature ? idempotency.current.key : crypto.randomUUID();
    idempotency.current = { signature, key };
    try {
      const task = await create.mutateAsync({ body, key });
      idempotency.current = undefined;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: geoKeys.insights() }),
        queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: productsKeys.detail(values.product_id) }),
        context.action.query_topic_id ? queryClient.invalidateQueries({ queryKey: geoKeys.topicLists() }) : Promise.resolve(),
      ]);
      onCreated(task.id);
    } catch (error) {
      const mapped = mapGeoOptimizationError(error);
      for (const [field, message] of Object.entries(mapped.fields)) form.setError(field as GeoOptimizationTargetField, { type: 'server', message });
      if (mapped.formMessage) form.setError('root.server', { type: 'server', message: mapped.formMessage });
      setRequestId(mapped.requestId);
      setStale(mapped.stale);
      if (mapped.code === 'IDEMPOTENCY_CONFLICT') idempotency.current = undefined;
    }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    void form.handleSubmit(submit)(event).finally(() => { submitting.current = false; });
  }
  async function reload() {
    idempotency.current = undefined;
    const [stillValid, refreshedOptions] = await Promise.all([onReload(), options.refetch()]);
    if (!stillValid || !refreshedOptions.isSuccess) return;
    const values = form.getValues();
    const selectedProduct = refreshedOptions.data.products.find(
      (item) => item.id === values.product_id,
    );
    const invalidFields: Array<[GeoOptimizationTargetField, string]> = [];
    if (!selectedProduct) invalidFields.push(['product_id', '所选产品已不再可用']);
    if (!refreshedOptions.data.platforms.some((item) => item.id === values.platform_profile_id)) {
      invalidFields.push(['platform_profile_id', '所选目标平台已不再可用']);
    }
    if (!selectedProduct?.approved_fact_versions.some((item) => item.id === values.fact_version_id)) {
      invalidFields.push(['fact_version_id', '所选事实版本已不再可用']);
    }
    form.clearErrors();
    for (const [field, message] of invalidFields) {
      form.setError(field, { type: 'server', message });
    }
    if (invalidFields.length > 0) return;
    setStale(false);
    setRequestId(undefined);
    create.reset();
  }
  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>创建 GEO 优化任务</DialogTitle><DialogDescription>{context.label}。来源规则与周期由服务端洞察快照提供，请明确选择目标与已批准事实。</DialogDescription></DialogHeader>
        {options.isPending && <p aria-busy="true">正在读取创建选项…</p>}
        {options.isError && <div role="alert"><p>{errorMessage(options.error)}</p><Button onClick={() => void options.refetch()} type="button" variant="outline">重试</Button></div>}
        {options.data && <form className="space-y-4" onSubmit={handleSubmit}>
          {form.formState.errors.root?.server?.message && <p className="text-destructive" role="alert">{form.formState.errors.root.server.message}</p>}
          {requestId && <p className="text-sm text-text-secondary">请求 ID：{requestId}</p>}
          <NativeTaskSelect error={form.formState.errors.product_id?.message} label="产品" options={options.data.products.map((item) => ({ id: item.id, label: `${item.brand} · ${item.part_number}` }))} register={form.register('product_id', { onChange: () => form.setValue('fact_version_id', '') })} />
          <NativeTaskSelect error={form.formState.errors.platform_profile_id?.message} label="目标平台" options={options.data.platforms.map((item) => ({ id: item.id, label: item.name }))} register={form.register('platform_profile_id')} />
          <NativeTaskSelect error={form.formState.errors.fact_version_id?.message} label="已批准事实版本" options={(product?.approved_fact_versions ?? []).map((item) => ({ id: item.id, label: `v${item.version} · ${item.classification}` }))} register={form.register('fact_version_id')} />
          {stale && <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert"><p>洞察来源或目标上下文已经变化。表单已保留，请重新加载后从最新洞察发起。</p><Button onClick={() => void reload()} type="button" variant="outline">重新加载洞察</Button></div>}
          <DialogFooter><Button disabled={create.isPending || stale} type="submit">{create.isPending ? '正在创建…' : '创建任务'}</Button><Button onClick={onClose} type="button" variant="outline">取消</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

function NativeTaskSelect({ error, label, options, register }: { error?: string; label: string; options: readonly { id: string; label: string }[]; register: UseFormRegisterReturn }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span><select aria-invalid={Boolean(error)} className="h-9 w-full rounded-lg border border-input bg-background px-2" {...register}><option value="">请选择</option>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{error && <span className="text-destructive">{error}</span>}</label>;
}

function resetFilters(): GeoInsightSearch {
  return defaultGeoInsightDates();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取失败';
}

export { GeoInsightsPage };
export type { GeoInsightsPageProps };
