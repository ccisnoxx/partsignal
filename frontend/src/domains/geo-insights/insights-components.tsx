import type { ReactNode } from 'react';
import type { components } from '@/shared/api/generated/schema';
import { Button } from '@/design-system/primitives/button';
import { TableShell } from '@/design-system/data-table/table-shell';
import { exclusionLabels, formatRate, metricLabels, modeLabels, sampleLabels, type Metric, type OnDrilldown } from './insights.model';
import { InsightRequestError } from './insights.api';

export function InsightSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={`${id}-title`} id={id} className="min-w-0 scroll-mt-4 space-y-4 rounded-lg border border-border-subtle bg-surface-panel p-4 sm:p-6"><h2 id={`${id}-title`} className="type-section-title">{title}</h2>{children}</section>;
}
export function MetricReadout({ metric, onDrilldown }: { metric: Metric; onDrilldown: OnDrilldown }) {
  return <div className="min-w-0 space-y-2">
    <p className="type-label">{metricLabels[metric.metric_code]}</p><p className="text-2xl font-semibold tabular-nums">{formatRate(metric.value)}</p>
    <p className="text-sm text-text-secondary">{sampleLabels[metric.sample_level]} · 分子 {metric.numerator} / 分母 {metric.denominator}</p>
    <p className="text-xs text-text-secondary">合格运行 {metric.eligible_run_count} · 排除运行 {metric.excluded_run_count} · 不可判断声明 {metric.unjudgeable_claim_count}</p>
    {metric.unavailable_reason && <p className="text-sm text-text-secondary">不可计算原因：无可用分母（{metric.unavailable_reason}）</p>}
    <details className="text-xs"><summary className="cursor-pointer">口径与排除原因</summary><p className="mt-2 break-all">公式版本：{metric.formula_version}</p><ul>{metric.exclusion_reason_counts.map((reason) => <li key={reason.code}>{exclusionLabels[reason.code]}：{reason.run_count}</li>)}</ul></details>
    <Button size="sm" variant="outline" onClick={() => onDrilldown(metric.drilldown)}>查看{metricLabels[metric.metric_code]}样本</Button>
  </div>;
}
export function MetricCards({ metrics, onDrilldown }: { metrics: Metric[]; onDrilldown: OnDrilldown }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric) => <div key={metric.metric_code} className="min-w-0 rounded-md border border-border-subtle p-4"><MetricReadout metric={metric} onDrilldown={onDrilldown} /></div>)}</div>;
}
export function CellIdentity({ cell }: { cell: components['schemas']['GeoOverviewCell'] | components['schemas']['GeoAnswerInsightCell'] }) {
  const d = cell.dimensions;
  return <div className="max-w-xl space-y-1 text-sm"><p className="font-medium">{cell.display_name}</p><p>{modeLabels[d.collection_mode]} · {d.mention_mode === 'BRANDED' ? '点名' : '不点名'} · {d.language_code} / {d.region_code} · {d.login_state}</p>
    <details><summary className="cursor-pointer text-text-secondary">完整维度与版本</summary><dl className="mt-2 space-y-1 break-all text-xs">
      {Object.entries({ '单元键': cell.cell_key, '对象': cell.subject_id, '产品': cell.product_id ?? '非产品对象', '主题 / 版本': `${d.query_topic_id} / ${d.query_topic_revision}`, '问题变体 / 版本': `${d.prompt_variant_id} / ${d.prompt_revision}`, '观测面 / 版本': `${d.engine_surface_id} / ${d.surface_revision}`, '采集配置 / 版本': `${d.collection_profile_id} / ${d.profile_revision}`, '意图': d.intent_type, '来源模型': d.source_model ?? '未知', '来源产品': d.source_product ?? '未知', '模型版本': d.model_version ?? '未知', '产品版本': d.product_version ?? '未知', '规则版本': d.rule_set_version, '分析配置': d.analysis_configuration_key, '对象版本': JSON.stringify(d.subject_versions), '事实绑定': JSON.stringify(d.fact_version_bindings), '时间窗': d.window_key }).map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd>{value}</dd></div>)}
    </dl></details></div>;
}
export function ExclusionTable({ reasons }: { reasons: components['schemas']['GeoOverviewExclusion'][] }) {
  return <TableShell regionLabel="排除原因表"><thead><tr><th scope="col">排除原因</th><th scope="col">运行数</th></tr></thead><tbody>{reasons.map((r) => <tr key={r.code}><th scope="row">{exclusionLabels[r.code]}</th><td>{r.run_count}</td></tr>)}</tbody></TableShell>;
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
  return <div role="alert" className="space-y-2 rounded-md border border-border-subtle p-4"><p>{denied ? '当前资源不可访问，请确认登录与访问权限。' : stale ? '该维度或版本已失效，请关闭明细并刷新汇总，重新选择样本。' : status === 422 || status === 400 ? '筛选或明细条件不符合服务端合同，请重新选择。' : '洞察读取失败，可稍后重试。'}</p>
    {error instanceof InsightRequestError && error.detail && <p className="text-xs">错误码：{error.detail.code} · 请求 ID：{error.detail.request_id}</p>}
    {retained && recoverable && <p className="text-sm text-text-secondary">保留同一筛选的上次成功快照，时间见 as_of；刷新成功后更新。</p>}
    {recoverable && <Button variant="outline" onClick={retry}>重试读取</Button>}
  </div>;
}
export function safeCitationUrl(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
