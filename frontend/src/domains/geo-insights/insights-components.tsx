import { metricLabels, exclusionLabels } from '@/shared/lib/geo-metric-labels';
import type { ReactNode } from 'react';
import { TableShell } from '@/design-system/data-table/table-shell';
import { ShareBar } from '@/design-system/data-viz/data-viz';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { MetadataDisclosure, MetadataList } from '@/design-system/primitives/metadata-disclosure';
import type { components } from '@/shared/api/generated/schema';
import { formatRate, modeLabels, sampleLabels, type Metric, type OnDrilldown } from './insights.model';
import { InsightRequestError } from './insights.api';

function sampleBadgeVariant(level: Metric['sample_level']): 'success' | 'info' | 'warning' | 'secondary' {
  switch (level) {
    case 'STABLE': return 'success';
    case 'REPORTABLE': return 'info';
    case 'OBSERVED': return 'warning';
    case 'NONE': return 'secondary';
  }
}

export function InsightSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      id={id}
      className="min-w-0 scroll-mt-20 space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-[var(--shadow-panel)] sm:p-5"
    >
      <div className="border-b border-border-subtle pb-2.5">
        <h2 id={`${id}-title`} className="type-section-title text-text-primary">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function MetricReadout({
  compact = false,
  metric,
  onDrilldown,
}: {
  compact?: boolean;
  metric: Metric;
  onDrilldown: OnDrilldown;
}) {
  const label = metricLabels[metric.metric_code];
  const isErrorMetric = metric.metric_code === 'severe_error_run_rate';

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {!compact && <p className="type-label text-text-secondary">{label}</p>}
        <Badge variant={sampleBadgeVariant(metric.sample_level)}>{sampleLabels[metric.sample_level]}</Badge>
      </div>
      <p className={compact ? 'font-mono text-lg font-semibold tabular-nums text-text-primary' : 'font-mono text-2xl font-semibold tabular-nums text-text-primary'}>
        {formatRate(metric.value)}
      </p>
      <ShareBar tone={isErrorMetric ? 'danger' : 'primary'} value={metric.value} />
      <p className="text-xs tabular-nums text-text-secondary">
        分子 {metric.numerator} / 分母 {metric.denominator}
      </p>
      {metric.unavailable_reason && (
        <p className="text-xs text-text-tertiary">不可计算原因：无可用分母（{metric.unavailable_reason}）</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button size={compact ? 'xs' : 'sm'} variant="outline" onClick={() => onDrilldown(metric.drilldown)}>
          查看{label}样本
        </Button>
      </div>
      <MetadataDisclosure summary="口径与排除原因">
        <div className="space-y-1.5 break-all">
          <p>合格运行 {metric.eligible_run_count} · 排除运行 {metric.excluded_run_count} · 不可判断声明 {metric.unjudgeable_claim_count}</p>
          <p>公式版本：<code className="type-mono text-xs">{metric.formula_version}</code></p>
          {metric.exclusion_reason_counts.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5">
              {metric.exclusion_reason_counts.map((reason) => (
                <li key={reason.code}>{exclusionLabels[reason.code]}：{reason.run_count}</li>
              ))}
            </ul>
          )}
        </div>
      </MetadataDisclosure>
    </div>
  );
}

export function MetricCards({ metrics, onDrilldown }: { metrics: Metric[]; onDrilldown: OnDrilldown }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => (
        <div
          key={metric.metric_code}
          className="min-w-0 rounded-xl border border-border-subtle bg-surface-raised/35 p-4"
        >
          <MetricReadout metric={metric} onDrilldown={onDrilldown} />
        </div>
      ))}
    </div>
  );
}

