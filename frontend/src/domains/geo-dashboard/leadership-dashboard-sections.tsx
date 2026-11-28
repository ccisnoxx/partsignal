import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import type { LeadershipDashboard, LeadershipRateMetric } from './leadership-dashboard.api';
import type { EvidenceSelection } from './leadership-evidence-drawer';
import {
  collectionModeLabels,
  formatCi,
  formatDeltaPp,
  formatRate,
  formatShortDateTime,
  verificationStatusLabels,
} from './leadership-dashboard.model';

type Props = {
  data: LeadershipDashboard;
  onInspectEvidence?: (selection: EvidenceSelection) => void;
  isPrint?: boolean;
};

function RateSubline({ metric }: { metric: LeadershipRateMetric }) {
  const ci = formatCi(metric.ci_95);
  return (
    <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
      <p>
        样本：{metric.numerator} / {metric.denominator}
        {metric.previous_denominator > 0
          ? ` · 上期 ${metric.previous_numerator}/${metric.previous_denominator}`
          : ''}
      </p>
      <p className="font-medium text-text-primary">{formatDeltaPp(metric.delta_pp)}</p>
      {ci && <p className="text-text-tertiary">{ci}</p>}
    </div>
  );
}

export function LeadershipDashboardView({ data, onInspectEvidence, isPrint = false }: Props) {
  const { summary_cards: cards, data_quality: quality } = data;
  const surfaceColumns = data.platform_comparisons;

  return (
    <div className="space-y-6">
      {data.comparability_warnings.length > 0 && (
        <InlineBanner tone="warning">
          <div className="space-y-1">
            <p className="font-medium">统计口径与样本完整性提示</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {data.comparability_warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </InlineBanner>
      )}

      {quality.needs_review_count > 0 && (
        <InlineBanner tone="info">
          当前窗口仍有 <strong>待判断 {quality.needs_review_count} 条</strong>（含待确认候选引用{' '}
          {quality.pending_candidate_links_count} 条），未纳入有效命中分母；完成确认后看板将实时刷新。
        </InlineBanner>
      )}

      {/* 4 个核心效果卡片 */}
      <section aria-label="核心效果指标" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-text-secondary">自然提及率</h3>
            <Badge variant="outline">
              {cards.perspective === 'SINGLE_PRODUCT'
                ? `单产品：${cards.selected_product_label ?? '指定产品'}`
                : '公司总览'}
            </Badge>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            {formatRate(cards.natural_mention_rate.rate)}
          </p>
          <RateSubline metric={cards.natural_mention_rate} />
          <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
            {cards.perspective === 'COMPANY' ? (
              <>
                <p>
                  品牌分项：{formatRate(cards.brand_mention_breakdown.rate)}（
                  {cards.brand_mention_breakdown.numerator}/{cards.brand_mention_breakdown.denominator}）
                </p>
                <p>
                  产品分项：{formatRate(cards.product_mention_breakdown.rate)}（
                  {cards.product_mention_breakdown.numerator}/{cards.product_mention_breakdown.denominator}）
                </p>
              </>
            ) : (
              <p>
                公司品牌侧注：{formatRate(cards.brand_mention_breakdown.rate)}（
                {cards.brand_mention_breakdown.numerator}/{cards.brand_mention_breakdown.denominator}）
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-text-secondary">文章引用命中率</h3>
            <Badge variant="outline">回答级去重</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            {formatRate(cards.article_citation_hit_rate.rate)}
          </p>
          <RateSubline metric={cards.article_citation_hit_rate} />
          <p className="mt-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
            未完整检查引用：{cards.citation_unobserved_count} 条（单独列示，不计为未命中）
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-text-secondary">核心问题命中覆盖</h3>
            <Badge variant="outline">固定核心问题</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            {cards.core_question_coverage.hit_questions} /{' '}
            {cards.core_question_coverage.total_core_questions}
          </p>
          <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
            <p>覆盖率：{formatRate(cards.core_question_coverage.coverage_rate)}</p>
            <p>
              已采样 {cards.core_question_coverage.sampled_questions} 题 · 未采样缺口{' '}
              {cards.core_question_coverage.unsampled_questions} 题
            </p>
          </div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
            未采样问题不解释为无效果
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-text-secondary">首次被引文章数</h3>
            <Badge variant="outline">去重发布 URL</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            {cards.first_cited_articles.first_cited_count}
          </p>
          <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
            <p>本期累计被引发布数：{cards.first_cited_articles.total_cited_publications_in_period}</p>
          </div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
            {cards.first_cited_articles.note}
          </p>
        </div>
      </section>

      {/* 次级指标与采样数据质量（与效果分拆，不合并成总分） */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4">
          <h3 className="text-xs font-medium text-text-secondary">次级指标：明确推荐率</h3>
          <p className="mt-1 text-lg font-semibold text-text-primary">
            {formatRate(cards.recommendation_rate.rate)}{' '}
            <span className="text-xs font-normal text-text-secondary">
              （{cards.recommendation_rate.numerator}/{cards.recommendation_rate.denominator}）
            </span>
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            无法判断/未填：{cards.recommendation_unknown_count} 条（不计入否定推荐）
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-text-secondary">
              采样完成与数据质量（工作量辅助，不代表 GEO 效果）
            </h3>
            <span className="text-xs text-text-tertiary">
              口径时间：{formatShortDateTime(data.period_from)} — {formatShortDateTime(data.period_to)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">
              有效完成 {quality.completed_valid_count} / 计划 {quality.planned_total}
            </Badge>
            <Badge variant={quality.needs_review_count > 0 ? 'warning' : 'outline'}>
              待判断 {quality.needs_review_count}
            </Badge>
            <Badge variant="outline">待采集 {quality.pending_count}</Badge>
            <Badge variant={quality.failed_count > 0 ? 'destructive' : 'outline'}>
              采集异常 {quality.failed_count}
            </Badge>
            <Badge variant="outline">已改问排除 {quality.query_modified_excluded_count}</Badge>
            <Badge variant="outline">探索性排除 {quality.exploratory_excluded_count}</Badge>
            <Badge variant="outline">历史补录 {quality.backfill_count}</Badge>
          </div>
        </div>
      </section>

      {/* 趋势序列（空桶断线，不补 0） */}
      <section className="rounded-xl border border-border-subtle bg-surface-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            趋势变化（{data.bucket_granularity === 'WEEK' ? '按周' : '按日'}，无采样桶显示“暂无数据”不补零）
          </h3>
        </div>
        {data.trend_series.length === 0 ? (
          <p className="text-sm text-text-secondary">当前周期暂无趋势数据。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-tertiary">
                  <th className="py-2 pr-3 font-medium">时间桶</th>
                  <th className="py-2 pr-3 font-medium">自然提及率</th>
                  <th className="py-2 pr-3 font-medium">提及可视化</th>
                  <th className="py-2 pr-3 font-medium">文章引用命中率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.trend_series.map((bucket) => (
                  <tr key={bucket.bucket_key}>
                    <td className="py-2 pr-3 font-medium text-text-primary">{bucket.label}</td>
                    <td className="py-2 pr-3 text-text-primary">
                      {formatRate(bucket.natural_mention_rate)}
                      <span className="ml-1 text-text-tertiary">
                        ({bucket.mention_numerator}/{bucket.mention_denominator})
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {bucket.natural_mention_rate === null || bucket.natural_mention_rate === undefined ? (
                        <span className="text-text-tertiary">— 断线（暂无样本）</span>
                      ) : (
                        <div className="h-2.5 w-36 overflow-hidden rounded-full bg-surface-raised">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(bucket.natural_mention_rate * 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-text-primary">
                      {formatRate(bucket.citation_hit_rate)}
                      <span className="ml-1 text-text-tertiary">
                        ({bucket.citation_numerator}/{bucket.citation_denominator})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 分平台与分采集方式对比（禁止跨入口平均百分比） */}
      <section className="rounded-xl border border-border-subtle bg-surface-panel p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          分平台效果对比（按平台与采集方式独立统计）
        </h3>
        {surfaceColumns.length === 0 ? (
          <p className="text-sm text-text-secondary">当前周期暂无分平台有效样本。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-tertiary">
                  <th className="py-2 pr-3 font-medium">平台</th>
                  <th className="py-2 pr-3 font-medium">采集方式</th>
                  <th className="py-2 pr-3 font-medium">自然提及率</th>
                  <th className="py-2 pr-3 font-medium">文章引用命中率</th>
                  <th className="py-2 pr-3 font-medium">待判断</th>
                  <th className="py-2 font-medium">采集异常</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {surfaceColumns.map((row) => (
                  <tr key={`${row.surface_id}-${row.collection_mode}`}>
                    <td className="py-2 pr-3 font-medium text-text-primary">{row.platform_name}</td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {collectionModeLabels[row.collection_mode] ?? row.collection_mode}
                    </td>
                    <td className="py-2 pr-3 text-text-primary">
                      {formatRate(row.natural_mention_rate)} ({row.mention_numerator}/{row.mention_denominator})
                    </td>
                    <td className="py-2 pr-3 text-text-primary">
                      {formatRate(row.citation_hit_rate)} ({row.citation_numerator}/{row.citation_denominator})
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">{row.needs_review_count}</td>
                    <td className="py-2 text-text-secondary">{row.failed_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 核心问题 × 平台矩阵（点击下钻原始证据） */}
      <section className="rounded-xl border border-border-subtle bg-surface-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            问题 × 平台覆盖矩阵{!isPrint && '（点击单元格查看原始回答与引用证据）'}
          </h3>
        </div>
        {data.question_platform_matrix.length === 0 ? (
          <p className="text-sm text-text-secondary">当前周期暂无矩阵数据。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-tertiary">
                  <th className="py-2 pr-3 font-medium">核心问题</th>
                  {data.question_platform_matrix[0]?.cells.map((cell) => (
                    <th className="py-2 pr-3 font-medium" key={cell.surface_id}>
                      {cell.platform_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.question_platform_matrix.map((row) => (
                  <tr key={row.prompt_variant_id}>
                    <td className="max-w-sm py-2 pr-3 font-medium text-text-primary">
                      {row.prompt_text}
                    </td>
                    {row.cells.map((cell) => {
                      const runIds = cell.run_ids ?? [];
                      const clickable = Boolean(onInspectEvidence && runIds.length > 0 && !isPrint);
                      return (
                        <td className="py-2 pr-3" key={cell.surface_id}>
                          {cell.valid_count === 0 && cell.needs_review_count === 0 && cell.failed_count === 0 ? (
                            <span className="text-text-tertiary">未采样</span>
                          ) : clickable ? (
                            <button
                              className="rounded border border-border-subtle bg-surface-app px-2 py-1 text-left transition-colors hover:border-primary hover:bg-surface-selected"
                              onClick={() =>
                                onInspectEvidence?.({
                                  title: `${row.prompt_text} · ${cell.platform_name}`,
                                  params: { run_id: runIds },
                                })
                              }
                              type="button"
                            >
                              <span className="font-medium text-text-primary">
                                提及 {cell.mention_hit_count}/{cell.valid_count}
                              </span>
                              <span className="block text-[11px] text-text-secondary">
                                引用 {cell.citation_hit_count}
                                {cell.needs_review_count > 0 ? ` · 待判 ${cell.needs_review_count}` : ''}
                                {cell.failed_count > 0 ? ` · 异常 ${cell.failed_count}` : ''}
                              </span>
                            </button>
                          ) : (
                            <div className="text-text-primary">
                              提及 {cell.mention_hit_count}/{cell.valid_count} · 引用 {cell.citation_hit_count}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 已发布文章引用表现榜单 */}
      <section className="rounded-xl border border-border-subtle bg-surface-panel p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          已发布文章引用表现（按发布 URL 归因）
        </h3>
        {data.article_performance.length === 0 ? (
          <p className="text-sm text-text-secondary">当前周期暂无已确认或精确匹配的文章引用记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-tertiary">
                  <th className="py-2 pr-3 font-medium">文章与发布链接</th>
                  <th className="py-2 pr-3 font-medium">发布平台</th>
                  <th className="py-2 pr-3 font-medium">核验状态</th>
                  <th className="py-2 pr-3 font-medium">本期被引回答数</th>
                  <th className="py-2 pr-3 font-medium">首次被引时间</th>
                  {!isPrint && <th className="py-2 font-medium">证据</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.article_performance.map((row) => (
                  <tr key={row.article_publication_id}>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-text-primary">{row.article_title}</span>
                        {row.is_first_cited_in_period && <Badge variant="success">本期首次被引</Badge>}
                      </div>
                      <a
                        className="mt-0.5 block max-w-md truncate text-[11px] text-primary hover:underline"
                        href={row.final_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {row.final_url}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">{row.platform_name}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">
                        {verificationStatusLabels[row.verification_status] ?? row.verification_status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-semibold text-text-primary">{row.cited_run_count}</td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {formatShortDateTime(row.first_cited_at)}
                    </td>
                    {!isPrint && (
                      <td className="py-2">
                        {onInspectEvidence && (row.sample_run_ids?.length ?? 0) > 0 && (
                          <button
                            className="text-primary hover:underline"
                            onClick={() =>
                              onInspectEvidence({
                                title: `文章引用：${row.article_title}`,
                                params: { article_publication_id: row.article_publication_id },
                              })
                            }
                            type="button"
                          >
                            查看被引回答
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 品牌/型号定向查询 与 文章定位核查（明确独立展示） */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">品牌 / 型号定向问题</h3>
            <Badge variant="secondary">独立展示，不计入自然提及率</Badge>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            总采样 {data.brand_model_section.total_runs} · 有效完成{' '}
            {data.brand_model_section.valid_completed_runs} · 提及命中{' '}
            {data.brand_model_section.mention_hit_runs} · 引用命中{' '}
            {data.brand_model_section.citation_hit_runs} · 待判断{' '}
            {data.brand_model_section.needs_review_runs}
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">文章定位核查</h3>
            <Badge variant="secondary">独立展示，不计入自然提及率</Badge>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            总采样 {data.article_lookup_section.total_runs} · 有效完成{' '}
            {data.article_lookup_section.valid_completed_runs} · 引用定位命中{' '}
            {data.article_lookup_section.citation_hit_runs} · 待判断{' '}
            {data.article_lookup_section.needs_review_runs}
          </p>
        </div>
      </section>
    </div>
  );
}
