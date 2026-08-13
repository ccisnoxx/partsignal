import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { TableShell } from '@/design-system/data-table/table-shell';
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
  contentInsightHref,
  coverageInsightHref,
  defaultGeoInsightDates,
  formatInsightChange,
  formatInsightRate,
  geoOptimizationTargetSchema,
  observationListHref,
  toGeoOptimizationCreate,
  type GeoInsightSearch,
  type GeoOptimizationTarget,
  type GeoOptimizationTargetField,
} from './geo-insights.model';

type GeoInsights = components['schemas']['GeoInsights'];
type GeoInsightOptimizationAction = components['schemas']['GeoInsightOptimizationAction'];
type GeoInsightRateTrend = components['schemas']['GeoInsightRateTrend'];
type GeoInsightContentPerformance = components['schemas']['GeoInsightContentPerformance'];
type GeoInsightCoverageItem = components['schemas']['GeoInsightCoverageItem'];

type GeoInsightsPageProps = {
  csrfToken: string | null;
  onCreated: (taskId: string) => void;
  onSearchChange: (search: GeoInsightSearch) => void;
  search: GeoInsightSearch;
};

type OptimizationContext = {
  action: GeoInsightOptimizationAction;
  initialPlatformId?: string;
  initialProductId?: string;
  label: string;
};

const coverageLabels = {
  STABLE: '稳定覆盖',
  OCCASIONAL: '偶尔提及',
  UNCOVERED: '未覆盖',
  INSUFFICIENT_DATA: '样本不足',
} satisfies Record<GeoInsightCoverageItem['status'], string>;

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
      <header className="space-y-1">
        <h1 className="type-page-title" id="geo-insights-title">GEO 洞察</h1>
        <p className="text-text-secondary">基于当前链尾人工观测与逐篇发布内容关系，定位值得跟进的内容与问题。</p>
        <p className="text-sm text-text-tertiary">
          当前周期 {data.period.current.date_from} 至 {data.period.current.date_to} · 生成于 {new Date(data.generated_at).toLocaleString('zh-CN')}
        </p>
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

      <section aria-labelledby="trend-title" className="space-y-3">
        <h2 className="type-section-title" id="trend-title">核心趋势</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <TrendCard label="发现率" trend={data.trends.discovery_rate} />
          <TrendCard label="提及率" trend={data.trends.mention_rate} />
          <TrendCard label="准确率" trend={data.trends.accuracy_rate} />
        </div>
      </section>

      <InsightSection title="平台表现">
        <TableShell regionLabel="GEO 平台表现">
          <thead><tr><th>平台</th><th>样本</th><th>发现率</th><th>提及率</th><th>准确率</th><th>操作</th></tr></thead>
          <tbody>{data.platform_performance.map((item) => (
            <tr key={item.geo_platform}>
              <td>{item.geo_platform}</td><td>{item.observation_count}</td>
              <td>{formatInsightRate(item.discovery_rate)}</td><td>{formatInsightRate(item.mention_rate)}</td><td>{formatInsightRate(item.accuracy_rate)}</td>
              <td><a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={observationListHref(data.period.current, { geoPlatform: item.geo_platform })}>查看观测</a></td>
            </tr>
          ))}</tbody>
        </TableShell>
        {data.platform_performance.length === 0 && <EmptyMessage>当前筛选范围没有平台表现数据。</EmptyMessage>}
      </InsightSection>

      <InsightSection title="内容表现">
        <ContentTable items={data.content_rankings.best} label="最佳内容" onOptimize={setOptimization} period={data.period.current} />
        <ContentTable items={data.content_rankings.declining} label="下降内容" onOptimize={setOptimization} period={data.period.current} />
        <ContentTable items={data.content_rankings.long_unmentioned} label="长期未提及" onOptimize={setOptimization} period={data.period.current} />
      </InsightSection>

      <InsightSection title="问题覆盖">
        <p className="text-sm text-text-secondary">
          稳定 {data.question_coverage.by_status.stable} · 偶尔 {data.question_coverage.by_status.occasional} · 未覆盖 {data.question_coverage.by_status.uncovered} · 样本不足 {data.question_coverage.by_status.insufficient_data}
        </p>
        <TableShell regionLabel="问题覆盖矩阵">
          <thead><tr><th>问题</th><th>GEO 平台</th><th>状态</th><th>样本</th><th>覆盖率</th><th>操作</th></tr></thead>
          <tbody>{data.question_coverage.matrix.map((item) => (
            <tr key={`${item.query_topic_id}:${item.geo_platform}`}>
              <td>{item.canonical_question}</td><td>{item.geo_platform}</td><td>{coverageLabels[item.status]}</td>
              <td>{item.mentioned_observation_count}/{item.observation_count}</td><td>{formatInsightRate(item.coverage_rate)}</td>
              <td><CoverageAction item={item} onOptimize={setOptimization} period={data.period.current} /></td>
            </tr>
          ))}</tbody>
        </TableShell>
        {data.question_coverage.matrix.length === 0 && <EmptyMessage>当前筛选范围没有问题覆盖数据。</EmptyMessage>}
      </InsightSection>

      <InsightSection title="建议">
        <div className="grid gap-3 md:grid-cols-2">
          {data.recommendations.map((item, index) => (
            <article className="rounded-xl border border-border-subtle p-4" key={`${item.rule_code}:${index}`}>
              <p className="text-xs font-medium text-text-secondary">{item.priority}</p>
              <h3 className="font-medium">{item.title}</h3>
              <p className="mt-2 text-sm text-text-secondary">{item.basis_text}</p>
              <p className="mt-2 text-xs text-text-tertiary">影响关系：{item.impact_relationship_count}</p>
            </article>
          ))}
        </div>
        {data.recommendations.length === 0 && <EmptyMessage>当前没有服务端建议。</EmptyMessage>}
      </InsightSection>

      <DataQuality data={data} />

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

