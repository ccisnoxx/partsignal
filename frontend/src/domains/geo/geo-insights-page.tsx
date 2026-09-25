import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
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
  canonicalGeoInsightSearchRecord,
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
  onCreated: (taskId: string) => void | Promise<void>;
  onSearchChange: (search: GeoInsightSearch) => void;
  search: GeoInsightSearch;
};

type OptimizationCommand = { key: string; pending: boolean; acceptedId?: string };
type OptimizationCommands = Map<string, OptimizationCommand>;

function GeoInsightsPage(props: GeoInsightsPageProps) {
  // 同一页面的 Dialog 重开与筛选切换仍复用完整载荷的命令身份。
  const [commands] = useState<OptimizationCommands>(() => new Map());
  return <GeoInsightsSession {...props} commands={commands} key={JSON.stringify(canonicalGeoInsightSearchRecord(props.search))} />;
}

function GeoInsightsSession({
  csrfToken,
  commands,
  onCreated,
  onSearchChange,
  search,
}: GeoInsightsPageProps & { commands: OptimizationCommands }) {
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
          commands={commands}
          insights={insights}
          search={search}
          csrfToken={csrfToken}
          onClose={() => setOptimization(undefined)}
          onCreated={onCreated}
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
  const labelId = useId();
  const items = [
    { value: allFilterValue, label: '全部' },
    ...options.map((item) => ({ value: item.id, label: item.label })),
  ];
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <span id={labelId}>{label}</span>
      <Select
        items={items}
        onValueChange={(next) => next && onChange(next === allFilterValue ? undefined : next)}
        value={value ?? allFilterValue}
      >
        <SelectTrigger aria-labelledby={labelId} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

const allFilterValue = '__all__';

function findOptimizationAction(
  data: GeoInsights,
  expected: GeoInsightOptimizationAction,
) {
  const actions = [
    ...data.content_rankings.declining,
    ...data.content_rankings.long_unmentioned,
    ...data.question_coverage.matrix,
  ].flatMap((item) => item.primary_task === 'CREATE_OPTIMIZATION_TASK' && item.optimization_action ? [item.optimization_action] : []);
  return actions.find((action) => (
    action.rule_code === expected.rule_code
    && action.date_from === expected.date_from
    && action.date_to === expected.date_to
    && action.published_article_id === expected.published_article_id
    && action.query_topic_id === expected.query_topic_id
    && action.geo_platform === expected.geo_platform
  ));
}

function OptimizationDialog({ context, commands, csrfToken, insights, search, onClose, onCreated }: {
  context: OptimizationContext;
  commands: OptimizationCommands;
  csrfToken: string | null;
  insights: UseQueryResult<GeoInsights>;
  search: GeoInsightSearch;
  onClose: () => void;
  onCreated: (taskId: string) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const options = useQuery(contentTaskCreationOptionsQueryOptions(context.initialProductId));
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  const [acceptedId, setAcceptedId] = useState<string>();
  const [navigationError, setNavigationError] = useState<string>();
  const form = useForm<GeoOptimizationTarget>({ defaultValues: { product_id: '', platform_profile_id: '', fact_version_id: '' }, resolver: zodResolver(geoOptimizationTargetSchema) });
  const productId = useWatch({ control: form.control, name: 'product_id' });
  const platformId = useWatch({ control: form.control, name: 'platform_profile_id' });
  const factVersionId = useWatch({ control: form.control, name: 'fact_version_id' });
  const initialized = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const accepted = useRef<string | undefined>(undefined);
  const create = useMutation({ mutationFn: ({ body, key }: { body: ReturnType<typeof toGeoOptimizationCreate>; key: string }) => createGeoOptimizationContentTask(body, csrfToken, key) });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!options.isSuccess || initialized.current) return;
    const product = options.data.products.find((item) => item.id === context.initialProductId);
    const platform = options.data.platforms.find((item) => item.id === context.initialPlatformId);
    form.reset({ product_id: product?.id ?? '', platform_profile_id: platform?.id ?? '', fact_version_id: '' });
    initialized.current = true;
  }, [context, form, options.data, options.isSuccess]);

  const sourceAvailable = Boolean(insights.data && findOptimizationAction(insights.data, context.action));
  const targetRevoked = Boolean(options.data && (
    (productId && !options.data.products.some((item) => item.id === productId))
    || (platformId && !options.data.platforms.some((item) => item.id === platformId))
    || (factVersionId && !options.data.products.find((item) => item.id === productId)?.approved_fact_versions.some((item) => item.id === factVersionId))
  ));
  if (!stale && (insights.isError || options.isError || !sourceAvailable || targetRevoked)) setStale(true);

  const product = options.data?.products.find((item) => item.id === productId);
  const locked = create.isPending || Boolean(acceptedId);
  const blocked = locked || reloading || stale || insights.isFetching || options.isFetching
    || insights.isError || options.isError || !sourceAvailable || targetRevoked;

  async function openAccepted(id: string) {
    if (!mounted.current) return;
    setNavigationError(undefined);
    try {
      await onCreated(id);
    } catch (error) {
      if (mounted.current) setNavigationError(errorMessage(error));
    }
  }

  async function submit(values: GeoOptimizationTarget) {
    if (blocked || accepted.current) return;
    const currentInsights = queryClient.getQueryState<GeoInsights>(geoInsightsQueryOptions(search).queryKey);
    const currentOptions = queryClient.getQueryState<components['schemas']['ContentTaskCreationOptions']>(contentKeys.creationOptions(context.initialProductId));
    if (currentInsights?.status !== 'success' || currentInsights.fetchStatus !== 'idle'
      || currentOptions?.status !== 'success' || currentOptions.fetchStatus !== 'idle'
      || !currentInsights.data || !findOptimizationAction(currentInsights.data, context.action)
      || !currentOptions.data || targetErrors(currentOptions.data, values).length) {
      setStale(true);
      return;
    }
    const body = toGeoOptimizationCreate(context.action, values);
    const signature = JSON.stringify(body);
    const command = commands.get(signature) ?? { key: crypto.randomUUID(), pending: false };
    commands.set(signature, command);
    if (command.pending) {
      form.setError('root.server', { message: '同一优化任务正在创建，请等待原请求完成' });
      return;
    }
    if (command.acceptedId) {
      accepted.current = command.acceptedId;
      setAcceptedId(command.acceptedId);
      await openAccepted(command.acceptedId);
      return;
    }
    form.clearErrors(); setRequestId(undefined); create.reset();
    command.pending = true;
    let task: components['schemas']['ContentTask'];
    try {
      task = await create.mutateAsync({ body, key: command.key });
    } catch (error) {
      const mapped = mapGeoOptimizationError(error);
      if (mapped.code === 'IDEMPOTENCY_CONFLICT') commands.delete(signature);
      if (mounted.current) {
        for (const [field, message] of Object.entries(mapped.fields)) form.setError(field as GeoOptimizationTargetField, { type: 'server', message });
        if (mapped.formMessage) form.setError('root.server', { type: 'server', message: mapped.formMessage });
        setRequestId(mapped.requestId);
        if (mapped.stale) setStale(true);
      }
      return;
    } finally {
      command.pending = false;
    }
    command.acceptedId = task.id;
    if (mounted.current) {
      accepted.current = task.id;
      setAcceptedId(task.id);
    }
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: geoKeys.insights() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: productsKeys.detail(values.product_id) }),
      ...(context.action.query_topic_id ? [queryClient.invalidateQueries({ queryKey: geoKeys.topicLists() })] : []),
    ]);
    await openAccepted(task.id);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current || blocked || accepted.current) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    void form.handleSubmit(submit)(event).finally(() => { submitting.current = false; });
  }

  async function reload() {
    if (reloading || submitting.current || accepted.current) return;
    setStale(true);
    setReloading(true);
    try {
      const [refreshedInsights, refreshedOptions] = await Promise.all([insights.refetch(), options.refetch()]);
      if (!mounted.current) return;
      if (!refreshedInsights.isSuccess || !refreshedOptions.isSuccess) return;
      if (!findOptimizationAction(refreshedInsights.data, context.action)) {
        form.setError('root.server', { type: 'server', message: '原优化来源已不再可用，已保留目标输入。请关闭后从最新洞察重新选择来源。' });
        return;
      }
      const errors = targetErrors(refreshedOptions.data, form.getValues());
      form.clearErrors();
      for (const [field, message] of errors) form.setError(field, { type: 'server', message });
      if (errors.length) return;
      setStale(false);
      setRequestId(undefined);
      create.reset();
    } catch (error) {
      if (mounted.current) form.setError('root.server', { type: 'server', message: errorMessage(error) });
    } finally {
      if (mounted.current) setReloading(false);
    }
  }

  function close() {
    if (!submitting.current && !accepted.current) onClose();
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) close(); }} open>
      <DialogContent className="sm:max-w-lg" showCloseButton={!locked}>
        <DialogHeader><DialogTitle>创建 GEO 优化任务</DialogTitle><DialogDescription>{context.label}。来源规则与周期由服务端洞察快照提供，请明确选择目标与已批准事实。</DialogDescription></DialogHeader>
        {acceptedId && <div className="space-y-2" role="status"><p>任务已创建：{acceptedId}</p>{navigationError && <p role="alert">打开任务失败：{navigationError}</p>}<Button onClick={() => void openAccepted(acceptedId)} type="button">打开已创建任务</Button></div>}
        {options.isPending && <p aria-busy="true">正在读取创建选项…</p>}
        {options.isError && <div role="alert"><p>{errorMessage(options.error)}</p><Button disabled={locked || reloading} onClick={() => void reload()} type="button" variant="outline">重试</Button></div>}
        {options.data && <form className="space-y-4" onSubmit={handleSubmit}>
          {form.formState.errors.root?.server?.message && <p className="text-destructive" role="alert">{form.formState.errors.root.server.message}</p>}
          {requestId && <p className="text-sm text-text-secondary">请求 ID：{requestId}</p>}
          <TaskSelect disabled={locked || reloading} error={form.formState.errors.product_id?.message} label="产品" onChange={(value) => { form.setValue('product_id', value, { shouldDirty: true, shouldValidate: true }); form.setValue('fact_version_id', '', { shouldDirty: true, shouldValidate: true }); }} options={options.data.products.map((item) => ({ id: item.id, label: `${item.brand} · ${item.part_number}` }))} value={productId} />
          <TaskSelect disabled={locked || reloading} error={form.formState.errors.platform_profile_id?.message} label="目标平台" onChange={(value) => form.setValue('platform_profile_id', value, { shouldDirty: true, shouldValidate: true })} options={options.data.platforms.map((item) => ({ id: item.id, label: item.name }))} value={platformId} />
          <TaskSelect disabled={locked || reloading} error={form.formState.errors.fact_version_id?.message} label="已批准事实版本" onChange={(value) => form.setValue('fact_version_id', value, { shouldDirty: true, shouldValidate: true })} options={(product?.approved_fact_versions ?? []).map((item) => ({ id: item.id, label: `v${item.version} · ${item.classification}` }))} value={factVersionId} />
          {!acceptedId && stale && <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert"><p>洞察来源或目标上下文已经变化。表单已保留，请重新加载后从最新洞察发起。</p><Button disabled={reloading || create.isPending} onClick={() => void reload()} type="button" variant="outline">重新加载洞察</Button></div>}
          <DialogFooter><Button disabled={blocked} type="submit">{create.isPending ? '正在创建…' : '创建任务'}</Button><Button disabled={locked} onClick={close} type="button" variant="outline">取消</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

function targetErrors(options: components['schemas']['ContentTaskCreationOptions'], values: GeoOptimizationTarget): Array<[GeoOptimizationTargetField, string]> {
  const product = options.products.find((item) => item.id === values.product_id);
  const errors: Array<[GeoOptimizationTargetField, string]> = [];
  if (!product) errors.push(['product_id', '所选产品已不再可用']);
  if (!options.platforms.some((item) => item.id === values.platform_profile_id)) errors.push(['platform_profile_id', '所选目标平台已不再可用']);
  if (!product?.approved_fact_versions.some((item) => item.id === values.fact_version_id)) errors.push(['fact_version_id', '所选事实版本已不再可用']);
  return errors;
}

function TaskSelect({ disabled, error, label, onChange, options, value }: { disabled: boolean; error?: string; label: string; onChange: (value: string) => void; options: readonly { id: string; label: string }[]; value: string }) {
  const labelId = useId();
  const errorId = useId();
  const items = options.map((item) => ({ value: item.id, label: item.label }));
  return <div className="block space-y-1 text-sm"><span id={labelId}>{label}</span><Select disabled={disabled} items={items} onValueChange={(next) => next && onChange(next)} value={value || null}><SelectTrigger aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} aria-labelledby={labelId} className="w-full"><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{error && <span className="text-destructive" id={errorId}>{error}</span>}</div>;
}

function resetFilters(): GeoInsightSearch {
  return defaultGeoInsightDates();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取失败';
}

export { GeoInsightsPage };
export type { GeoInsightsPageProps };
