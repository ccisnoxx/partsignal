import type { ReactNode } from 'react';

import { TableShell } from '@/design-system/data-table/table-shell';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import {
  contentInsightHref,
  coverageInsightHref,
  formatInsightChange,
  formatInsightRate,
  observationListHref,
} from './geo-insights.model';

type GeoInsights = components['schemas']['GeoInsights'];
type GeoInsightOptimizationAction = components['schemas']['GeoInsightOptimizationAction'];
type GeoInsightRateTrend = components['schemas']['GeoInsightRateTrend'];
type GeoInsightContentPerformance = components['schemas']['GeoInsightContentPerformance'];
type GeoInsightCoverageItem = components['schemas']['GeoInsightCoverageItem'];

type OptimizationContext = {
  action: GeoInsightOptimizationAction;
  initialPlatformId?: string;
  initialProductId?: string;
  label: string;
};

type GeoInsightsReportProps = {
  data: GeoInsights;
  variant: 'print';
} | {
  data: GeoInsights;
  onOptimize: (context: OptimizationContext) => void;
  variant: 'screen';
};

const coverageLabels = {
  STABLE: '稳定覆盖',
  OCCASIONAL: '偶尔提及',
  UNCOVERED: '未覆盖',
  INSUFFICIENT_DATA: '样本不足',
} satisfies Record<GeoInsightCoverageItem['status'], string>;