export function CellIdentity({
  cell,
}: {
  cell: components['schemas']['GeoOverviewCell'] | components['schemas']['GeoAnswerInsightCell'];
}) {
  const d = cell.dimensions;
  return (
    <div className="max-w-xl space-y-2 text-sm">
      <p className="font-semibold text-text-primary">{cell.display_name}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{modeLabels[d.collection_mode]}</Badge>
        <Badge variant="secondary">{d.mention_mode === 'BRANDED' ? '点名' : '不点名'}</Badge>
        <span className="text-xs text-text-secondary">
          {d.language_code} / {d.region_code} · {d.login_state}
        </span>
      </div>
      <MetadataDisclosure summary="完整维度与版本">
        <MetadataList
          items={[
            { label: '单元键', value: cell.cell_key, mono: true },
            { label: '对象', value: cell.subject_id, mono: true },
            { label: '产品', value: cell.product_id ?? '非产品对象', mono: Boolean(cell.product_id) },
            { label: '主题 / 版本', value: `${d.query_topic_id} / ${d.query_topic_revision}`, mono: true },
            { label: '问题变体 / 版本', value: `${d.prompt_variant_id} / ${d.prompt_revision}`, mono: true },
            { label: '观测面 / 版本', value: `${d.engine_surface_id} / ${d.surface_revision}`, mono: true },
            { label: '采集配置 / 版本', value: `${d.collection_profile_id} / ${d.profile_revision}`, mono: true },
            { label: '意图', value: d.intent_type },
            { label: '来源模型', value: d.source_model ?? '未知' },
            { label: '来源产品', value: d.source_product ?? '未知' },
            { label: '模型版本', value: d.model_version ?? '未知' },
            { label: '产品版本', value: d.product_version ?? '未知' },
            { label: '规则版本', value: d.rule_set_version },
            { label: '分析配置', value: d.analysis_configuration_key, mono: true },
            { label: '对象版本', value: JSON.stringify(d.subject_versions), mono: true },
            { label: '事实绑定', value: JSON.stringify(d.fact_version_bindings), mono: true },
            { label: '时间窗', value: d.window_key, mono: true },
          ]}
        />
      </MetadataDisclosure>
    </div>
  );
}

export function ExclusionTable({ reasons }: { reasons: components['schemas']['GeoOverviewExclusion'][] }) {
  return (
    <TableShell regionLabel="排除原因表">
      <thead>
        <tr>
          <th scope="col">排除原因</th>
          <th data-column-role="numeric" scope="col">运行数</th>
        </tr>
      </thead>
      <tbody>
        {reasons.map((r) => (
          <tr key={r.code}>
            <th scope="row">{exclusionLabels[r.code]}</th>
            <td data-column-role="numeric">{r.run_count}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function canShowSnapshot(error: Error | null) {
  if (!error) return true;
  const status = error instanceof InsightRequestError ? error.status : undefined;
  return status === undefined || status >= 500 || status === 429;
}

export function ReadFailure({ error, retry, retained = false }: { error: Error; retry: () => void; retained?: boolean }) {
  const status = error instanceof InsightRequestError ? error.status : undefined;
  const denied = status === 401 || status === 403;
  const stale = status === 404 || status === 409;
  const recoverable = canShowSnapshot(error);
  const message = denied
    ? '当前资源不可访问，请确认登录与访问权限。'
    : stale
      ? '该维度或版本已失效，请关闭明细并刷新汇总，重新选择样本。'
      : status === 422 || status === 400
        ? '筛选或明细条件不符合服务端合同，请重新选择。'
        : '洞察读取失败，可稍后重试。';

  return (
    <InlineBanner
      actions={recoverable ? <Button size="sm" variant="outline" onClick={retry}>重试读取</Button> : undefined}
      meta={
        error instanceof InsightRequestError && error.detail
          ? `错误码：${error.detail.code} · 请求 ID：${error.detail.request_id}`
          : undefined
      }
      tone="danger"
    >
      <p>{message}</p>
      {retained && recoverable && (
        <p className="mt-1 text-xs text-text-secondary">
          保留同一筛选的上次成功快照，时间见 as_of；刷新成功后更新。
        </p>
      )}
    </InlineBanner>
  );
}

export function safeCitationUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
