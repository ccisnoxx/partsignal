import { useQuery } from '@tanstack/react-query';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { answerInsightOptions } from './insights.api';
import { canShowSnapshot, ReadFailure } from './insights-components';
import { InsightPageFrame, useInsightNavigation, type InsightPageProps } from './insight-page-frame';
import { PerformanceSections } from './performance-sections';
import { CitationInsights, FactRisks, InsightDataQuality } from './evidence-sections';
import { formatTime } from './insights.model';

export function AnswerInsightsPage(props: InsightPageProps) {
  const query = useQuery(answerInsightOptions(props.search));
  const { onDrilldown, focusReturn } = useInsightNavigation(props.onSearchChange);
  return <InsightPageFrame {...props} activeTab="answers" focusReturn={focusReturn} title="GEO 回答洞察" refresh={() => void query.refetch()}>
    <nav aria-label="回答洞察区块" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-panel p-2 text-xs shadow-[var(--shadow-panel)]">
      {[['visibility', '可见性'], ['trends', '趋势'], ['matrix', '产品矩阵'], ['questions', '问题覆盖'], ['platforms', '平台表现'], ['sov', 'SOV'], ['citations', '引用'], ['risks', '风险'], ['quality', '数据质量']].map(([id, label]) => (
        <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:bg-surface-raised hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {label}
        </a>
      ))}
    </nav>
    {query.isFetching && (
      <div className="space-y-3">
        <p className="text-xs text-text-secondary" role="status">{query.data ? '正在刷新洞察…' : '正在读取洞察…'}</p>
        {!query.data && <Skeleton className="h-64 rounded-xl" />}
      </div>
    )}
    {query.error && <ReadFailure error={query.error} retained={!!query.data} retry={() => void query.refetch()} />}
    {canShowSnapshot(query.error) && query.data && <div className="min-w-0 space-y-5"><p className="text-xs text-text-tertiary">快照时间：{formatTime(query.data.as_of)} · 全部区块共享同一筛选</p>
      {query.data.data_quality.overview.candidate_run_count === 0 && <InlineBanner tone="info">当前筛选没有运行样本。调整筛选后重新读取；空值不会展示为零。</InlineBanner>}
      <PerformanceSections insights={query.data} onDrilldown={onDrilldown} />
      <CitationInsights insights={query.data} onDrilldown={onDrilldown} /><FactRisks insights={query.data} onDrilldown={onDrilldown} /><InsightDataQuality insights={query.data} onDrilldown={onDrilldown} />
      <InlineBanner role="status" tone="info">
        本页面尚未整合机会计数或业务动作，当前仅展示回答级分析与证据。请进入 <a className="font-medium text-primary underline underline-offset-4" href="/geo/opportunities">GEO 机会工作台</a> 查看证据、比较复测结果并处理机会；行动创建与复测批次创建可通过现有 Action/Retest API 完成。
      </InlineBanner>
    </div>}
  </InsightPageFrame>;
}
