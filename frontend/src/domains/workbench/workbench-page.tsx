import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import type { components } from '@/shared/api/generated/schema';
import { workbenchQueryOptions } from './workbench.api';
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
      <section className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5" role="alert">
        <h1 className="type-page-title">工作台</h1>
        <p>{errorMessage(aggregate.error)}</p>
        <Button onClick={() => void aggregate.refetch()} type="button" variant="outline">重试</Button>
      </section>
    );
  }

  return <WorkbenchContent data={aggregate.data} />;
}

function WorkbenchContent({ data }: { data: WorkbenchAggregate }) {
  const countCards = resolveWorkbenchCounts(data.actionable_counts);
  return (
    <section aria-labelledby="workbench-title" className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-1">
        <h1 className="type-page-title" id="workbench-title">工作台</h1>
        <p className="text-text-secondary">集中处理跨产品事实、内容、发布与 GEO 的当前运营事项。</p>
        <p className="text-sm text-text-tertiary">聚合生成于 {formatWorkbenchDateTime(data.generated_at)}</p>
      </header>

      <section aria-labelledby="workbench-counts-title">
        <SectionHeading description="数量与入口均来自服务端聚合投影。" id="workbench-counts-title">需要处理</SectionHeading>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {countCards.map((card) => (
            <article className="min-w-0 space-y-3 rounded-xl border border-border-subtle bg-card p-5 shadow-sm" data-workbench-count={card.key} key={card.key}>
              <p className="text-sm font-medium text-text-secondary">{card.label}</p>
              <p className="font-mono text-3xl font-semibold tabular-nums text-foreground">{card.value}</p>
              <ul className="space-y-2">
                {card.links.map((link) => (
                  <li className="min-w-0" key={`${link.label}:${link.href}`}>
                    <a className="workbench-action-link inline-flex min-h-11 max-w-full items-center text-sm font-medium text-primary underline-offset-4 hover:underline" href={link.href}>
                      <span className="break-words">{link.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="workbench-attention-title">
        <SectionHeading description="按服务端返回顺序展示最近需要人工关注的事项。" id="workbench-attention-title">关注队列</SectionHeading>
        {data.recent_attention_items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-muted/30 p-6 text-text-secondary">当前没有需要关注的事项。</div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-card">
            {data.recent_attention_items.map((item) => {
              const presentation = attentionPresentations[item.category];
              return (
                <li className="min-w-0" key={`${item.category}:${item.resource_id}`}>
                  <a className="workbench-attention-link block min-w-0 space-y-2 p-4 hover:bg-muted/50" href={item.href}>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-words font-semibold text-foreground">{item.title}</span>
                      <Badge variant={presentation.tone}>{presentation.label}</Badge>
                    </div>
                    <p className="break-words text-sm text-text-secondary">{item.summary}</p>
                    <time className="block text-xs text-text-tertiary" dateTime={item.occurred_at}>{formatWorkbenchDateTime(item.occurred_at)}</time>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="workbench-health-title">
        <SectionHeading description="状态与说明直接来自服务端 workflow health。" id="workbench-health-title">流程健康</SectionHeading>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(healthDomainLabels) as Array<keyof WorkbenchWorkflowHealth>).map((domain) => {
            const health = data.workflow_health[domain];
            const status = healthStatusPresentations[health.status];
            return (
              <article className="min-w-0 space-y-3 rounded-xl border border-border-subtle bg-card p-4" key={domain}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{healthDomainLabels[domain]}</h3>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </div>
                <p className="break-words text-sm text-text-secondary">{health.summary}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="workbench-geo-title">
        <SectionHeading description={`${data.geo_summary.window.date_from} 至 ${data.geo_summary.window.date_to}`} id="workbench-geo-title">30 日 GEO 摘要</SectionHeading>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
          {(Object.keys(geoRateLabels) as GeoRateKey[]).map((key) => {
            const rate = data.geo_summary[key];
            return (
              <div className="min-w-0 rounded-xl border border-border-subtle bg-card p-5" key={key}>
                <dt className="text-sm font-medium text-text-secondary">{geoRateLabels[key]}</dt>
                <dd className="mt-2 space-y-1">
                  <p className="font-mono text-2xl font-semibold tabular-nums">{formatWorkbenchRate(rate)}</p>
                  <p className="text-xs text-text-tertiary">{rate.numerator} / {rate.denominator}</p>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
    </section>
  );
}

function SectionHeading({ children, description, id }: { children: string; description: string; id: string }) {
  return (
    <div className="mb-3 space-y-1">
      <h2 className="type-section-title" id={id}>{children}</h2>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  );
}

function WorkbenchLoading() {
  return (
    <section aria-busy="true" aria-label="正在读取工作台" className="min-w-0 space-y-8">
      <div className="space-y-2">
        <h1 className="type-page-title">工作台</h1>
        <p className="text-text-secondary">正在读取工作台…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-36" key={index} />)}
      </div>
      <Skeleton className="h-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-28" key={index} />)}
      </div>
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '读取工作台失败，请重试。';
}

export { WorkbenchPage };
