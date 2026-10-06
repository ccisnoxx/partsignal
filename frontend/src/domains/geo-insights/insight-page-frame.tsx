import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/design-system/primitives/button';
import { InsightFilters } from './insight-filters';
import { InsightDrilldown } from './insight-drilldown';
import { baseParams, type Drilldown } from './insights.model';
import { normalizeSearch, openDrilldown, type InsightSearch } from './drilldown.model';

export type InsightPageProps = { search: InsightSearch; onSearchChange: (next: InsightSearch, replace?: boolean) => void };
export function useInsightNavigation(onSearchChange: InsightPageProps['onSearchChange']) {
  const focusReturn = useRef<HTMLElement | null>(null);
  const onDrilldown = useCallback((descriptor: Drilldown) => {
    if (document.activeElement instanceof HTMLElement) focusReturn.current = document.activeElement;
    onSearchChange(openDrilldown(descriptor));
  }, [onSearchChange]);
  return { onDrilldown, focusReturn };
}
export function InsightPageFrame({ title, search, onSearchChange, refresh, children, focusReturn }: InsightPageProps & { title: string; refresh: () => void; children: ReactNode; focusReturn: RefObject<HTMLElement | null> }) {
  const headerRef = useRef<HTMLHeadingElement>(null);
  const base = normalizeSearch(baseParams(search));
  return <section aria-labelledby="insights-page-title" className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2"><h1 id="insights-page-title" className="type-page-title" ref={headerRef} tabIndex={-1}>{title}</h1><p className="text-text-secondary">回答级监测结果。各维度独立展示，无统一 GEO 分数。</p></div><Button variant="outline" onClick={refresh}>刷新汇总</Button></header>
    <nav aria-label="GEO 分析页面" className="flex flex-wrap gap-4 text-sm"><Link to="/geo/overview" search={base} className="text-primary underline underline-offset-4">总览</Link><Link to="/geo/insights/answers" search={base} className="text-primary underline underline-offset-4">回答洞察</Link><Link to="/geo/reports" search={base} className="text-primary underline underline-offset-4">报告预览</Link><Link to="/geo/insights" className="text-primary underline underline-offset-4">文章关系洞察</Link></nav>
    <InsightFilters key={JSON.stringify(base)} search={base} onApply={(next) => onSearchChange(normalizeSearch(next))} />
    {children}
    <InsightDrilldown search={search} onSearchChange={onSearchChange} finalFocus={() => focusReturn.current?.isConnected ? focusReturn.current : headerRef.current} />
  </section>;
}
