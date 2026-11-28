import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Button } from '@/design-system/primitives/button';
import {
  leadershipDashboardQueryOptions,
  reportSnapshotDetailQueryOptions,
  type LeadershipDashboard,
  type LeadershipDashboardQueryParams,
} from './leadership-dashboard.api';
import { formatShortDateTime } from './leadership-dashboard.model';
import { LeadershipDashboardView } from './leadership-dashboard-sections';

export type DashboardPrintSearch = LeadershipDashboardQueryParams & {
  snapshotId?: string;
};

export function LeadershipDashboardPrintPage({ search }: { search: DashboardPrintSearch }) {
  const isSnapshot = Boolean(search.snapshotId);
  const snapshotQuery = useQuery(
    reportSnapshotDetailQueryOptions(search.snapshotId ?? '', isSnapshot),
  );
  const liveQuery = useQuery({
    ...leadershipDashboardQueryOptions(search),
    enabled: !isSnapshot,
  });

  const payload = isSnapshot
    ? (snapshotQuery.data?.dashboard_payload as LeadershipDashboard | undefined)
    : liveQuery.data;

  const isLoading = isSnapshot ? snapshotQuery.isLoading : liveQuery.isLoading;
  const error = isSnapshot ? snapshotQuery.error : liveQuery.error;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {isSnapshot && snapshotQuery.data
              ? `${snapshotQuery.data.title}（v${snapshotQuery.data.revision_no} 冻结快照）`
              : 'PartSignal GEO 效果总览汇报'}
          </h1>
          <p className="mt-1 text-xs text-text-secondary">
            {isSnapshot && snapshotQuery.data
              ? `数据截止：${formatShortDateTime(snapshotQuery.data.data_cutoff_at)} · 证据样本：${snapshotQuery.data.evidence_run_count} 条`
              : payload
                ? `实时口径生成时间：${formatShortDateTime(payload.as_of)}`
                : '正在准备汇报数据…'}
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Button onClick={() => window.print()} size="sm" type="button">
            打印 / 导出 PDF
          </Button>
          <Link
            className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-panel px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
            to={isSnapshot ? '/geo/dashboard/snapshots' : '/geo/dashboard'}
          >
            返回
          </Link>
        </div>
      </header>

      {isLoading && <p className="text-sm text-text-secondary">正在加载打印视图数据…</p>}
      {error && (
        <InlineBanner tone="danger">
          {error instanceof Error ? error.message : '加载打印视图失败'}
        </InlineBanner>
      )}
      {payload && <LeadershipDashboardView data={payload} isPrint />}
    </div>
  );
}
