import { useQuery } from '@tanstack/react-query';
import { answerInsightOptions } from './insights.api';
import { canShowSnapshot, ReadFailure } from './insights-components';
import { InsightPageFrame, useInsightNavigation, type InsightPageProps } from './insight-page-frame';
import { PerformanceSections } from './performance-sections';
import { CitationInsights, FactRisks, InsightDataQuality } from './evidence-sections';
import { formatTime } from './insights.model';

export function AnswerInsightsPage(props: InsightPageProps) {
  const query = useQuery(answerInsightOptions(props.search));
  const { onDrilldown, focusReturn } = useInsightNavigation(props.onSearchChange);
  return <InsightPageFrame {...props} focusReturn={focusReturn} title="GEO 回答洞察" refresh={() => void query.refetch()}>
    <nav aria-label="回答洞察区块" className="flex flex-wrap gap-3 text-sm">{[['visibility', '可见性'], ['trends', '趋势'], ['matrix', '产品矩阵'], ['questions', '问题覆盖'], ['platforms', '平台表现'], ['sov', 'SOV'], ['citations', '引用'], ['risks', '风险'], ['quality', '数据质量']].map(([id, label]) => <a key={id} href={`#${id}`} className="text-primary underline underline-offset-4">{label}</a>)}</nav>
    {query.isFetching && <p role="status">{query.data ? '正在刷新洞察…' : '正在读取洞察…'}</p>}
    {query.error && <ReadFailure error={query.error} retained={!!query.data} retry={() => void query.refetch()} />}
    {canShowSnapshot(query.error) && query.data && <div className="min-w-0 space-y-5"><p className="text-xs text-text-secondary">快照时间：{formatTime(query.data.as_of)} · 全部区块共享同一筛选</p>
      {query.data.data_quality.overview.candidate_run_count === 0 && <p role="status" className="rounded-md border border-border-subtle p-4">当前筛选没有运行样本。调整筛选后重新读取；空值不会展示为零。</p>}
      <PerformanceSections insights={query.data} onDrilldown={onDrilldown} />
      <CitationInsights insights={query.data} onDrilldown={onDrilldown} /><FactRisks insights={query.data} onDrilldown={onDrilldown} /><InsightDataQuality insights={query.data} onDrilldown={onDrilldown} />
      <p className="text-sm text-text-secondary">机会行动闭环尚未实现。当前仅展示回答级分析与证据，不提供机会计数或业务动作。</p>
    </div>}
  </InsightPageFrame>;
}
