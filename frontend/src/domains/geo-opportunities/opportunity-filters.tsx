import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { fromUtcInput, modeLabels, opportunitySearchSchema, priorityLabels, ruleLabels, sortLabels, statusLabels, toUtcInput, type OpportunitySearch } from './opportunities.model';
import { OpportunitySelect } from './opportunity-controls';

const dimensions = [
  { key: 'subject_id', options: 'subjects', label: '监测对象' }, { key: 'product_id', options: 'products', label: '产品' },
  { key: 'query_topic_id', options: 'query_topics', label: '问题主题' }, { key: 'prompt_variant_id', options: 'prompt_variants', label: '问题变体' },
  { key: 'collection_profile_id', options: 'collection_profiles', label: '采集配置' }, { key: 'engine_surface_id', options: 'engine_surfaces', label: '观测面' },
] as const;
const filterNames = ['q', 'status', 'priority', 'rule_code', 'subject_id', 'product_id', 'query_topic_id', 'prompt_variant_id', 'collection_profile_id', 'engine_surface_id', 'collection_mode', 'sort', 'created_from', 'created_to'] as const;
type FilterValues = Record<typeof filterNames[number], string>;
const choices = (labels: Record<string, string>) => [{ value: '', label: '全部' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))];
export function OpportunityFilters({ search, options, onChange }: { search: OpportunitySearch; options?: components['schemas']['GeoOpportunityFilterOptions']; onChange: (search: OpportunitySearch) => void }) {
  const form = useForm<FilterValues>({ defaultValues: Object.fromEntries(filterNames.map((key) => [key, key === 'created_from' || key === 'created_to' ? toUtcInput(search[key]) : key === 'sort' ? search.sort ?? 'PRIORITY_DESC' : search[key] ?? ''])) as FilterValues });
  const values = useWatch({ control: form.control }) as FilterValues;
  const select = (key: keyof FilterValues, label: string, items: { value: string; label: string }[]) => <div className="min-w-0 space-y-1" key={key}><label className="type-label" htmlFor={`opportunity-filter-${key}`}>{label}</label><OpportunitySelect choices={items} id={`opportunity-filter-${key}`} label={label} onChange={(value) => form.setValue(key, value)} value={values[key]} /></div>;
  function apply(values: FilterValues) {
    form.clearErrors();
    if (values.q.includes('\0') || values.q.trim().length > 200) { form.setError('q', { message: '搜索最多 200 个字符，不能包含 NUL 字符' }); return; }
    const from = fromUtcInput(values.created_from); const to = fromUtcInput(values.created_to);
    if (from && to && from >= to) { form.setError('created_to', { message: '结束时间必须晚于开始时间' }); return; }
    onChange(opportunitySearchSchema.parse({ ...search, ...values, created_from: from, created_to: to, page: undefined }));
  }
  return <form aria-label="GEO 机会筛选" className="min-w-0 space-y-3 rounded-lg border border-border-subtle bg-surface-panel p-4" onSubmit={(event) => void form.handleSubmit(apply)(event)}>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-w-0 space-y-1"><label className="type-label" htmlFor="opportunity-filter-q">搜索机会</label><Input id="opportunity-filter-q" maxLength={200} placeholder="标题、规则或当前维度名称" aria-invalid={Boolean(form.formState.errors.q)} aria-describedby={form.formState.errors.q ? 'opportunity-q-error' : undefined} {...form.register('q')} />{form.formState.errors.q && <p id="opportunity-q-error" className="text-xs text-danger" role="alert">{form.formState.errors.q.message}</p>}</div>
      {select('status', '机会状态', choices(statusLabels))}{select('priority', '机会优先级', choices(priorityLabels))}{select('rule_code', '触发规则', choices(ruleLabels))}
    </div>
    <details><summary className="cursor-pointer text-sm">维度、创建时间与排序筛选</summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {dimensions.map(({ key, options: optionKey, label }) => {
        const items = options?.[optionKey].map((item) => ({ value: item.id, label: item.name })) ?? [];
        if (values[key] && !items.some((item) => item.value === values[key])) items.push({ value: values[key], label: `已选 ID：${values[key]}` });
        return select(key, label, [{ value: '', label: '全部' }, ...items]);
      })}
      {select('collection_mode', '采集方式', choices(modeLabels))}{select('sort', '机会排序', Object.entries(sortLabels).map(([value, label]) => ({ value, label })))}
      <div className="min-w-0 space-y-1"><label className="type-label" htmlFor="opportunity-filter-from">创建开始时间（UTC）</label><Input type="datetime-local" step="any" id="opportunity-filter-from" {...form.register('created_from')} /></div>
      <div className="min-w-0 space-y-1"><label className="type-label" htmlFor="opportunity-filter-to">创建结束时间（UTC，不含）</label><Input type="datetime-local" step="any" id="opportunity-filter-to" aria-invalid={Boolean(form.formState.errors.created_to)} aria-describedby={form.formState.errors.created_to ? 'opportunity-to-error' : undefined} {...form.register('created_to')} />{form.formState.errors.created_to && <p id="opportunity-to-error" className="text-xs text-danger" role="alert">{form.formState.errors.created_to.message}</p>}</div>
    </div><p className="mt-2 text-xs text-text-secondary">维度名称是当前元数据；选项来自全部机会引用集合，历史冻结输入见详情。</p></details>
    <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline">应用筛选</Button><Button type="button" variant="ghost" onClick={() => onChange(opportunitySearchSchema.parse({ opportunity_id: search.opportunity_id, source_page: search.source_page, source_page_size: search.source_page_size, retest_batch_id: search.retest_batch_id }))}>重置筛选</Button></div>
  </form>;
}
