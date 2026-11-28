import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  createReportSnapshot,
  dashboardKeys,
  leadershipDashboardQueryOptions,
  leadershipFilterOptionsQueryOptions,
  type LeadershipDashboardQueryParams,
  type ReportSnapshotKind,
} from './leadership-dashboard.api';
import {
  buildPresetDateInputs,
  dateInputToEndIso,
  dateInputToStartIso,
} from './leadership-dashboard.model';
import { LeadershipDashboardView } from './leadership-dashboard-sections';
import { LeadershipEvidenceDrawer, type EvidenceSelection } from './leadership-evidence-drawer';

type Props = {
  canOperate: boolean;
  csrfToken: string | null;
};

export function LeadershipDashboardPage({ canOperate, csrfToken }: Props) {
  const queryClient = useQueryClient();
  const initialRange = buildPresetDateInputs(7);
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [granularity, setGranularity] = useState<'DAY' | 'WEEK'>('DAY');
  const [productId, setProductId] = useState('');
  const [surfaceId, setSurfaceId] = useState('');
  const [collectionMode, setCollectionMode] = useState<'' | 'MANUAL' | 'API' | 'BROWSER'>('');
  const [evidenceSelection, setEvidenceSelection] = useState<EvidenceSelection | null>(null);

  const [freezeOpen, setFreezeOpen] = useState(false);
  const [snapshotTitle, setSnapshotTitle] = useState('');
  const [snapshotKind, setSnapshotKind] = useState<ReportSnapshotKind>('WEEKLY');
  const [summaryNotes, setSummaryNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryParams: LeadershipDashboardQueryParams = {
    period_from: dateInputToStartIso(fromDate),
    period_to: dateInputToEndIso(toDate),
    bucket_granularity: granularity,
    product_id: productId || undefined,
    surface_id: surfaceId || undefined,
    collection_mode: collectionMode || undefined,
  };

  const optionsQuery = useQuery(leadershipFilterOptionsQueryOptions());
  const dashboardQuery = useQuery(leadershipDashboardQueryOptions(queryParams));

  const freezeMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      const title = snapshotTitle.trim() || `GEO 效果快照（${fromDate} 至 ${toDate}）`;
      return createReportSnapshot(
        {
          report_kind: snapshotKind,
          title,
          period_from: dateInputToStartIso(fromDate),
          period_to: dateInputToEndIso(toDate),
          bucket_granularity: granularity,
          product_id: productId || null,
          surface_id: surfaceId || null,
          collection_mode: collectionMode || null,
          summary_notes: summaryNotes.trim(),
        },
        csrfToken,
      );
    },
    onSuccess: async (created) => {
      setFreezeOpen(false);
      setSnapshotTitle('');
      setSummaryNotes('');
      setErrorMsg(null);
      setFeedback(`已冻结快照「${created.title}」（v${created.revision_no}），后续历史补录不会篡改该版本。`);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.snapshots });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '冻结快照失败'),
  });

  function applyPreset(days: number) {
    const next = buildPresetDateInputs(days);
    setFromDate(next.fromDate);
    setToDate(next.toDate);
    setGranularity(days > 14 ? 'WEEK' : 'DAY');
  }

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canOperate && (
              <Button
                onClick={() => {
                  setSnapshotTitle(`GEO 周报快照（${fromDate} 至 ${toDate}）`);
                  setFreezeOpen((prev) => !prev);
                }}
                size="sm"
                type="button"
              >
                冻结周报快照
              </Button>
            )}
            <Link
              className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-panel px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
              to="/geo/dashboard/snapshots"
            >
              冻结快照记录
            </Link>
            <Link
              className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-panel px-3 text-xs font-medium text-text-primary hover:bg-surface-raised"
              search={{
                period_from: queryParams.period_from,
                period_to: queryParams.period_to,
                bucket_granularity: granularity,
                product_id: productId || undefined,
                surface_id: surfaceId || undefined,
                collection_mode: collectionMode || undefined,
              }}
              to="/geo/dashboard/print"
            >
              打印视图
            </Link>
            <Link
              className="inline-flex h-8 items-center rounded-md border border-border-subtle bg-surface-panel px-3 text-xs font-medium text-text-secondary hover:bg-surface-raised"
              to="/geo/observations"
            >
              历史观测（只读）
            </Link>
          </div>
        }
        description="按实际采集时间聚合自然提及率、文章引用命中率、核心问题覆盖与首次被引文章，支持点击下钻原始证据与周报冻结。"
        title="GEO 效果总览"
      />

      {feedback && <InlineBanner tone="success">{feedback}</InlineBanner>}
      {errorMsg && <InlineBanner tone="danger">{errorMsg}</InlineBanner>}

      {canOperate && freezeOpen && (
        <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4">
          <h2 className="text-sm font-semibold text-text-primary">冻结当前口径为只读周报快照</h2>
          <p className="text-xs text-text-secondary">
            冻结后将永久保存当前周期聚合结果、核心问题集合与底层证据清单，后续历史补录只影响实时看板，不改动已冻结报告。
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="text-text-secondary">快照标题</span>
              <Input
                onChange={(e) => setSnapshotTitle(e.target.value)}
                placeholder="例如：2026年第48周 GEO 周报"
                value={snapshotTitle}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-text-secondary">报告周期类型</span>
              <select
                className="h-9 w-full rounded-md border border-border-subtle bg-surface-app px-2.5 text-sm text-text-primary"
                onChange={(e) => setSnapshotKind(e.target.value as ReportSnapshotKind)}
                value={snapshotKind}
              >
                <option value="WEEKLY">周报快照</option>
                <option value="MONTHLY">月报快照</option>
                <option value="CUSTOM">阶段快照</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-text-secondary">本期结论摘要（可选）</span>
              <Input
                onChange={(e) => setSummaryNotes(e.target.value)}
                placeholder="例如：豆包自然提及率较前测提升"
                value={summaryNotes}
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={freezeMutation.isPending}
              onClick={() => freezeMutation.mutate()}
              size="sm"
              type="button"
            >
              {freezeMutation.isPending ? '正在冻结…' : '确认冻结'}
            </Button>
            <Button onClick={() => setFreezeOpen(false)} size="sm" type="button" variant="outline">
              取消
            </Button>
          </div>
        </section>
      )}

      {/* 友好筛选条（零 UUID） */}
      <section
        aria-label="看板筛选"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border-subtle bg-surface-panel p-4"
      >
        <div className="flex items-center gap-1.5">
          <Button onClick={() => applyPreset(7)} size="sm" type="button" variant="outline">
            近 7 天
          </Button>
          <Button onClick={() => applyPreset(30)} size="sm" type="button" variant="outline">
            近 30 天
          </Button>
        </div>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">开始日期</span>
          <Input
            onChange={(e) => setFromDate(e.target.value)}
            type="date"
            value={fromDate}
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">结束日期</span>
          <Input onChange={(e) => setToDate(e.target.value)} type="date" value={toDate} />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">趋势粒度</span>
          <select
            className="h-9 rounded-md border border-border-subtle bg-surface-app px-2.5 text-sm text-text-primary"
            onChange={(e) => setGranularity(e.target.value as 'DAY' | 'WEEK')}
            value={granularity}
          >
            <option value="DAY">按日</option>
            <option value="WEEK">按周</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">产品视角</span>
          <select
            className="h-9 rounded-md border border-border-subtle bg-surface-app px-2.5 text-sm text-text-primary"
            onChange={(e) => setProductId(e.target.value)}
            value={productId}
          >
            <option value="">全部产品（公司总览）</option>
            {optionsQuery.data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">搜索平台</span>
          <select
            className="h-9 rounded-md border border-border-subtle bg-surface-app px-2.5 text-sm text-text-primary"
            onChange={(e) => setSurfaceId(e.target.value)}
            value={surfaceId}
          >
            <option value="">全部平台</option>
            {optionsQuery.data?.platforms.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">采集方式</span>
          <select
            className="h-9 rounded-md border border-border-subtle bg-surface-app px-2.5 text-sm text-text-primary"
            onChange={(e) =>
              setCollectionMode(e.target.value as '' | 'MANUAL' | 'API' | 'BROWSER')
            }
            value={collectionMode}
          >
            <option value="">全部方式（分表展示）</option>
            <option value="MANUAL">人工录入</option>
            <option value="API">API 采集</option>
            <option value="BROWSER">浏览器采集</option>
          </select>
        </label>
      </section>

      {dashboardQuery.isLoading && (
        <div className="rounded-xl border border-border-subtle bg-surface-panel p-8 text-center text-sm text-text-secondary">
          正在汇总实时效果数据…
        </div>
      )}

      {dashboardQuery.error && (
        <InlineBanner tone="danger">
          <div className="flex items-center justify-between gap-2">
            <span>
              {dashboardQuery.error instanceof Error
                ? dashboardQuery.error.message
                : '效果看板加载失败'}
            </span>
            <Button onClick={() => void dashboardQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        </InlineBanner>
      )}

      {dashboardQuery.data && (
        <LeadershipDashboardView
          data={dashboardQuery.data}
          onInspectEvidence={setEvidenceSelection}
        />
      )}

      <LeadershipEvidenceDrawer
        onClose={() => setEvidenceSelection(null)}
        selection={evidenceSelection}
      />
    </div>
  );
}
