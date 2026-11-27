import { metricLabels } from '@/shared/lib/geo-metric-labels';
import { TableShell } from '@/design-system/data-table/table-shell';
import { ComparisonBar, CoverageProgress, DeltaIndicator } from '@/design-system/data-viz/data-viz';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import { MetadataDisclosure } from '@/design-system/primitives/metadata-disclosure';
import type { components } from '@/shared/api/generated/schema';
import { CellIdentity, InsightSection, MetricReadout } from './insights-components';
import { formatPoints, formatRate, formatTime, type AnswerInsights, type OnDrilldown } from './insights.model';

type Cell = components['schemas']['GeoAnswerInsightCell'];
type MetricCode = components['schemas']['GeoAnswerInsightMetric']['metric_code'];
type Props = { insights: AnswerInsights; onDrilldown: OnDrilldown };

export function insightCell(cells: Cell[], key: string): Cell {
  const result = cells.find((cell) => cell.cell_key === key);
  if (!result) throw new Error('洞察响应缺少引用的维度单元，请刷新数据');
  return result;
}

function metricIn(cell: Cell, code: MetricCode) {
  const result = cell.metrics.find((metric) => metric.metric_code === code);
  if (!result) throw new Error('洞察响应缺少约定指标，请刷新数据');
  return result;
}

