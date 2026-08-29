import { useQuery } from '@tanstack/react-query';

import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import { geoInsightsQueryOptions } from './geo.api';
import {
  defaultGeoInsightDates,
  formatInsightGeneratedAt,
  type GeoInsightSearch,
} from './geo-insights.model';
import { GeoInsightsReport } from './geo-insights-report';

type GeoInsights = components['schemas']['GeoInsights'];

type GeoInsightsPrintPageProps = {
  onSearchChange: (search: GeoInsightSearch) => void;
  search: GeoInsightSearch;
};

function GeoInsightsPrintPage({ onSearchChange, search }: GeoInsightsPrintPageProps) {
  const insights = useQuery(geoInsightsQueryOptions(search));

  if (insights.isPending) {
    return <div aria-busy="true" className="geo-insights-print-state rounded-xl border border-border-subtle p-6">正在生成打印报告…</div>;
  }
  if (!insights.data) {
    return <PrintError error={insights.error} onReset={() => onSearchChange(defaultGeoInsightDates())} onRetry={() => void insights.refetch()} />;
  }

  let summary: Array<[string, string]>;
  try {
    summary = printFilterSummary(insights.data, search);
  } catch (error) {
    return <PrintError error={error} onReset={() => onSearchChange(defaultGeoInsightDates())} onRetry={() => void insights.refetch()} />;
  }

  const data = insights.data;
  return (
    <article className="geo-insights-print-page min-w-0 space-y-8" aria-labelledby="geo-insights-print-title">
      <header className="geo-insights-print-header space-y-5 border-b border-border-strong pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="type-page-title" id="geo-insights-print-title">GEO 洞察打印报告</h1>
            <p className="text-text-secondary">当前链尾人工观测与逐篇发布内容关系</p>
          </div>
          <div className="geo-insights-print-controls flex flex-wrap gap-2">
            <Button onClick={() => window.print()} type="button">打印</Button>
          </div>
        </div>

        <dl className="geo-insights-print-summary grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {summary.map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-text-tertiary">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
          <div className="min-w-0"><dt className="text-text-tertiary">分析单元</dt><dd className="break-words font-medium">{data.analysis_unit}</dd></div>
          <div className="min-w-0"><dt className="text-text-tertiary">生成时间</dt><dd className="break-words font-medium">{formatInsightGeneratedAt(data.generated_at)}</dd></div>
        </dl>
      </header>

      {insights.isError && (
        <div className="geo-insights-print-warning flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4" role="alert">
          <p>刷新失败，当前仍显示上一次成功快照。{errorMessage(insights.error)}</p>
          <Button className="geo-insights-print-controls" onClick={() => void insights.refetch()} type="button" variant="outline">重新加载</Button>
        </div>
      )}

      <GeoInsightsReport data={data} variant="print" />
    </article>
  );
}

function printFilterSummary(data: GeoInsights, search: GeoInsightSearch): Array<[string, string]> {
  return [
    ['时间范围', `${data.period.current.date_from} 至 ${data.period.current.date_to}`],
    ['产品', selectedLabel(search.productId, data.filter_options.products, '产品')],
    ['内容平台', selectedLabel(search.contentPlatformId, data.filter_options.content_platforms, '内容平台')],
    ['GEO 平台', selectedLabel(search.geoPlatform, data.filter_options.geo_platforms.map((label) => ({ id: label, label })), 'GEO 平台')],
    ['发布内容', selectedLabel(search.publishedArticleId, data.filter_options.publications.map((item) => ({ id: item.id, label: `${item.label} · ${item.platform_name}` })), '发布内容')],
    ['问题主题', selectedLabel(search.queryTopicId, data.filter_options.query_topics, '问题主题')],
  ];
}

function selectedLabel(id: string | undefined, options: readonly { id: string; label: string }[], label: string) {
  if (!id) return '全部';
  const option = options.find((item) => item.id === id);
  if (!option) throw new Error(`GEO 洞察打印报告缺少所选${label}的服务端标签`);
  return option.label;
}

function PrintError({ error, onReset, onRetry }: { error: unknown; onReset: () => void; onRetry: () => void }) {
  return (
    <div className="geo-insights-print-state space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5" role="alert">
      <p>{errorMessage(error)}</p>
      <div className="geo-insights-print-controls flex gap-2">
        <Button onClick={onRetry} type="button" variant="outline">重试</Button>
        <Button onClick={onReset} type="button" variant="ghost">清除筛选</Button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取失败';
}

export { GeoInsightsPrintPage };
export type { GeoInsightsPrintPageProps };
