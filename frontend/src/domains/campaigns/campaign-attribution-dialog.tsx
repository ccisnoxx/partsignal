import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { geoInterventionKeys } from '@/domains/geo-interventions/geo-intervention.api';
import { GeoInterventionsSection } from '@/domains/geo-interventions/geo-interventions-section';
import { CampaignCostEntriesSection } from './campaign-cost-entries-section';
import { campaignAttributionQueryOptions } from './operations-attribution.api';

type CampaignAttributionDialogButtonProps = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  csrfToken: string | null;
};

const windowChoices = [7, 30, 90] as const;

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无样本';
  return `${(value * 100).toFixed(1)}%`;
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无样本';
  return `${value.toFixed(1)} 小时`;
}

export function CampaignAttributionDialogButton({
  campaignId,
  campaignName,
  campaignStatus,
  csrfToken,
}: CampaignAttributionDialogButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="outline">
        归因与成本看板
      </Button>
      {open && (
        <CampaignAttributionDialog
          campaignId={campaignId}
          campaignName={campaignName}
          campaignStatus={campaignStatus}
          csrfToken={csrfToken}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CampaignAttributionDialog({
  campaignId,
  campaignName,
  campaignStatus,
  csrfToken,
  onClose,
}: CampaignAttributionDialogButtonProps & { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState<number>(30);
  const [mutatingCost, setMutatingCost] = useState(false);
  const [mutatingIntervention, setMutatingIntervention] = useState(false);

  const dashboard = useQuery(campaignAttributionQueryOptions(campaignId, windowDays));

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-attribution', campaignId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-cost-entries', campaignId],
      }),
      queryClient.invalidateQueries({
        queryKey: geoInterventionKeys.byCampaign(campaignId),
      }),
    ]);
  };

  const data = dashboard.data;
  const canRecordCost = (data?.campaign_status ?? campaignStatus) !== 'ARCHIVED';
  const busy = mutatingCost || mutatingIntervention;

  return (
    <Dialog onOpenChange={(next) => { if (!next && !busy) onClose(); }} open>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{campaignName} · 归因与成本看板</DialogTitle>
            <Badge variant="warning">非强因果 · NOT_ESTABLISHED</Badge>
          </div>
          <DialogDescription>
            展示同一统计窗口内的内容生产漏斗、GEO 观测归因样本、多币种统一成本及存量公开页面健康快照；多币种分列汇总且不宣称强因果成立。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">观测窗口：</span>
            {windowChoices.map((days) => (
              <Button
                aria-pressed={windowDays === days}
                key={days}
                onClick={() => setWindowDays(days)}
                size="sm"
                type="button"
                variant={windowDays === days ? 'default' : 'outline'}
              >
                近 {days} 天
              </Button>
            ))}
          </div>
          <Button
            disabled={dashboard.isFetching}
            onClick={() => void refreshAll()}
            size="sm"
            type="button"
            variant="ghost"
          >
            刷新数据
          </Button>
        </div>

        {dashboard.error && data && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs" role="alert">
            <span>
              刷新归因看板失败（当前保留上次数据）：
              {dashboard.error instanceof Error ? dashboard.error.message : '请求失败'}
            </span>
            <Button onClick={() => void dashboard.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        )}

        {dashboard.isPending && !data ? (
          <p className="py-8 text-center text-sm text-text-muted">正在加载实时归因看板…</p>
        ) : dashboard.error && !data ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <span>{dashboard.error instanceof Error ? dashboard.error.message : '加载归因看板失败'}</span>
            <Button onClick={() => void dashboard.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">生产漏斗（窗口内）与公开页面健康（存量快照）</h3>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="新建任务 / 窗口批准" value={`${data.production.task_count} / ${data.production.approved_task_count}`} />
                <StatCard label="窗口核验发布" value={`${data.production.published_article_count} 篇`} />
                <StatCard label="审核一次通过率" value={formatPercent(data.production.first_pass_review_rate)} />
                <StatCard label="草稿→批准耗时" value={formatHours(data.production.avg_draft_to_approval_hours)} />
                <StatCard label="批准→发布耗时" value={formatHours(data.production.avg_approval_to_publish_hours)} />
                <StatCard label="发布→核验耗时" value={formatHours(data.production.avg_publish_to_verify_hours)} />
                <StatCard
                  label="存量页面健康（正常/受限/异常）"
                  value={`${data.publishing_health.healthy_articles} / ${data.publishing_health.fetch_blocked_articles} / ${data.publishing_health.confirmed_anomaly_articles}`}
                />
                <StatCard
                  label="高重复稿 / 逾期事实产品"
                  value={`${data.production.near_duplicate_version_count} / ${data.production.overdue_fact_product_count}`}
                />
              </dl>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">GEO 归因摘要与干预记录</h3>
                <span className="text-xs text-text-muted">
                  样本 {data.geo_attribution.completed_run_count}/{data.geo_attribution.sample_count}
                  {' · '}缺失率 {formatPercent(data.geo_attribution.missing_data_rate)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="自有提及率" value={formatPercent(data.geo_attribution.mention_rate)} />
                <StatCard label="自有推荐率" value={formatPercent(data.geo_attribution.recommendation_rate)} />
                <StatCard label="自有域名引用率" value={formatPercent(data.geo_attribution.citation_rate)} />
                <StatCard label="事实准确率" value={formatPercent(data.geo_attribution.accuracy_rate)} />
              </dl>
              <GeoInterventionsSection
                csrfToken={csrfToken}
                onBusyChange={setMutatingIntervention}
                scope={{
                  kind: 'campaign',
                  campaignId,
                  campaignName,
                  canCreate: canRecordCost,
                }}
              />
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">多币种统一成本与单位经济学（窗口内）</h3>
                <span className="text-xs text-text-muted">
                  AI 作业未定价率：{formatPercent(data.cost_coverage.missing_price_rate)}
                  （{data.cost_coverage.unpriced_ai_jobs}/{data.cost_coverage.total_ai_jobs}）
                </span>
              </div>
              {data.costs_by_currency.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-default p-3 text-xs text-text-muted">
                  当前窗口内暂无已计价 AI 作业、GEO 采集或有效运营费用记录。
                </p>
              ) : (
                <div className="space-y-2">
                  {data.costs_by_currency.map((row) => {
                    const unit = data.unit_economics_by_currency.find((u) => u.currency === row.currency);
                    return (
                      <div className="rounded-lg border border-border-subtle p-3 text-xs" key={row.currency}>
                        <div className="mb-2 flex items-center justify-between">
                          <strong className="text-sm">{row.currency} 汇总：{row.total_cost}</strong>
                          <span className="text-text-muted">
                            AI 合计 {row.total_ai_cost} · 运营台账合计 {row.total_operating_cost}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          <span>AI 生成：{row.ai_generation_cost}</span>
                          <span>AI 语义质检：{row.ai_semantic_check_cost}</span>
                          <span>GEO 采集：{row.geo_collection_cost}</span>
                          <span>人工工时：{row.labor_cost}</span>
                          <span>外采投放：{row.external_placement_cost}</span>
                          <span>其他费用：{row.other_operating_cost}</span>
                        </div>
                        {unit && (
                          <div className="mt-2 border-t border-border-subtle/70 pt-1.5 text-text-muted">
                            单篇批准内容：{unit.cost_per_approved_content ?? '分母为 0'}
                            {' · '}单篇核验发布：{unit.cost_per_published_article ?? '分母为 0'}
                            {' · '}单条 GEO 样本：{unit.cost_per_geo_sample ?? '分母为 0'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <CampaignCostEntriesSection
              campaignId={campaignId}
              canRecordCost={canRecordCost}
              csrfToken={csrfToken}
              onBusyChange={setMutatingCost}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={busy} onClick={onClose} type="button" variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-subtle/30 p-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