function CellTable({ cells, codes, label, onDrilldown }: { cells: Cell[]; codes: MetricCode[]; label: string; onDrilldown: OnDrilldown }) {
  if (!cells.length) return <p className="text-sm text-text-secondary">当前筛选没有可展示的维度单元。</p>;
  return (
    <TableShell regionLabel={label}>
      <caption className="sr-only">每行保持完整采集、问题、对象和版本维度，不汇总不同模式</caption>
      <thead>
        <tr>
          <th scope="col">对象与完整维度</th>
          {codes.map((code) => <th key={code} scope="col">{metricLabels[code]}</th>)}
        </tr>
      </thead>
      <tbody>
        {cells.map((cell) => (
          <tr key={cell.cell_key}>
            <th className="align-top" scope="row"><CellIdentity cell={cell} /></th>
            {codes.map((code) => (
              <td className="min-w-56 align-top" key={code}>
                <MetricReadout compact metric={metricIn(cell, code)} onDrilldown={onDrilldown} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function PerformanceSections({ insights, onDrilldown }: Props) {
  return (
    <>
      <InsightSection id="visibility" title="可见性与推荐">
        <CellTable
          cells={insights.current_cells.filter((cell) => cell.selected_subject)}
          codes={['natural_visibility', 'recommendation_rate', 'accurate_claim_rate']}
          label="可见性与推荐指标表"
          onDrilldown={onDrilldown}
        />
      </InsightSection>
      <Trends insights={insights} onDrilldown={onDrilldown} />
      <InsightSection id="matrix" title="产品矩阵">
        <CellTable
          cells={insights.product_matrix_cell_keys.map((key) => insightCell(insights.current_cells, key))}
          codes={['natural_visibility', 'recommendation_rate', 'accurate_claim_rate', 'severe_error_run_rate']}
          label="产品矩阵表格替代"
          onDrilldown={onDrilldown}
        />
      </InsightSection>
      <QuestionCoverage insights={insights} onDrilldown={onDrilldown} />
      <InsightSection id="platforms" title="平台表现">
        {!insights.platform_performance.length && <p className="text-sm text-text-secondary">当前筛选没有平台表现数据。</p>}
        {insights.platform_performance.map((platform) => (
          <div key={platform.engine_surface_id} className="space-y-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
              <span>观测面</span>
              <code className="rounded bg-surface-raised px-1.5 py-0.5 type-mono text-xs break-all text-text-secondary">
                {platform.engine_surface_id}
              </code>
            </h3>
            <CellTable
              cells={platform.cell_keys.map((key) => insightCell(insights.current_cells, key))}
              codes={['natural_visibility', 'recommendation_rate']}
              label={`平台 ${platform.engine_surface_id} 表现表`}
              onDrilldown={onDrilldown}
            />
          </div>
        ))}
      </InsightSection>
      <InsightSection id="sov" title="竞品 SOV">
        <p className="text-sm text-text-secondary">
          固定竞品集合下的提及与推荐事件份额。总提及为零时不可计算；样本等级与分母来自服务端。
        </p>
        <CellTable
          cells={insights.competitor_sov_cell_keys.map((key) => insightCell(insights.current_cells, key))}
          codes={['mention_sov', 'recommendation_sov']}
          label="竞品 SOV 表格替代"
          onDrilldown={onDrilldown}
        />
        {insights.competitor_sov_cell_keys.length > 0 && (
          <MetadataDisclosure summary="固定竞品集合明细">
            <ul className="space-y-1">
              {insights.competitor_sov_cell_keys.map((key) => {
                const cell = insightCell(insights.current_cells, key);
                return (
                  <li className="break-all" key={key}>
                    <span className="font-medium text-text-primary">{cell.display_name}</span>
                    {' · 竞品集合：'}
                    <span className="type-mono">{cell.sov_subject_ids.join('、')}</span>
                  </li>
                );
              })}
            </ul>
          </MetadataDisclosure>
        )}
      </InsightSection>
    </>
  );
}

const trendReasons = {
  MISSING_WINDOW: '缺少前期或当期窗口',
  MIXED_DIMENSIONS: '窗口含多个维度',
  COMPETITOR_SET_CHANGED: '竞品集合变化',
  DIMENSIONS_CHANGED: '可比维度变化',
  FORMULA_CHANGED: '公式版本变化',
  NO_DENOMINATOR: '无可用分母',
  INSUFFICIENT_SAMPLE: '样本不足',
} satisfies Record<components['schemas']['GeoAnswerInsightTrend']['unavailable_reasons'][number], string>;

const versionWarnings = {
  MODEL_VERSION_CHANGED: '模型版本变化',
  MODEL_VERSION_UNKNOWN: '模型版本未知',
  PRODUCT_VERSION_CHANGED: '产品版本变化',
  PRODUCT_VERSION_UNKNOWN: '产品版本未知',
} satisfies Record<components['schemas']['GeoAnswerInsightTrend']['version_warnings'][number], string>;

function Trends({ insights, onDrilldown }: Props) {
  return (
    <InsightSection id="trends" title="趋势与前期比较">
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border-subtle bg-surface-raised/50 px-3.5 py-2.5 text-xs text-text-secondary">
        <span>当期：{formatTime(insights.current_window.date_from)} 至 {formatTime(insights.current_window.date_to)}（不含）</span>
        <span>前期：{formatTime(insights.previous_window.date_from)} 至 {formatTime(insights.previous_window.date_to)}（不含）</span>
      </div>
      <p className="text-xs text-text-secondary">仅展示服务端返回的两个窗口。缺样本保留空值；不可比时不连接趋势线。</p>
      {!insights.trends.length && <p className="text-sm text-text-secondary">当前筛选没有可比较的趋势。</p>}
      <div className="space-y-4">
        {insights.trends.map((trend) => {
          const current = trend.current_cell_keys.map((key) => insightCell(insights.current_cells, key));
          const previous = trend.previous_cell_keys.map((key) => insightCell(insights.previous_cells, key));
          const first = previous.length === 1 && previous[0] ? metricIn(previous[0], trend.metric_code).value : null;
          const last = current.length === 1 && current[0] ? metricIn(current[0], trend.metric_code).value : null;
          const displayName = current[0]?.display_name ?? previous[0]?.display_name;
          const deltaText = formatPoints(trend.change_points);

          return (
            <div
              className="space-y-3 rounded-xl border border-border-subtle bg-surface-raised/25 p-4"
              key={`${trend.subject_id}-${trend.prompt_variant_id}-${trend.collection_profile_id}-${trend.metric_code}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {metricLabels[trend.metric_code]} · {displayName ?? `对象 ${trend.subject_id}`}
                  </h3>
                  {displayName && (
                    <p className="break-all font-mono text-[11px] text-text-tertiary">对象 {trend.subject_id}</p>
                  )}
                </div>
                <DeltaIndicator
                  changePoints={trend.change_points}
                  formattedDelta={deltaText}
                  invertTone={trend.metric_code === 'severe_error_run_rate'}
                />
              </div>

              <p className="text-xs text-text-secondary tabular-nums">
                变化：{deltaText} · 相对变化：{trend.relative_change === null ? '不可比较' : formatRate(trend.relative_change)} · 每窗最低运行数：{trend.minimum_run_count}
              </p>

              {trend.unavailable_reasons.length > 0 && (
                <InlineBanner role="status" tone="info">
                  不可比较：{trend.unavailable_reasons.map((reason) => trendReasons[reason]).join('；')}
                </InlineBanner>
              )}
              {trend.changed_dimensions.length > 0 && (
                <p className="break-all text-xs text-text-secondary">维度变化：{trend.changed_dimensions.join('、')}</p>
              )}
              {trend.version_warnings.length > 0 && (
                <InlineBanner role="status" tone="warning">
                  版本提示：{trend.version_warnings.map((warning) => versionWarnings[warning]).join('；')}
                </InlineBanner>
              )}

              <div className="max-w-md rounded-lg border border-border-subtle bg-surface-panel p-3">
                <ComparisonBar
                  current={last}
                  currentLabel={formatRate(last)}
                  previous={first}
                  previousLabel={formatRate(first)}
                />
              </div>

              <MetadataDisclosure
                summary="前期与当期趋势明细表"
                summaryMeta={`前期 ${previous.length} · 当期 ${current.length}`}
              >
                <div className="grid min-w-0 gap-3 pt-1 lg:grid-cols-2">
                  <CellTable
                    cells={previous}
                    codes={[trend.metric_code]}
                    label={`${metricLabels[trend.metric_code]}前期趋势数据表`}
                    onDrilldown={onDrilldown}
                  />
                  <CellTable
                    cells={current}
                    codes={[trend.metric_code]}
                    label={`${metricLabels[trend.metric_code]}当期趋势数据表`}
                    onDrilldown={onDrilldown}
                  />
                </div>
              </MetadataDisclosure>
            </div>
          );
        })}
      </div>
    </InsightSection>
  );
}

const classifications = {
  DATA_INSUFFICIENT: '数据不足',
  NOT_VISIBLE: '未可见',
  OCCASIONAL: '偶发可见',
  STABLE: '稳定可见',
} satisfies Record<NonNullable<components['schemas']['GeoQuestionVariantCoverage']['classification']>, string>;

function classificationVariant(
  classification: components['schemas']['GeoQuestionVariantCoverage']['classification'],
): 'success' | 'info' | 'warning' | 'secondary' {
  switch (classification) {
    case 'STABLE': return 'success';
    case 'OCCASIONAL': return 'info';
    case 'NOT_VISIBLE': return 'warning';
    default: return 'secondary';
  }
}

function QuestionCoverage({ insights, onDrilldown }: Props) {
  return (
    <InsightSection id="questions" title="问题覆盖">
      {!insights.question_coverage.length && <p className="text-sm text-text-secondary">当前筛选没有问题覆盖数据。</p>}
      {insights.question_coverage.map((coverage) => {
        const matchedCell = insights.current_cells.find((cell) => cell.subject_id === coverage.subject_id);
        return (
          <div className="space-y-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0" key={`${coverage.subject_id}-${coverage.stratum_key}`}>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-text-primary">
                {matchedCell?.display_name ?? `对象 ${coverage.subject_id}`}
              </p>
              <p className="break-all font-mono text-[11px] text-text-tertiary">
                对象 {coverage.subject_id} · 分层 {coverage.stratum_key}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border-subtle bg-surface-raised/35 p-3">
                <CoverageProgress
                  label="目标主题覆盖率"
                  targetRate={coverage.target_rate}
                  value={coverage.target_topic_coverage}
                  valueLabel={`${formatRate(coverage.target_topic_coverage)}（${coverage.numerator} / ${coverage.monitored_denominator}）`}
                />
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-raised/35 p-3">
                <CoverageProgress
                  label="合格主题正向覆盖率"
                  targetRate={coverage.target_rate}
                  value={coverage.positive_topic_coverage}
                  valueLabel={`${formatRate(coverage.positive_topic_coverage)}（${coverage.numerator} / ${coverage.eligible_denominator}）`}
                />
              </div>
            </div>
            <p className="text-xs text-text-secondary">
              目标主题覆盖率 {formatRate(coverage.target_topic_coverage)}（{coverage.numerator} / {coverage.monitored_denominator}） · 合格主题正向覆盖率 {formatRate(coverage.positive_topic_coverage)}（{coverage.numerator} / {coverage.eligible_denominator}）
            </p>
            <p className="text-xs text-text-tertiary">
              目标率 {formatRate(coverage.target_rate)} · 可报告最低 {coverage.reportable_minimum} 次 · 稳定最低 {coverage.stable_minimum} 次
            </p>
            <MetadataDisclosure summary="主题集合">
              <div className="space-y-1 break-all">
                <p>监测：{coverage.monitored_topic_ids.join('、')}</p>
                <p>合格：{coverage.eligible_topic_ids.join('、')}</p>
                <p>达到目标：{coverage.reached_topic_ids.join('、')}</p>
              </div>
            </MetadataDisclosure>
            <TableShell regionLabel="问题覆盖分类表">
              <thead>
                <tr>
                  <th scope="col">问题与采集维度</th>
                  <th data-column-role="status" scope="col">分类</th>
                  <th data-column-role="status" scope="col">目标达成</th>
                  <th scope="col">自然可见率</th>
                </tr>
              </thead>
              <tbody>
                {coverage.variant_results.map((variant) => {
                  const cell = insightCell(insights.current_cells, variant.cell_key);
                  return (
                    <tr key={variant.cell_key}>
                      <th className="align-top" scope="row"><CellIdentity cell={cell} /></th>
                      <td className="align-top" data-column-role="status">
                        <div className="space-y-1">
                          <Badge variant={classificationVariant(variant.classification)}>
                            {variant.classification === null ? '无可用分类' : classifications[variant.classification]}
                          </Badge>
                          {variant.unavailable_reason && (
                            <p className="text-xs text-text-tertiary">
                              {variant.unavailable_reason === 'INSUFFICIENT_SAMPLE' ? '样本不足' : '稳定性样本不足'}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="align-top" data-column-role="status">
                        <Badge variant={variant.target_reached ? 'success' : 'outline'}>
                          {variant.target_reached ? '已达成' : '未达成'}
                        </Badge>
                      </td>
                      <td className="min-w-56 align-top">
                        <MetricReadout compact metric={metricIn(cell, 'natural_visibility')} onDrilldown={onDrilldown} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        );
      })}
    </InsightSection>
  );
}
