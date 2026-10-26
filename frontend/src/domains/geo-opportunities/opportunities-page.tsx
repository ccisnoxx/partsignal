import { useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import { opportunityListOptions } from './opportunities.api';
import { formatTime, opportunityExportUrl, opportunitySearchSchema, type Opportunity, type OpportunitySearch } from './opportunities.model';
import { canRetryOpportunityRead, canShowOpportunitySnapshot, OpportunityReadFailure } from './opportunity-controls';
import { OpportunityDrawer } from './opportunity-detail';
import { OpportunityFilters } from './opportunity-filters';
import { OpportunitySchedule } from './opportunity-schedule';
import { OpportunityEvaluation } from './opportunity-evaluation';
import { OpportunityTable } from './opportunity-list';

export function OpportunitiesPage({ search, csrfToken, onSearchChange, isAdmin = false }: { isAdmin?: boolean; search: OpportunitySearch; csrfToken: string | null; onSearchChange: (search: OpportunitySearch, replace?: boolean) => void }) {
  const query = useQuery(opportunityListOptions(search));
  const data = canShowOpportunitySnapshot(query.error) ? query.data : undefined;
  const focusReturn = useRef<HTMLElement | null>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const [intent, setIntent] = useState<{ id: string; action?: components['schemas']['GeoOpportunityAction'] }>();
  const currentNavigation = useRef({ search, onSearchChange });
  useLayoutEffect(() => { currentNavigation.current = { search, onSearchChange }; }, [search, onSearchChange]);
  const change = useCallback((patch: Partial<OpportunitySearch>) => onSearchChange(opportunitySearchSchema.parse({ ...search, ...patch })), [search, onSearchChange]);
  const open = useCallback((opportunity: Opportunity, action?: components['schemas']['GeoOpportunityAction'], focus?: HTMLElement | null) => {
    focusReturn.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setIntent({ id: opportunity.id, action });
    const current = currentNavigation.current;
    current.onSearchChange(opportunitySearchSchema.parse({ ...current.search, opportunity_id: opportunity.id, source_page: undefined, source_page_size: undefined, retest_batch_id: undefined }));
  }, []);
  return <section aria-labelledby="opportunities-title" className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><h1 className="type-page-title" id="opportunities-title" ref={pageHeading} tabIndex={-1}>GEO 机会工作台</h1><p className="text-text-secondary">追溯历史证据、比较复测结果，并依据服务端动作显式处理机会。</p></div><div className="flex flex-wrap items-center gap-3">{data && !query.error && <a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={opportunityExportUrl(search)} target="_blank" rel="noopener noreferrer">导出机会 CSV</a>}{canRetryOpportunityRead(query.error) && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新列表</Button>}</div></header>
    <p className="text-sm text-text-secondary">CSV 导出覆盖当前筛选的全部机会，不受页码限制。服务端流式发送；空集或无权限返回明确错误，点击下载不代表传输完成。</p>
    {isAdmin && <><OpportunityEvaluation csrfToken={csrfToken} /><OpportunitySchedule csrfToken={csrfToken} /></>}
    <OpportunityFilters key={JSON.stringify(search)} search={search} options={data?.filter_options} onChange={onSearchChange} />
    {query.isFetching && <p className="text-sm" role="status">{query.data ? '正在刷新机会列表…' : '正在读取机会列表…'}</p>}
    {query.error && <OpportunityReadFailure error={query.error} retained={Boolean(query.data)} onRetry={() => void query.refetch()} />}
    {data && <><OpportunityTable items={data.items} selected={search.opportunity_id} onOpen={open} /><TablePagination pageIndex={(search.page ?? 1) - 1} pageSize={search.page_size ?? 20} pageCount={Math.ceil(data.total / (search.page_size ?? 20))} totalItems={data.total} onPageIndexChange={(index) => change({ page: index + 1 })} onPageSizeChange={(size) => change({ page_size: size === 20 ? undefined : size as 10 | 50, page: undefined })} />{!data.items.length && (search.page ?? 1) > 1 && <Button type="button" variant="outline" onClick={() => change({ page: undefined })}>返回第一页</Button>}<p className="text-xs text-text-muted">列表快照截止：{formatTime(data.as_of)}</p></>}
    <OpportunityDrawer search={search} csrfToken={csrfToken} onChange={onSearchChange} intent={intent?.id === search.opportunity_id ? intent?.action : undefined} finalFocus={() => focusReturn.current?.isConnected ? focusReturn.current : pageHeading.current} />
  </section>;
}
