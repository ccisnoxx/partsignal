import { Link } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';
import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { PageHeader } from '@/design-system/layout/page-header';
import { SubNavTabs } from '@/design-system/layout/sub-nav-tabs';
import { Button } from '@/design-system/primitives/button';
import { InsightFilters } from './insight-filters';
import { InsightDrilldown } from './insight-drilldown';
import { baseParams, type Drilldown } from './insights.model';
import { normalizeSearch, openDrilldown, type InsightSearch } from './drilldown.model';

export type InsightPageProps = { search: InsightSearch; onSearchChange: (next: InsightSearch, replace?: boolean) => void };
export type GeoAnalyticsTab = 'overview' | 'answers' | 'reports' | 'article-insights';

export function useInsightNavigation(onSearchChange: InsightPageProps['onSearchChange']) {
  const focusReturn = useRef<HTMLElement | null>(null);
  const onDrilldown = useCallback((descriptor: Drilldown) => {
    if (document.activeElement instanceof HTMLElement) focusReturn.current = document.activeElement;
    onSearchChange(openDrilldown(descriptor));
  }, [onSearchChange]);
  return { onDrilldown, focusReturn };
}

export function InsightPageFrame({
  activeTab,
  title,
  search,
  onSearchChange,
  refresh,
  children,
  focusReturn,
}: InsightPageProps & {
  activeTab?: GeoAnalyticsTab;
  title: string;
  refresh: () => void;
  children: ReactNode;
  focusReturn: RefObject<HTMLElement | null>;
}) {
  const headerRef = useRef<HTMLHeadingElement>(null);
  const base = normalizeSearch(baseParams(search));
  const resolvedTab: GeoAnalyticsTab = activeTab ?? (title.includes('总览') ? 'overview' : 'answers');

  return (
    <section aria-labelledby="insights-page-title" className="min-w-0 space-y-5">
      <PageHeader
        actions={
          <Button onClick={refresh} size="sm" type="button" variant="outline">
            <RefreshCwIcon aria-hidden="true" className="size-3.5" />
            <span>刷新汇总</span>
          </Button>
        }
        description="回答级监测结果。各维度独立展示，无统一 GEO 分数。"
        title={title}
        titleId="insights-page-title"
        titleRef={headerRef}
        titleTabIndex={-1}
      />
      <SubNavTabs
        ariaLabel="GEO 分析页面"
        items={[
          {
            key: 'overview',
            active: resolvedTab === 'overview',
            render: (props) => <Link search={base} to="/geo/overview" {...props}>总览</Link>,
          },
          {
            key: 'answers',
            active: resolvedTab === 'answers',
            render: (props) => <Link search={base} to="/geo/insights/answers" {...props}>回答洞察</Link>,
          },
          {
            key: 'reports',
            active: resolvedTab === 'reports',
            render: (props) => <Link search={base} to="/geo/reports" {...props}>报告预览</Link>,
          },
          {
            key: 'article-insights',
            active: resolvedTab === 'article-insights',
            render: (props) => <Link search={base} to="/geo/insights" {...props}>文章关系洞察</Link>,
          },
        ]}
      />
      <InsightFilters key={JSON.stringify(base)} search={base} onApply={(next) => onSearchChange(normalizeSearch(next))} />
      {children}
      <InsightDrilldown
        search={search}
        onSearchChange={onSearchChange}
        finalFocus={() => (focusReturn.current?.isConnected ? focusReturn.current : headerRef.current)}
      />
    </section>
  );
}