function GeoInsightsReport(props: GeoInsightsReportProps) {
  const { data, variant } = props;
  const onOptimize = variant === 'screen' ? props.onOptimize : undefined;
  return (
    <div className={variant === 'print' ? 'geo-insights-print-report min-w-0 space-y-8' : 'min-w-0 space-y-8'}>
      <section aria-labelledby="trend-title" className="geo-insights-print-section space-y-3">
        <h2 className="type-section-title" id="trend-title">核心趋势</h2>
        <div className="geo-insights-print-trend-grid grid gap-4 lg:grid-cols-3">
          <TrendCard label="发现率" trend={data.trends.discovery_rate} variant={variant} />
          <TrendCard label="提及率" trend={data.trends.mention_rate} variant={variant} />
          <TrendCard label="准确率" trend={data.trends.accuracy_rate} variant={variant} />
        </div>
      </section>

      <InsightSection title="平台表现">
        <ReportTable regionLabel="GEO 平台表现" variant={variant}>
          <thead><tr><th>平台</th><th>样本</th><th>发现率</th><th>提及率</th><th>准确率</th>{variant === 'screen' && <th>操作</th>}</tr></thead>
          <tbody>{data.platform_performance.map((item) => (
            <tr key={item.geo_platform}>
              <td data-label="平台">{item.geo_platform}</td>
              <td data-label="样本">{item.observation_count}</td>
              <td data-label="发现率">{formatInsightRate(item.discovery_rate)}</td>
              <td data-label="提及率">{formatInsightRate(item.mention_rate)}</td>
              <td data-label="准确率">{formatInsightRate(item.accuracy_rate)}</td>
              {variant === 'screen' && <td data-label="操作"><a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={observationListHref(data.period.current, { geoPlatform: item.geo_platform })}>查看观测</a></td>}
            </tr>
          ))}</tbody>
        </ReportTable>
        {data.platform_performance.length === 0 && <EmptyMessage>当前筛选范围没有平台表现数据。</EmptyMessage>}
      </InsightSection>

      <InsightSection title="内容表现">
        <ContentTable items={data.content_rankings.best} label="最佳内容" onOptimize={onOptimize} period={data.period.current} variant={variant} />
        <ContentTable items={data.content_rankings.declining} label="下降内容" onOptimize={onOptimize} period={data.period.current} variant={variant} />
        <ContentTable items={data.content_rankings.long_unmentioned} label="长期未提及" onOptimize={onOptimize} period={data.period.current} variant={variant} />
      </InsightSection>

      <InsightSection title="问题覆盖">
        <p className="text-sm text-text-secondary">
          稳定 {data.question_coverage.by_status.stable} · 偶尔 {data.question_coverage.by_status.occasional} · 未覆盖 {data.question_coverage.by_status.uncovered} · 样本不足 {data.question_coverage.by_status.insufficient_data}
        </p>
        <ReportTable regionLabel="问题覆盖矩阵" variant={variant}>
          <thead><tr><th>问题</th><th>GEO 平台</th><th>状态</th><th>样本</th><th>覆盖率</th>{variant === 'screen' && <th>操作</th>}</tr></thead>
          <tbody>{data.question_coverage.matrix.map((item) => (
            <tr key={`${item.query_topic_id}:${item.geo_platform}`}>
              <td data-label="问题">{item.canonical_question}</td>
              <td data-label="GEO 平台">{item.geo_platform}</td>
              <td data-label="状态">{coverageLabels[item.status]}</td>
              <td data-label="样本">{item.mentioned_observation_count}/{item.observation_count}</td>
              <td data-label="覆盖率">{formatInsightRate(item.coverage_rate)}</td>
              {variant === 'screen' && <td data-label="操作"><CoverageAction item={item} onOptimize={props.onOptimize} period={data.period.current} /></td>}
            </tr>
          ))}</tbody>
        </ReportTable>
        {data.question_coverage.matrix.length === 0 && <EmptyMessage>当前筛选范围没有问题覆盖数据。</EmptyMessage>}
      </InsightSection>

      <InsightSection title="建议">
        <div className="grid gap-3 md:grid-cols-2">
          {data.recommendations.map((item, index) => (
            <article className="geo-insights-print-card rounded-xl border border-border-subtle p-4" key={`${item.rule_code}:${index}`}>
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
    </div>
  );
}

function ReportTable({ children, regionLabel, variant }: { children: ReactNode; regionLabel: string; variant: 'screen' | 'print' }) {
  if (variant === 'screen') return <TableShell regionLabel={regionLabel}>{children}</TableShell>;
  return <div aria-label={regionLabel} className="geo-insights-report-table-region" role="region"><table className="geo-insights-report-table">{children}</table></div>;
}

function TrendCard({ label, trend, variant }: { label: string; trend: GeoInsightRateTrend; variant: 'screen' | 'print' }) {
  const drawable = trend.points.map((point, index) => ({ index, value: point.value })).filter((point) => point.value !== null);
  const exactTable = (
    <ReportTable regionLabel={`${label}每日精确数据`} variant={variant}>
      <thead><tr><th>日期</th><th>分子</th><th>分母</th><th>比率</th></tr></thead>
      <tbody>{trend.points.map((point) => <tr key={point.date}><td data-label="日期">{point.date}</td><td data-label="分子">{point.numerator}</td><td data-label="分母">{point.denominator}</td><td data-label="比率">{formatInsightRate(point)}</td></tr>)}</tbody>
    </ReportTable>
  );
  return (
    <article className="geo-insights-print-card min-w-0 space-y-3 rounded-xl border border-border-subtle p-4">
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
      {variant === 'screen'
        ? <details><summary className="cursor-pointer text-sm">查看精确数据</summary>{exactTable}</details>
        : exactTable}
    </article>
  );
}

function InsightSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="geo-insights-print-section min-w-0 space-y-3"><h2 className="type-section-title">{title}</h2>{children}</section>;
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="geo-insights-print-card rounded-xl border border-dashed border-border-subtle p-4 text-sm text-text-secondary">{children}</p>;
}

function ContentTable({ items, label, onOptimize, period, variant }: { items: readonly GeoInsightContentPerformance[]; label: string; onOptimize?: (context: OptimizationContext) => void; period: GeoInsights['period']['current']; variant: 'screen' | 'print' }) {
  return (
    <div className="space-y-2"><h3 className="font-medium">{label}</h3>
      <ReportTable regionLabel={label} variant={variant}>
        <thead><tr><th>内容</th><th>平台</th><th>样本</th><th>发现率</th><th>提及率</th><th>准确率</th>{variant === 'screen' && <th>操作</th>}</tr></thead>
        <tbody>{items.map((item) => <tr key={item.published_article_id}>
          <td data-label="内容">{item.title}</td><td data-label="平台">{item.content_platform}</td><td data-label="样本">{item.observation_count}</td><td data-label="发现率">{formatInsightRate(item.discovery_rate)}</td><td data-label="提及率">{formatInsightRate(item.mention_rate)}</td><td data-label="准确率">{formatInsightRate(item.accuracy_rate)}</td>
          {onOptimize && <td data-label="操作"><ContentAction item={item} onOptimize={onOptimize} period={period} /></td>}
        </tr>)}</tbody>
      </ReportTable>
      {items.length === 0 && <EmptyMessage>没有{label}。</EmptyMessage>}
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
    <section className="geo-insights-print-card space-y-3 rounded-xl border border-border-subtle p-4" aria-labelledby="data-quality-title">
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

export { GeoInsightsReport };
export type { GeoInsightsReportProps, OptimizationContext };
