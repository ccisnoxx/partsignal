import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  createReportSnapshot,
  dashboardKeys,
  reportSnapshotDetailQueryOptions,
  reportSnapshotsQueryOptions,
  type LeadershipDashboard,
} from './leadership-dashboard.api';
import { formatShortDateTime, snapshotKindLabels } from './leadership-dashboard.model';
import { LeadershipDashboardView } from './leadership-dashboard-sections';
import { LeadershipEvidenceDrawer, type EvidenceSelection } from './leadership-evidence-drawer';

type Props = {
  canOperate: boolean;
  csrfToken: string | null;
};

export function ReportSnapshotsPage({ canOperate, csrfToken }: Props) {
  const queryClient = useQueryClient();
  const listQuery = useQuery(reportSnapshotsQueryOptions());
  const [selectedId, setSelectedId] = useState<string>('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [evidenceSelection, setEvidenceSelection] = useState<EvidenceSelection | null>(null);

  const activeId = selectedId || listQuery.data?.items[0]?.id || '';
  const detailQuery = useQuery(reportSnapshotDetailQueryOptions(activeId, Boolean(activeId)));

  const reviseMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      if (!detailQuery.data) throw new Error('请先选择待更正的冻结快照');
      if (!correctionReason.trim()) throw new Error('请填写更正原因');
      const base = detailQuery.data;
      const scope = base.filter_scope as {
        bucket_granularity?: 'DAY' | 'WEEK';
        product_id?: string | null;
        surface_id?: string | null;
        collection_mode?: 'MANUAL' | 'API' | 'BROWSER' | null;
      };
      return createReportSnapshot(
        {
          report_kind: base.report_kind,
          title: base.title,
          period_from: base.period_from,
          period_to: base.period_to,
          bucket_granularity: scope.bucket_granularity ?? 'DAY',
          product_id: scope.product_id ?? null,
          surface_id: scope.surface_id ?? null,
          collection_mode: scope.collection_mode ?? null,
          summary_notes: correctionNotes.trim() || base.summary_notes,
          supersedes_snapshot_id: base.id,
          correction_reason: correctionReason.trim(),
        },
        csrfToken,
      );
    },
    onSuccess: async (created) => {
      setCorrectionOpen(false);
      setCorrectionReason('');
      setCorrectionNotes('');
      setErrorMsg(null);
      setFeedback(`已生成更正新版 v${created.revision_no}，旧版记录保持不可变留档。`);
      setSelectedId(created.id);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.snapshots });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '创建更正版本失败'),
  });

  const frozenPayload = detailQuery.data?.dashboard_payload as LeadershipDashboard | undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Link
            className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-panel px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
            to="/geo/dashboard"
          >
            返回实时看板
          </Link>
        }
        description="所有已冻结周/月报快照在数据库中只读不可变；补录后如需纳入周报，可基于旧版创建带更正原因的新版本。"
        title="冻结周报与历史快照"
      />

      {feedback && <InlineBanner tone="success">{feedback}</InlineBanner>}
      {errorMsg && <InlineBanner tone="danger">{errorMsg}</InlineBanner>}

      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-xl border border-border-subtle bg-surface-panel p-3">
          <h2 className="px-1 text-xs font-semibold text-text-secondary">快照版本列表</h2>
          {listQuery.isLoading && <p className="p-2 text-xs text-text-tertiary">正在加载快照列表…</p>}
          {listQuery.data && listQuery.data.items.length === 0 && (
            <p className="p-2 text-xs text-text-secondary">
              尚无冻结快照。可在效果总览页面点击“冻结周报快照”生成首份汇报定稿。
            </p>
          )}
          <ul className="space-y-1.5">
            {listQuery.data?.items.map((snap) => (
              <li key={snap.id}>
                <button
                  className={`w-full rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    snap.id === activeId
                      ? 'border-primary bg-surface-selected'
                      : 'border-border-subtle bg-surface-app hover:bg-surface-raised'
                  }`}
                  onClick={() => {
                    setSelectedId(snap.id);
                    setCorrectionOpen(false);
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-text-primary">{snap.title}</span>
                    <Badge variant="outline">v{snap.revision_no}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-text-secondary">
                    {snapshotKindLabels[snap.report_kind] ?? snap.report_kind} · 证据{' '}
                    {snap.evidence_run_count} 条
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    截止：{formatShortDateTime(snap.data_cutoff_at)} · {snap.created_by_name ?? '系统'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="space-y-4">
          {detailQuery.data && (
            <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-text-primary">
                      {detailQuery.data.title}
                    </h2>
                    <Badge variant="info">v{detailQuery.data.revision_no} 只读冻结</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    数据截止时间：{formatShortDateTime(detailQuery.data.data_cutoff_at)} · 创建人：
                    {detailQuery.data.created_by_name ?? '系统'}
                  </p>
                  {detailQuery.data.correction_reason && (
                    <p className="mt-1 text-xs text-text-warning">
                      更正说明：{detailQuery.data.correction_reason}
                    </p>
                  )}
                  {detailQuery.data.summary_notes && (
                    <p className="mt-1 text-xs text-text-primary">
                      汇报摘要：{detailQuery.data.summary_notes}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-app px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
                    search={{ snapshotId: detailQuery.data.id }}
                    to="/geo/dashboard/print"
                  >
                    打印此快照
                  </Link>
                  {canOperate && (
                    <Button
                      onClick={() => setCorrectionOpen((prev) => !prev)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      基于此版创建更正新版
                    </Button>
                  )}
                </div>
              </div>

              {canOperate && correctionOpen && (
                <div className="space-y-3 border-t border-border-subtle pt-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-xs">
                      <span className="text-text-secondary">更正原因（必填）</span>
                      <Input
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        placeholder="例如：补录上周三遗漏的 5 条元宝观测证据"
                        value={correctionReason}
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-text-secondary">新版摘要（可选）</span>
                      <Input
                        onChange={(e) => setCorrectionNotes(e.target.value)}
                        placeholder="留空则沿用上一版本摘要"
                        value={correctionNotes}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={reviseMutation.isPending}
                      onClick={() => reviseMutation.mutate()}
                      size="sm"
                      type="button"
                    >
                      {reviseMutation.isPending ? '正在生成新版…' : '生成更正新版'}
                    </Button>
                    <Button
                      onClick={() => setCorrectionOpen(false)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {frozenPayload && (
            <LeadershipDashboardView
              data={frozenPayload}
              onInspectEvidence={setEvidenceSelection}
            />
          )}
        </section>
      </div>

      <LeadershipEvidenceDrawer
        onClose={() => setEvidenceSelection(null)}
        selection={evidenceSelection}
      />
    </div>
  );
}