function TrendCard({ label, trend }: { label: string; trend: GeoInsightRateTrend }) {
  const drawable = trend.points.map((point, index) => ({ index, value: point.value })).filter((point) => point.value !== null);
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-border-subtle p-4">
      <div>
        <h3 className="font-medium">{label}</h3>
        <p className="text-2xl font-semibold">{formatInsightRate(trend.current)}</p>
        <p className="text-sm text-text-secondary">当前 {trend.current.numerator}/{trend.current.denominator} · 上一周期 {formatInsightRate(trend.previous)}（{trend.previous.numerator}/{trend.previous.denominator}）</p>
        <p className="text-sm text-text-secondary">{formatInsightChange(trend)}</p>
      </div>
      <svg aria-hidden="true" className="h-24 w-full" preserveAspectRatio="none" viewBox="0 0 100 40">
        {drawable.map((point, index) => {
          const previous = drawable[index - 1];
          if (!previous || point.index !== previous.index + 1) return null;
          const denominator = Math.max(trend.points.length - 1, 1);
          return <line key={point.index} stroke="currentColor" strokeWidth="1.5" x1={(previous.index / denominator) * 100} x2={(point.index / denominator) * 100} y1={38 - (previous.value ?? 0) * 36} y2={38 - (point.value ?? 0) * 36} />;
        })}
      </svg>
      <details><summary className="cursor-pointer text-sm">查看精确数据</summary>
        <TableShell regionLabel={`${label}每日精确数据`}><thead><tr><th>日期</th><th>分子</th><th>分母</th><th>比率</th></tr></thead><tbody>{trend.points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.numerator}</td><td>{point.denominator}</td><td>{formatInsightRate(point)}</td></tr>)}</tbody></TableShell>
      </details>
    </article>
  );
}

function InsightSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="min-w-0 space-y-3"><h2 className="type-section-title">{title}</h2>{children}</section>;
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border-subtle p-4 text-sm text-text-secondary">{children}</p>;
}

function ContentTable({ items, label, onOptimize, period }: { items: readonly GeoInsightContentPerformance[]; label: string; onOptimize: (context: OptimizationContext) => void; period: GeoInsights['period']['current'] }) {
  return (
    <div className="space-y-2"><h3 className="font-medium">{label}</h3>
      <TableShell regionLabel={label}><thead><tr><th>内容</th><th>平台</th><th>样本</th><th>发现率</th><th>提及率</th><th>准确率</th><th>操作</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.published_article_id}><td>{item.title}</td><td>{item.content_platform}</td><td>{item.observation_count}</td><td>{formatInsightRate(item.discovery_rate)}</td><td>{formatInsightRate(item.mention_rate)}</td><td>{formatInsightRate(item.accuracy_rate)}</td><td><ContentAction item={item} onOptimize={onOptimize} period={period} /></td></tr>)}</tbody>
      </TableShell>{items.length === 0 && <EmptyMessage>没有{label}。</EmptyMessage>}
    </div>
  );
}

function ContentAction({ item, onOptimize, period }: { item: GeoInsightContentPerformance; onOptimize: (context: OptimizationContext) => void; period: GeoInsights['period']['current'] }) {
  const href = contentInsightHref(item, period);
  if (href) return <a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={href}>查看内容</a>;
  const action = item.optimization_action;
  if (!action) throw new Error('GEO Content Performance 缺少服务端优化来源');
  return <Button onClick={() => onOptimize({ action, initialPlatformId: item.content_platform_id, initialProductId: item.product_id, label: item.title })} size="sm" type="button">创建优化任务</Button>;
}

function CoverageAction({ item, onOptimize, period }: { item: GeoInsightCoverageItem; onOptimize: (context: OptimizationContext) => void; period: GeoInsights['period']['current'] }) {
  const href = coverageInsightHref(item, period);
  if (href) return <a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={href}>{item.primary_task === 'ADD_OBSERVATION' ? '补充观测' : '查看观测'}</a>;
  const action = item.optimization_action;
  if (!action) throw new Error('GEO Coverage 缺少服务端优化来源');
  return <Button onClick={() => onOptimize({ action, label: `${item.canonical_question} · ${item.geo_platform}` })} size="sm" type="button">创建优化任务</Button>;
}

function DataQuality({ data }: { data: GeoInsights }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle p-4" aria-labelledby="data-quality-title">
      <h2 className="type-section-title" id="data-quality-title">数据质量</h2>
      <p>有效观测 {data.data_quality.eligible_observation_count}；排除未完成观测 {data.data_quality.excluded_incomplete_observation_count}；排除不完整关系 {data.data_quality.excluded_incomplete_relation_count}。</p>
      {(data.data_quality.excluded_incomplete_observation_count > 0
        || data.data_quality.excluded_incomplete_relation_count > 0) && (
        <p className="text-sm text-warning" role="status">当前结果只包含完整数据；部分观测或关系已被排除。</p>
      )}
      {data.data_quality.unavailable_sections.map((item) => <p className="text-sm text-warning" key={item.code}>{item.message}</p>)}
    </section>
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
