import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, CheckCircle2Icon } from 'lucide-react';

import { ShareBar } from '@/design-system/data-viz/data-viz';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import type { components } from '@/shared/api/generated/schema';
import { cn } from '@/shared/lib/utils';
import { workbenchQueryOptions } from './workbench.api';
import { WorkbenchInboxSection } from './workbench-inbox-section';
import { WorkbenchOperationsMetricsButton } from './workbench-operations-metrics-dialog';
import {
  attentionPresentations,
  formatWorkbenchDateTime,
  formatWorkbenchRate,
  geoRateLabels,
  healthDomainLabels,
  healthStatusPresentations,
  resolveWorkbenchCounts,
} from './workbench.model';

type WorkbenchAggregate = components['schemas']['WorkbenchAggregate'];
type WorkbenchWorkflowHealth = components['schemas']['WorkbenchWorkflowHealth'];
type GeoRateKey = keyof typeof geoRateLabels;

function WorkbenchPage() {
  const aggregate = useQuery(workbenchQueryOptions());

  if (aggregate.isPending) return <WorkbenchLoading />;
  if (!aggregate.data) {
    return (
      <section className="min-w-0 space-y-4">
        <PageHeader title="工作台" />
        <InlineBanner
          actions={
            <Button onClick={() => void aggregate.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          }
          title="工作台读取失败"
          tone="danger"
        >
          {errorMessage(aggregate.error)}
        </InlineBanner>
      </section>
    );
  }

  return <WorkbenchContent data={aggregate.data} />;
}

function WorkbenchContent({ data }: { data: WorkbenchAggregate }) {
  const countCards = resolveWorkbenchCounts(data.actionable_counts);
  const healthDomains = Object.keys(healthDomainLabels) as Array<keyof WorkbenchWorkflowHealth>;

  return (
    <section aria-labelledby="workbench-title" className="min-w-0 space-y-6">
      <PageHeader
        actions={<WorkbenchOperationsMetricsButton />}
        description="集中处理分配给我的事项、今日到期、已超时及跨产品事实、内容、发布与 GEO 的运营队列。"
        meta={<span>聚合生成于 {formatWorkbenchDateTime(data.generated_at)}</span>}
        title="运营工作台"
        titleId="workbench-title"
      />

      <WorkbenchInboxSection />

      <section aria-labelledby="workbench-counts-title" className="space-y-2.5">
        <SectionHeading description="数量与入口均来自服务端聚合投影。" id="workbench-counts-title">
          需要处理
        </SectionHeading>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {countCards.map((card) => {
            const active = card.value > 0;
            return (
              <article
                className={cn(
                  'flex min-w-0 flex-col justify-between gap-2.5 rounded-xl border bg-surface-panel p-4 shadow-[var(--shadow-panel)] transition-colors',
                  active
                    ? 'border-info-border bg-gradient-to-b from-surface-panel to-info-surface/40'
                    : 'border-border-subtle',
                )}
                data-workbench-count={card.key}
                key={card.key}
              >
                <div className="space-y-1">
                  <p className="text-xs font-medium text-text-secondary">{card.label}</p>
                  <p
                    className={cn(
                      'font-mono text-2xl font-semibold tabular-nums',
                      active ? 'text-text-primary' : 'text-text-muted',
                    )}
                  >
                    {card.value}
                  </p>
                </div>
                <ul className="space-y-1 border-t border-border-subtle/80 pt-2">
                  {card.links.map((link) => (
                    <li className="min-w-0" key={`${link.label}:${link.href}`}>
                      <a
                        className="workbench-action-link group inline-flex min-h-11 max-w-full items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline sm:min-h-7"
                        href={link.href}
                      >
                        <span className="break-words">{link.label}</span>
                        <ArrowRightIcon
                          aria-hidden="true"
                          className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="workbench-attention-title" className="min-w-0 space-y-2.5">
          <SectionHeading
            description="按服务端返回顺序展示最近需要人工关注的事项。"
            id="workbench-attention-title"
          >
            关注队列
          </SectionHeading>
          {data.recent_attention_items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface-panel/70 px-6 py-10 text-center">
              <CheckCircle2Icon aria-hidden="true" className="size-6 text-success" />
              <p className="text-sm font-medium text-text-secondary">当前没有需要关注的事项。</p>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-panel shadow-[var(--shadow-panel)]">
              {data.recent_attention_items.map((item) => {
                const presentation = attentionPresentations[item.category];
                return (
                  <li className="min-w-0" key={`${item.category}:${item.resource_id}`}>
                    <a
                      className="workbench-attention-link group flex min-w-0 items-start justify-between gap-3 p-4 transition-colors hover:bg-surface-selected/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                      href={item.href}
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant={presentation.tone}>{presentation.label}</Badge>
                          <span className="min-w-0 break-words text-sm font-semibold text-text-primary group-hover:text-primary">
                            {item.title}
                          </span>
                        </div>
                        <p className="break-words text-sm text-text-secondary">{item.summary}</p>
                        <time
                          className="block text-xs text-text-tertiary"
                          dateTime={item.occurred_at}
                        >
                          {formatWorkbenchDateTime(item.occurred_at)}
                        </time>
                      </div>
                      <ArrowRightIcon
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="workbench-health-title" className="min-w-0 space-y-2.5">
            <SectionHeading
              description="状态与说明直接来自服务端 workflow health。"
              id="workbench-health-title"
            >
              流程健康
            </SectionHeading>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-panel shadow-[var(--shadow-panel)]">
              {healthDomains.map((domain) => {
                const health = data.workflow_health[domain];
                const status = healthStatusPresentations[health.status];
                return (
                  <article className="min-w-0 space-y-1.5 p-3.5" key={domain}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{healthDomainLabels[domain]}</h3>
                      <Badge variant={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="break-words text-xs text-text-secondary">{health.summary}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="workbench-geo-title" className="min-w-0 space-y-2.5">
            <div className="flex items-end justify-between gap-2">
              <SectionHeading
                description={`${data.geo_summary.window.date_from} 至 ${data.geo_summary.window.date_to}`}
                id="workbench-geo-title"
              >
                30 日 GEO 摘要
              </SectionHeading>
              <a
                className="mb-2 shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                href="/geo/overview"
              >
                进入总览
              </a>
            </div>
            <dl className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-panel shadow-[var(--shadow-panel)]">
              {(Object.keys(geoRateLabels) as GeoRateKey[]).map((key) => {
                const rate = data.geo_summary[key];
                return (
                  <div className="min-w-0 space-y-2 p-4" key={key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-sm font-medium text-text-secondary">{geoRateLabels[key]}</dt>
                      <dd className="font-mono text-lg font-semibold tabular-nums text-text-primary">
                        {formatWorkbenchRate(rate)}
                      </dd>
                    </div>
                    <ShareBar value={rate.value} />
                    <p className="text-xs tabular-nums text-text-tertiary">
                      {rate.numerator} / {rate.denominator}
                    </p>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  children,
  description,
  id,
}: {
  children: string;
  description: string;
  id: string;
}) {
  return (
    <div className="space-y-0.5">
      <h2 className="type-section-title text-text-primary" id={id}>{children}</h2>
      <p className="text-xs text-text-secondary">{description}</p>
    </div>
  );
}

function WorkbenchLoading() {
  return (
    <section aria-busy="true" aria-label="正在读取工作台" className="min-w-0 space-y-6">
      <div className="space-y-2">
        <h1 className="type-page-title">工作台</h1>
        <p className="text-sm text-text-secondary">正在读取工作台…</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-32 rounded-xl" key={index} />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-72 rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取工作台失败，请重试。';
}

export { WorkbenchPage };
