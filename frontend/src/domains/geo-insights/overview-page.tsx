import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/primitives/button';
import { TableShell } from '@/design-system/data-table/table-shell';
import { overviewOptions } from './insights.api';
import { canShowSnapshot, CellIdentity, ExclusionTable, InsightSection, MetricCards, MetricReadout, ReadFailure } from './insights-components';
import { InsightPageFrame, useInsightNavigation, type InsightPageProps } from './insight-page-frame';
import { formatTime, type OnDrilldown, type Overview } from './insights.model';

export function OverviewPage(props: InsightPageProps) {
  const query = useQuery(overviewOptions(props.search));
  const { onDrilldown, focusReturn } = useInsightNavigation(props.onSearchChange);
  return <InsightPageFrame {...props} focusReturn={focusReturn} title="GEO 总览" refresh={() => void query.refetch()}>
    {query.isFetching && <p role="status">{query.data ? '正在刷新总览…' : '正在读取总览…'}</p>}
    {query.error && <ReadFailure error={query.error} retained={!!query.data} retry={() => void query.refetch()} />}
    {canShowSnapshot(query.error) && query.data && <OverviewContent overview={query.data} onDrilldown={onDrilldown} />}
  </InsightPageFrame>;
}
function OverviewContent({ overview, onDrilldown }: { overview: Overview; onDrilldown: OnDrilldown }) {
  return <div className="min-w-0 space-y-5"><p className="text-xs text-text-secondary">快照时间：{formatTime(overview.as_of)} · 全部区块共享同一筛选</p>
    {overview.data_quality.candidate_run_count === 0 && <p role="status" className="rounded-md border border-border-subtle p-4">当前筛选没有运行样本。可调整日期、对象或采集条件；指标空值表示不可计算。</p>}
    <InsightSection id="overview-cards" title="运行与数据指标"><MetricCards metrics={overview.cards} onDrilldown={onDrilldown} /></InsightSection>
    <InsightSection id="overview-performance" title="监测对象表现">{!overview.metric_cells.length && <p>当前筛选没有对象指标。</p>}{overview.metric_cells.map((cell) => <div className="space-y-3 border-t border-border-subtle pt-4" key={cell.cell_key}><CellIdentity cell={cell} /><MetricCards metrics={cell.cards} onDrilldown={onDrilldown} /></div>)}</InsightSection>
    <InsightSection id="overview-products" title="关键产品"><p className="text-sm text-text-secondary">产品按独立维度单元展示，不跨观测面、采集模式或版本合并。</p>{!overview.key_products.length && <p>当前筛选没有关键产品。</p>}{overview.key_products.map((cell) => <div className="space-y-3" key={cell.cell_key}><CellIdentity cell={cell} /><MetricCards metrics={cell.cards} onDrilldown={onDrilldown} /></div>)}</InsightSection>
    <InsightSection id="overview-risks" title="事实风险摘要">{!overview.risks.length && <p>当前筛选没有风险维度单元。</p>}{overview.risks.map((risk) => <div className="space-y-2" key={risk.cell_key}><p className="break-all text-sm">对象 {risk.subject_id} · 单元 {risk.cell_key}</p><MetricReadout metric={risk.severe_error} onDrilldown={onDrilldown} /></div>)}</InsightSection>
    <InsightSection id="overview-batches" title="近期批次">{!overview.recent_batches.length ? <p>当前筛选没有批次。</p> : <TableShell regionLabel="近期批次表"><thead><tr><th scope="col">批次 / 创建时间</th><th scope="col">当前筛选运行数</th><th scope="col">服务端状态计数</th><th scope="col">样本</th></tr></thead><tbody>{overview.recent_batches.map((batch) => <tr key={batch.batch_id}><th scope="row" className="break-all">{batch.batch_id}<p className="text-xs">{formatTime(batch.created_at)}</p></th><td>{batch.candidate_run_count}</td><td>{Object.entries(batch.status_counts).map(([status, count]) => <p key={status}>{status}：{count}</p>)}</td><td><Button variant="outline" size="sm" onClick={() => onDrilldown(batch.drilldown)}>查看批次样本</Button></td></tr>)}</tbody></TableShell>}</InsightSection>
    <InsightSection id="overview-quality" title="数据质量摘要"><p className="text-sm">候选运行 {overview.data_quality.candidate_run_count} · 合格 {overview.data_quality.eligible_run_count} · 排除 {overview.data_quality.excluded_run_count} · 完整维度单元 {overview.data_quality.dimension_count}</p><ExclusionTable reasons={overview.data_quality.exclusion_reason_counts}/><MetricCards metrics={overview.data_quality.cards} onDrilldown={onDrilldown}/></InsightSection>
    <InsightSection id="overview-opportunities" title="机会状态"><p className="text-sm text-text-secondary">机会行动闭环尚未实现（{overview.open_opportunities.reason_code}）。当前没有可用的机会计数。</p></InsightSection>
    <p className="text-xs text-text-secondary">趋势、SOV、引用与声明明细请进入回答洞察。导出、报告与行动闭环不在本页面交付范围。</p>
  </div>;
}
