import { useQuery } from '@tanstack/react-query';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { Button } from '@/design-system/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/design-system/primitives/sheet';
import { insightDetailOptions } from './insights.api';
import { canShowSnapshot, ReadFailure } from './insights-components';
import { InsightSampleTables } from './insight-sample-tables';
import { formatTime, metricLabels, normalizeBase } from './insights.model';
import { normalizeSearch, type InsightSearch } from './drilldown.model';
import type { InsightPageProps } from './insight-page-frame';

const titles = { overview: '总览指标样本', metric: '回答指标样本', citations: '引用证据明细', claims: '事实风险明细', quality: '数据质量明细' } as const;
const cohorts = [{ value: 'CANDIDATE', label: '候选运行' }, { value: 'DENOMINATOR', label: '分母运行' }, { value: 'NUMERATOR', label: '分子运行' }, { value: 'EXCLUDED', label: '排除运行' }];
export function InsightDrilldown({ search, onSearchChange, finalFocus }: InsightPageProps & { finalFocus: () => HTMLElement | null }) {
  const query = useQuery(insightDetailOptions(search));
  const change = (patch: Partial<InsightSearch>) => onSearchChange(normalizeSearch({ ...search, ...patch }));
  const title = search.detail ? titles[search.detail] : '洞察明细';
  const choose = (label: string, value: string, items: { value: string; label: string }[], onChange: (value: string) => void) => <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>;
  return <Sheet open={!!search.detail} onOpenChange={(open) => { if (!open) onSearchChange(normalizeBase(search)); }}><SheetContent className="w-full overflow-y-auto sm:max-w-4xl" finalFocus={finalFocus}>
    <SheetHeader className="pr-12"><SheetTitle>{title}</SheetTitle><SheetDescription>服务端筛选组成样本。分析与复核记录只读；每页显示独立的快照时间。</SheetDescription></SheetHeader>
    <div className="min-w-0 space-y-4 px-4 pb-6">
      <p className="text-sm">{search.metric_code ? metricLabels[search.metric_code] : search.quality_code ?? title}</p>
      {search.cell_key && <p className="break-all text-xs text-text-secondary">单元键：{search.cell_key}</p>}
      <p className="text-xs text-text-secondary">筛选期间：{formatTime(search.date_from)} 至 {formatTime(search.date_to)}（不含）</p>
      <div className="flex flex-wrap gap-2">
        {(search.detail === 'overview' || search.detail === 'metric' || search.detail === 'quality') && choose('样本组成集合', search.cohort ?? 'DENOMINATOR', cohorts, (value) => change({ cohort: value === 'DENOMINATOR' ? undefined : value as InsightSearch['cohort'], exclusion_reason: undefined, page: undefined }))}
        {search.detail === 'metric' && <p className="self-center text-sm">{search.period === 'PREVIOUS' ? '前期样本' : '当期样本'}（来自所选维度；另一窗口请从趋势表选择）</p>}
        <Button variant="outline" onClick={() => void query.refetch()}>刷新明细</Button>
      </div>
      {query.isFetching && <p role="status">{query.data ? '正在刷新明细…' : '正在读取明细…'}</p>}
      {query.error && <ReadFailure error={query.error} retained={!!query.data} retry={() => void query.refetch()} />}
      {canShowSnapshot(query.error) && query.data && <><p className="text-xs text-text-secondary">明细快照：{formatTime(query.data.page.as_of)}</p><InsightSampleTables detail={query.data}/>
        <TablePagination pageIndex={(search.page ?? 1) - 1} pageSize={search.page_size ?? 20} totalItems={query.data.page.total} pageCount={Math.ceil(query.data.page.total / (search.page_size ?? 20))} onPageIndexChange={(index) => change({ page: index + 1 })} onPageSizeChange={(size) => change({ page_size: size === 20 ? undefined : size as 10 | 50, page: undefined })}/>
        {(search.page ?? 1) > 1 && !query.data.page.items.length && <Button variant="outline" onClick={() => change({ page: undefined })}>返回第一页</Button>}
      </>}
    </div>
  </SheetContent></Sheet>;
}
