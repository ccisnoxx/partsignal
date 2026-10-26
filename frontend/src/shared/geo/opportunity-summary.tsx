import type { components } from '@/shared/api/generated/schema';
import { priorityLabels, statusLabels } from '@/shared/lib/geo-opportunity-labels';
import { TableShell } from '@/design-system/data-table/table-shell';

type Summary = components['schemas']['GeoOpportunitySummary'];
export function opportunitySummaryHref(drilldown: Summary['drilldown']) {
  const params = new URLSearchParams({ source_scope: JSON.stringify(drilldown.source_scope), open_only: String(drilldown.open_only) });
  if (drilldown.status !== null) params.set('status', drilldown.status);
  if (drilldown.priority !== null) params.set('priority', drilldown.priority);
  return `/geo/opportunities?${params}`;
}

export function OpportunitySummary({ summary }: { summary: Summary }) {
  return <div className="min-w-0 space-y-3 text-sm">
    <p className="type-label">待处理机会：{summary.open_count}</p>
    <p className="text-text-secondary">机会状态统计截止：{new Date(summary.as_of).toLocaleString('zh-CN', { hour12: false })}</p>
    <p className="text-text-secondary">按关联来源运行的创建时间与冻结输入筛选，包含历史及复测来源；同一机会只计一次。这里展示当前待处理状态，机会创建时间与此窗口不同。</p>
    {summary.open_count === 0 && <p>当前来源范围没有待处理机会。</p>}
    <a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={opportunitySummaryHref(summary.drilldown)}>查看该范围的待处理机会</a>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <TableShell regionLabel="待处理机会状态分布" className="geo-report-table-region">
        <thead><tr><th scope="col">状态</th><th scope="col">机会数</th></tr></thead>
        <tbody>{summary.by_status.map((group) => <tr key={group.status}>
          <th className="font-normal" scope="row">{statusLabels[group.status]}</th>
          <td><a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={opportunitySummaryHref(group.drilldown)} aria-label={`查看${statusLabels[group.status]}机会 ${group.count} 项`}>{group.count}</a></td>
        </tr>)}</tbody>
      </TableShell>
      <TableShell regionLabel="待处理机会优先级分布" className="geo-report-table-region">
        <thead><tr><th scope="col">优先级</th><th scope="col">机会数</th></tr></thead>
        <tbody>{summary.by_priority.map((group) => <tr key={group.priority}>
          <th className="font-normal" scope="row">{priorityLabels[group.priority]}</th>
          <td><a className="inline-flex min-h-11 items-center text-interaction-primary underline" href={opportunitySummaryHref(group.drilldown)} aria-label={`查看${priorityLabels[group.priority]}优先级机会 ${group.count} 项`}>{group.count}</a></td>
        </tr>)}</tbody>
      </TableShell>
    </div>
    <p className="text-text-secondary">读取汇总不会重新评估机会或创建行动。进入工作台后以最新读取为准，机会状态可能已变化。</p>
  </div>;
}
