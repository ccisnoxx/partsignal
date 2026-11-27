import { FormProvider, useForm } from 'react-hook-form';
import { FilterChipsBar, type FilterChipItem } from '@/design-system/data-table/filter-chips';
import { FormField } from '@/design-system/forms/form-field';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { MetadataDisclosure } from '@/design-system/primitives/metadata-disclosure';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { baseShape, cleanRecord, defaultWindow, identityFilters, modeLabels, normalizeBase, splitValues, type BaseSearch } from './insights.model';

type IdKey = typeof identityFilters[number][0];
type Draft = Record<IdKey | 'language_codes' | 'region_codes', string> & {
  date_from: string; date_to: string; collection_modes: BaseSearch['collection_modes'];
  login_states: BaseSearch['login_states']; intent_types: BaseSearch['intent_types'];
  mention_mode: 'ALL' | 'BRANDED' | 'UNBRANDED'; review_policy: 'EFFECTIVE' | 'REVIEWED_ONLY';
};
function draftFrom(search: BaseSearch): Draft {
  return { ...Object.fromEntries(identityFilters.map(([key]) => [key, search[key]?.join(', ') ?? ''])) as Record<IdKey, string>,
    date_from: search.date_from, date_to: search.date_to, language_codes: search.language_codes?.join(', ') ?? '', region_codes: search.region_codes?.join(', ') ?? '',
    collection_modes: search.collection_modes ?? [], login_states: search.login_states ?? [], intent_types: search.intent_types ?? [],
    mention_mode: search.mention_mode ?? 'ALL', review_policy: search.review_policy ?? 'EFFECTIVE' };
}
export function InsightFilters({ search, onApply }: { search: BaseSearch; onApply: (search: BaseSearch) => void }) {
  const form = useForm<Draft>({ defaultValues: draftFrom(search) });
  const textKeys = [...identityFilters, ['language_codes', '语言代码'], ['region_codes', '地区代码']] as const;
  const apply = (draft: Draft) => {
    form.clearErrors();
    const result = baseShape.superRefine((value, ctx) => {
      if (new Date(value.date_from) >= new Date(value.date_to)) ctx.addIssue({ code: 'custom', path: ['date_to'], message: '结束时间必须晚于开始时间' });
    }).safeParse({ ...draft, ...Object.fromEntries(textKeys.map(([key]) => [key, draft[key].trim() ? splitValues(draft[key]) : undefined])),
      mention_mode: draft.mention_mode === 'ALL' ? undefined : draft.mention_mode,
      review_policy: draft.review_policy === 'EFFECTIVE' ? undefined : draft.review_policy });
    if (!result.success) {
      result.error.issues.forEach((issue, index) => form.setError(issue.path[0] as keyof Draft, { message: issue.code === 'custom' ? issue.message : '请按格式填写，列表最多 50 项；ID 使用完整 UUID，时间须包含时区' }, { shouldFocus: index === 0 }));
      return;
    }
    onApply(normalizeBase(cleanRecord(result.data)));
  };
  const select = (name: 'mention_mode' | 'review_policy', label: string, items: { value: string; label: string }[]) => (
    <FormField<Draft, typeof name> name={name} label={label} render={({ field, inputId, ...aria }) => (
      <Select items={items} value={field.value} onValueChange={(value) => value && field.onChange(value)}>
        <SelectTrigger id={inputId} ref={field.ref} aria-invalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );
  const activeChips: FilterChipItem[] = [
    ...(search.mention_mode ? [{ key: 'mention_mode', label: `点名：${search.mention_mode === 'BRANDED' ? '点名' : '不点名'}`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, mention_mode: undefined }))) }] : []),
    ...(search.review_policy ? [{ key: 'review_policy', label: '复核：仅有效复核', onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, review_policy: undefined }))) }] : []),
    ...(search.collection_modes?.length ? [{ key: 'collection_modes', label: `采集模式：${search.collection_modes.map((m) => modeLabels[m]).join('、')}`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, collection_modes: undefined }))) }] : []),
    ...(search.login_states?.length ? [{ key: 'login_states', label: `登录态：${search.login_states.length} 项`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, login_states: undefined }))) }] : []),
    ...(search.intent_types?.length ? [{ key: 'intent_types', label: `问题意图：${search.intent_types.length} 项`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, intent_types: undefined }))) }] : []),
    ...(search.language_codes?.length ? [{ key: 'language_codes', label: `语言：${search.language_codes.join('、')}`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, language_codes: undefined }))) }] : []),
    ...(search.region_codes?.length ? [{ key: 'region_codes', label: `地区：${search.region_codes.join('、')}`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, region_codes: undefined }))) }] : []),
    ...identityFilters.flatMap(([key, label]) => search[key]?.length
      ? [{ key, label: `${label}：${search[key].length} 项`, onRemove: () => onApply(normalizeBase(cleanRecord({ ...search, [key]: undefined }))) }]
      : []),
  ];

  return <FormProvider {...form}><form aria-label="GEO 洞察筛选" onSubmit={form.handleSubmit(apply)} className="space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-[var(--shadow-panel)]">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(['date_from', 'date_to'] as const).map((name) => <FormField<Draft, typeof name> key={name} name={name} label={name === 'date_from' ? '开始时间（含）' : '结束时间（不含）'} required description="ISO 8601，须含时区，例如 2026-10-01T00:00:00Z" render={({ field, inputId, ...aria }) => <Input {...field} id={inputId} aria-invalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']} aria-required />}/>)}
      {select('mention_mode', '点名属性', [{ value: 'ALL', label: '全部点名属性（分维度展示）' }, { value: 'UNBRANDED', label: '不点名' }, { value: 'BRANDED', label: '点名' }])}
      {select('review_policy', '复核口径', [{ value: 'EFFECTIVE', label: '有效分析（含有效复核）' }, { value: 'REVIEWED_ONLY', label: '仅有效复核' }])}
    </div>
    <MetadataDisclosure summary="对象、平台与采集条件" summaryMeta={activeChips.length ? `已选 ${activeChips.length} 项` : undefined}>
      <p className="mt-1 text-xs text-text-secondary">多项用逗号分隔。当前筛选使用资源 ID；采集模式、登录状态和点名属性始终保留独立维度。</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {textKeys.map(([name, label]) => <FormField<Draft, typeof name> key={name} name={name} label={label} description={name === 'language_codes' ? '例如 zh-CN, en' : name === 'region_codes' ? '两位地区代码，例如 CN, US' : 'UUID，可从资源页面复制'} render={({ field, inputId, ...aria }) => <Input {...field} id={inputId} aria-invalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']} />}/>)}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {([['collection_modes', '采集模式', Object.entries(modeLabels)], ['login_states', '登录状态', [['ANONYMOUS', '匿名'], ['AUTHENTICATED', '已登录'], ['NOT_APPLICABLE', '不适用']]], ['intent_types', '问题意图', [['BRAND', '品牌'], ['PRODUCT', '产品'], ['REPLACEMENT', '替代'], ['COMPARISON', '比较'], ['APPLICATION', '应用'], ['TROUBLESHOOTING', '故障排查']]]] as const).map(([name, label, items]) => <fieldset key={name} className="space-y-2"><legend className="type-label">{label}</legend>{items.map(([value, title]) => <label key={value} className="flex items-center gap-2 text-sm"><input className="size-4 accent-primary" type="checkbox" value={value} {...form.register(name)} />{title}</label>)}</fieldset>)}
      </div>
    </MetadataDisclosure>
    {activeChips.length > 0 && (
      <FilterChipsBar
        className="border-t border-border-subtle pt-3"
        items={activeChips}
        onClearAll={() => onApply(normalizeBase({ date_from: search.date_from, date_to: search.date_to }))}
      />
    )}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2"><Button type="submit">应用筛选</Button><Button type="button" variant="outline" onClick={() => onApply(defaultWindow())}>重置筛选</Button></div>
      <p className="text-xs text-text-tertiary">筛选同步到 URL，并作用于此页所有区块及明细。样本等级由服务端判断；未选择的条件表示全部。</p>
    </div>
  </form></FormProvider>;
}
