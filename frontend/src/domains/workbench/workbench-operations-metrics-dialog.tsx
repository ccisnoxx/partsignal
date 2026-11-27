import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import {
  workbenchOperationsMetricsQueryOptions,
  type OperationsMetrics,
} from '@/domains/campaigns/operations-attribution.api';

const windowChoices = [7, 30, 90] as const;

const alertKindLabels: Record<OperationsMetrics['decay_alerts'][number]['kind'], string> = {
  OVERDUE_FACT: '事实复核逾期',
  UNHEALTHY_PAGE: '公开页健康异常',
  GEO_VISIBILITY_DROP: 'GEO 可见度下滑',
  GEO_CITATION_LOST: '自有引用丢失',
};

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无样本';
  return `${(value * 100).toFixed(1)}%`;
}

export function WorkbenchOperationsMetricsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="outline">
        经营指标与衰退预警
      </Button>
      {open && <WorkbenchOperationsMetricsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function WorkbenchOperationsMetricsDialog({ onClose }: { onClose: () => void }) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const query = useQuery(workbenchOperationsMetricsQueryOptions(windowDays));
  const data = query.data;

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>纯 GEO 内容运营经营指标与衰退预警</DialogTitle>
            <Badge variant="warning">非强因果 · NOT_ESTABLISHED</Badge>
          </div>
          <DialogDescription>
            汇总同一统计窗口内的内容生产效率、GEO 观测指标、多币种统一成本及全站存量页面健康与衰退预警。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">统计窗口：</span>
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
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size="sm"
            type="button"
            variant="ghost"
          >
            刷新
          </Button>
        </div>

        {query.error && data && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs" role="alert">
            <span>
              刷新经营指标失败（当前保留上次数据）：
              {query.error instanceof Error ? query.error.message : '请求失败'}
            </span>
            <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        )}

        {query.isPending && !data ? (
          <p className="py-8 text-center text-sm text-text-muted">正在加载经营指标…</p>
        ) : query.error && !data ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <span>{query.error instanceof Error ? query.error.message : '加载经营指标失败'}</span>
            <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricBox label="进行中活动" value={`${data.active_campaign_count} 个`} />
              <MetricBox label="窗口任务 / 窗口核验" value={`${data.production.task_count} / ${data.production.published_article_count}`} />
              <MetricBox label="审核一次通过率" value={formatPercent(data.production.first_pass_review_rate)} />
              <MetricBox
                label="存量页面健康（正常/异常）"
                value={`${data.publishing_health.healthy_articles} / ${data.publishing_health.confirmed_anomaly_articles}`}
              />
              <MetricBox label="GEO 自有提及率" value={formatPercent(data.geo_attribution.mention_rate)} />
              <MetricBox label="GEO 自有推荐率" value={formatPercent(data.geo_attribution.recommendation_rate)} />
              <MetricBox label="GEO 自有引用率" value={formatPercent(data.geo_attribution.citation_rate)} />
              <MetricBox label="AI 未定价样本率" value={formatPercent(data.cost_coverage.missing_price_rate)} />
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">多币种成本汇总（窗口内）</h3>
              {data.costs_by_currency.length === 0 ? (
                <p className="text-xs text-text-muted">当前统计窗口内暂无已计价成本记录。</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.costs_by_currency.map((item) => (
                    <div className="rounded-lg border border-border-subtle p-3 text-xs" key={item.currency}>
                      <p className="font-semibold text-sm">
                        {item.currency} 合计：{item.total_cost}
                      </p>
                      <p className="mt-1 text-text-muted">
                        AI（生成/质检/GEO）：{item.total_ai_cost} · 运营台账：{item.total_operating_cost}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  内容衰退与刷新预警（{data.decay_alerts.length}）
                </h3>
              </div>
              {data.decay_alerts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-default p-4 text-center text-xs text-text-muted">
                  当前无逾期事实、异常公开页面或开放中的可见度/引用下滑预警。
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {data.decay_alerts.map((alert) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle p-2.5"
                      key={`${alert.kind}:${alert.target_id}`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={alert.severity === 'HIGH' ? 'destructive' : 'warning'}>
                            {alertKindLabels[alert.kind]}
                          </Badge>
                          <span className="font-medium text-text-primary">{alert.title}</span>
                        </div>
                        <p className="text-text-muted">{alert.detail}</p>
                      </div>
                      <a
                        className="shrink-0 font-medium text-primary hover:underline"
                        href={alert.navigation_path}
                      >
                        前往处理
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline">关闭</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-subtle/30 p-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
