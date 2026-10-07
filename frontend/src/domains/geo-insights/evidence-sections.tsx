import type { ReactNode } from 'react';
import type { components } from '@/shared/api/generated/schema';
import { TableShell } from '@/design-system/data-table/table-shell';
import { Button } from '@/design-system/primitives/button';
import {
  exclusionLabels, formatRate, formatTime, metricLabels, sampleLabels,
  type AnswerInsights, type Drilldown, type OnDrilldown,
} from './insights.model';
import { CellIdentity, InsightSection, safeCitationUrl } from './insights-components';

type Schema = components['schemas'];
type Props = { insights: AnswerInsights; onDrilldown: OnDrilldown };
type Bucket = Schema['GeoInsightCitationBucket'];
type Version = Schema['GeoInsightVersionSummary'];

const sourceLabels = {
  OWNED: '自有信源', COMPETITOR: '竞争对手', INDUSTRY_MEDIA: '行业媒体', DISTRIBUTOR: '分销商',
  COMMUNITY: '社区', SOCIAL: '社交平台', SEARCH_ENGINE: '搜索引擎',
  ACADEMIC_OR_INSTITUTIONAL: '学术或机构', OTHER: '其他', UNKNOWN: '未知来源',
} satisfies Record<Schema['GeoSourceCategory'], string>;
const verdictLabels = { ACCURATE: '准确', PARTIAL: '部分准确', INCORRECT: '错误', UNJUDGEABLE: '不可判断' } satisfies Record<Schema['GeoClaimVerdict'], string>;
const severityLabels = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '严重' } satisfies Record<Schema['GeoClaimSeverity'], string>;
const claimLabels = {
  IDENTITY: '产品身份', PARAMETER: '参数', PACKAGE: '封装', TEMPERATURE_GRADE: '温度等级',
  CERTIFICATION: '认证', LIFECYCLE_STATUS: '生命周期', APPLICATION: '应用',
  REPLACEMENT_RELATION: '替代关系', COMPATIBILITY_CONDITION: '兼容条件', OTHER: '其他',
} satisfies Record<Schema['GeoClaimKind'], string>;
const statusLabels = {
  PENDING: '待运行', RUNNING: '运行中', COLLECTED: '已采集', ANALYZING: '分析中', NEEDS_REVIEW: '待复核',
  COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', BUDGET_BLOCKED: '预算阻止',
} satisfies Record<Schema['GeoRunStatus'], string>;
const noteLabels = {
  SHARED_DOMAIN: '存在共享域名；候选对象不代表最终归属，人工消歧后仍保留共享事实。',
  REVIEW_BACKLOG: '存在待复核运行；业务统计可能因必要复核未完成而排除这些运行。',
  COST_UNKNOWN: '存在未知费用；只汇总已报告金额和币种的运行，未知费用不补零。',
  MODEL_VERSION_UNKNOWN: '存在未知模型版本；版本分组不能代替模型版本覆盖率。',
  MIXED_COLLECTION_VERSIONS: '存在多个采集版本；各版本分组独立展示。',
  MIXED_ANALYSIS_VERSIONS: '存在多个分析版本；各版本分组独立展示。',
  MULTIPLE_DIMENSIONS: '存在多个完整维度；业务 cell 不合并计算。',
} satisfies Record<AnswerInsights['data_quality']['notes'][number], string>;

function labelFor(labels: Record<string, string>, value: string) {
  return Object.hasOwn(labels, value) ? labels[value] : `未支持的类型：${value}`;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-secondary" role="status">{children}</p>;
}
function DetailButton({ descriptor, label, onDrilldown }: { descriptor: Drilldown; label: string; onDrilldown: OnDrilldown }) {
  return <Button aria-label={label} className="min-h-11 sm:min-h-8" onClick={() => onDrilldown(descriptor)} size="sm" variant="outline">{label.split('：')[0]}</Button>;
}
function EvidenceCellIdentity({ insights, cellKey, subjectId }: { insights: AnswerInsights; cellKey: string; subjectId: string }) {
  const cell = insights.current_cells.find((entry) => entry.cell_key === cellKey && entry.subject_id === subjectId);
  return <div className="min-w-0 space-y-2">
    <h3 className="sr-only">{cell?.display_name ?? '对象身份不可读取'} · {cellKey}</h3>
    <p className="break-all text-sm text-text-secondary">对象 ID：{subjectId} · Cell：{cellKey}</p>
    {cell ? <CellIdentity cell={cell} /> : <Empty>当前响应缺少此 cell 的完整维度，请重新读取摘要。</Empty>}
  </div>;
}
function CitationUrl({ value }: { value: string }) {
  const href = safeCitationUrl(value);
  return <details className="max-w-72 whitespace-normal">
    <summary className="table-cell-ellipsis block max-w-72 cursor-pointer truncate">{value}</summary>
    <div className="mt-2 break-all">{href
      ? <a className="text-primary underline" href={href} rel="noopener noreferrer" target="_blank">{value}</a>
      : <><span>{value}</span><p className="text-text-secondary">不支持打开此链接。</p></>}
    </div>
  </details>;
}
function CitationBuckets({ rows, title, cellKey, kind, onDrilldown }: {
  rows: Bucket[]; title: string; cellKey: string; kind: 'domain' | 'url' | 'source'; onDrilldown: OnDrilldown;
}) {
  const name = `${title} · ${cellKey}`;
  return <div className="min-w-0 space-y-2">
    <h4 className="font-medium text-sm">{title}</h4>
    {!rows.length ? <Empty>当前 cell 暂无{title}。</Empty> : <TableShell regionLabel={name}>
      <caption className="sr-only">{name}；覆盖率分母为合格运行，份额分母为引用事件。</caption>
      <thead><tr>
        <th scope="col">{title}</th><th scope="col">引用事件数</th><th scope="col">不同运行数</th>
        <th scope="col">覆盖率 / 合格运行分母</th><th scope="col">份额 / 引用事件分母</th>
        <th scope="col">主题与观测面</th><th scope="col">组成明细</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <th className="max-w-72 break-all font-normal" scope="row">{kind === 'url' ? <CitationUrl value={row.key} /> : kind === 'source' ? labelFor(sourceLabels, row.key) : row.key}</th>
        <td>{row.citation_count}</td><td>{row.run_count}</td>
        <td>{formatRate(row.coverage_value)}<br />分母：{row.coverage_denominator}</td>
        <td>{formatRate(row.share_value)}<br />分母：{row.share_denominator}</td>
        <td className="max-w-64 whitespace-normal"><details><summary className="cursor-pointer">完整身份</summary>
          <dl className="mt-2 break-all"><dt>问题主题 ID</dt><dd>{row.query_topic_ids.join('、') || '无'}</dd>
            <dt>观测面 ID</dt><dd>{row.engine_surface_ids.join('、') || '无'}</dd></dl>
        </details></td>
        <td><DetailButton descriptor={row.drilldown} label={`引用明细：${row.key}`} onDrilldown={onDrilldown} /></td>
      </tr>)}</tbody>
    </TableShell>}
  </div>;
}

export function CitationInsights({ insights, onDrilldown }: Props) {
  return <InsightSection id="citations" title="引用分析">
    <p className="text-sm text-text-secondary">当前窗口按完整 cell 展示。精确域名不合并，URL 参数不折叠；引用事件数不提升运行样本等级。</p>
    {insights.unavailable_sections.includes('CITATION_INSIGHTS') ? <Empty>服务端尚未支持引用分析区块。</Empty>
      : !insights.citation_insights.length ? <Empty>当前筛选暂无引用摘要。</Empty>
        : insights.citation_insights.map((summary) => <article className="min-w-0 space-y-4 border-t border-border-subtle pt-4" key={summary.cell_key}>
          <EvidenceCellIdentity cellKey={summary.cell_key} insights={insights} subjectId={summary.subject_id} />
          <div className="flex flex-wrap items-center gap-3"><p className="text-sm">引用事件数：{summary.citation_count}</p>
            <DetailButton descriptor={summary.drilldown} label={`全部引用明细：${summary.cell_key}`} onDrilldown={onDrilldown} /></div>
          <CitationBuckets cellKey={summary.cell_key} kind="domain" onDrilldown={onDrilldown} rows={summary.domains} title="域名" />
          <CitationBuckets cellKey={summary.cell_key} kind="url" onDrilldown={onDrilldown} rows={summary.urls} title="URL" />
          <CitationBuckets cellKey={summary.cell_key} kind="source" onDrilldown={onDrilldown} rows={summary.source_categories} title="来源类别" />
        </article>)}
  </InsightSection>;
}
function RiskCounts({ counts, title, cellKey, labels }: { counts: Record<string, number>; title: string; cellKey: string; labels: Record<string, string> }) {
  const rows = Object.entries(counts);
  return <div className="min-w-0 space-y-2"><h4 className="font-medium text-sm">{title}</h4>
    {!rows.length ? <Empty>当前 cell 暂无{title}。</Empty> : <TableShell regionLabel={`${title} · ${cellKey}`}>
      <caption className="sr-only">{title} · {cellKey}</caption>
      <thead><tr><th scope="col">{title}</th><th scope="col">声明数</th></tr></thead>
      <tbody>{rows.map(([key, count]) => <tr key={key}><th className="font-normal" scope="row">{labelFor(labels, key)}</th><td>{count}</td></tr>)}</tbody>
    </TableShell>}
  </div>;
}
export function FactRisks({ insights, onDrilldown }: Props) {
  return <InsightSection id="risks" title="事实风险">
    <p className="text-sm text-text-secondary">不可判断声明可查看明细，但不进入可判断声明比例；严重错误口径由服务端裁决。</p>
    {insights.unavailable_sections.includes('FACT_RISKS') ? <Empty>服务端尚未支持事实风险区块。</Empty>
      : !insights.fact_risks.length ? <Empty>当前筛选暂无事实风险摘要。</Empty>
        : insights.fact_risks.map((summary) => <article className="min-w-0 space-y-4 border-t border-border-subtle pt-4" key={summary.cell_key}>
          <EvidenceCellIdentity cellKey={summary.cell_key} insights={insights} subjectId={summary.subject_id} />
          <div className="flex flex-wrap items-center gap-3"><p className="text-sm">声明数：{summary.claim_count}</p>
            <DetailButton descriptor={summary.drilldown} label={`全部声明明细：${summary.cell_key}`} onDrilldown={onDrilldown} /></div>
          <RiskCounts cellKey={summary.cell_key} counts={summary.verdict_counts} labels={verdictLabels} title="判定分布" />
          <RiskCounts cellKey={summary.cell_key} counts={summary.incorrect_severity_counts} labels={severityLabels} title="错误声明严重度" />
          <h4 className="font-medium text-sm">声明联合分组</h4>
          {!summary.groups.length ? <Empty>当前 cell 暂无声明联合分组。</Empty> : <TableShell regionLabel={`声明联合分组 · ${summary.cell_key}`}>
            <caption className="sr-only">声明联合分组 · {summary.cell_key}</caption>
            <thead><tr><th scope="col">声明类型</th><th scope="col">判定</th><th scope="col">严重度</th>
              <th scope="col">声明数</th><th scope="col">不同运行数</th><th scope="col">组成明细</th></tr></thead>
            <tbody>{summary.groups.map((row) => <tr key={`${row.claim_kind}:${row.verdict}:${row.severity}`}>
              <th className="font-normal" scope="row">{labelFor(claimLabels, row.claim_kind)}</th>
              <td>{labelFor(verdictLabels, row.verdict)}</td><td>{labelFor(severityLabels, row.severity)}</td>
              <td>{row.claim_count}</td><td>{row.run_count}</td>
              <td><DetailButton descriptor={row.drilldown} label={`声明明细：${labelFor(claimLabels, row.claim_kind)} / ${labelFor(verdictLabels, row.verdict)} / ${labelFor(severityLabels, row.severity)}`} onDrilldown={onDrilldown} /></td>
            </tr>)}</tbody>
          </TableShell>}
        </article>)}
  </InsightSection>;
}
function Versions({ rows, title, analysis, onDrilldown }: { rows: Version[]; title: string; analysis: boolean; onDrilldown: OnDrilldown }) {
  return <div className="min-w-0 space-y-2"><h3 className="font-medium">{title}</h3>
    {!rows.length ? <Empty>当前筛选暂无{title}分组。</Empty> : <TableShell regionLabel={title}>
      <caption className="sr-only">{title}；未知值保持未知，版本分组不替代覆盖率。</caption>
      <thead><tr><th scope="col">版本分组标识</th>
        {analysis ? <><th scope="col">分析器版本</th><th scope="col">规则集版本</th><th scope="col">分析配置指纹</th></>
          : <><th scope="col">来源模型</th><th scope="col">来源产品</th><th scope="col">来源版本</th></>}
        <th scope="col">运行数</th><th scope="col">组成明细</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.version_key}>
        <th className="max-w-64 break-all whitespace-normal font-normal" scope="row">{row.version_key}</th>
        {(analysis ? [row.analyzer_version, row.rule_set_version, row.analysis_configuration_key]
          : [row.source_model, row.source_product, row.source_version]).map((value, index) => <td className="max-w-64 break-all whitespace-normal" key={index}>{value ?? '未知'}</td>)}
        <td>{row.run_count}</td><td><DetailButton descriptor={row.drilldown} label={`${title}明细：${row.version_key}`} onDrilldown={onDrilldown} /></td>
      </tr>)}</tbody>
    </TableShell>}
  </div>;
}
export function InsightDataQuality({ insights, onDrilldown }: Props) {
  const quality = insights.data_quality;
  const overview = quality.overview;
  return <InsightSection id="quality" title="数据质量">
    {insights.unavailable_sections.includes('DATA_QUALITY') ? <Empty>服务端尚未支持数据质量区块。</Empty> : <>
      <p className="text-sm text-text-secondary">同筛选候选运行的操作统计；不跨 cell 汇总业务比例。摘要时间：{formatTime(insights.as_of)}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-text-muted">候选运行</dt><dd>{overview.candidate_run_count}</dd></div>
        <div><dt className="text-text-muted">合格运行</dt><dd>{overview.eligible_run_count}</dd></div>
        <div><dt className="text-text-muted">排除运行（去重）</dt><dd>{overview.excluded_run_count}</dd></div>
        <div><dt className="text-text-muted">完整维度数</dt><dd>{overview.dimension_count}</dd></div>
      </dl>
      <DetailButton descriptor={quality.excluded_drilldown} label="排除运行明细" onDrilldown={onDrilldown} />
      {!overview.exclusion_reason_counts.length ? <Empty>当前筛选无排除原因记录。</Empty> : <TableShell regionLabel="排除原因">
        <caption className="sr-only">排除原因允许重叠，不同原因的运行数不可相加。</caption>
        <thead><tr><th scope="col">排除原因（可重叠）</th><th scope="col">运行数</th></tr></thead>
        <tbody>{overview.exclusion_reason_counts.map((row) => <tr key={row.code}><th className="font-normal" scope="row">{labelFor(exclusionLabels, row.code)}</th><td>{row.run_count}</td></tr>)}</tbody>
      </TableShell>}
      {!Object.keys(overview.status_counts).length ? <Empty>当前筛选暂无运行状态统计。</Empty> : <TableShell regionLabel="运行状态统计">
        <caption className="sr-only">候选运行状态统计</caption><thead><tr><th scope="col">运行状态</th><th scope="col">运行数</th></tr></thead>
        <tbody>{Object.entries(overview.status_counts).map(([status, count]) => <tr key={status}><th className="font-normal" scope="row">{labelFor(statusLabels, status)}</th><td>{count}</td></tr>)}</tbody>
      </TableShell>}
      {!overview.cards.length ? <Empty>当前筛选暂无质量指标。</Empty> : <TableShell regionLabel="质量指标">
        <caption className="sr-only">质量指标；数值、分子、分母和样本等级均为服务端结果。</caption>
        <thead><tr><th scope="col">质量指标 / 公式版本</th><th scope="col">数值</th><th scope="col">分子 / 分母</th>
          <th scope="col">样本等级</th><th scope="col">合格 / 排除运行</th><th scope="col">排除与不可判断</th><th scope="col">组成明细</th></tr></thead>
        <tbody>{overview.cards.map((card) => <tr key={card.metric_code}>
          <th className="font-normal" scope="row">{labelFor(metricLabels, card.metric_code)}<br />{card.formula_version}</th>
          <td>{formatRate(card.value)}</td><td>{card.numerator} / {card.denominator}</td><td>{labelFor(sampleLabels, card.sample_level)}</td>
          <td>{card.eligible_run_count} / {card.excluded_run_count}</td>
          <td className="max-w-64 whitespace-normal"><details><summary className="cursor-pointer">指标口径明细</summary>
            <p>不可判断声明数：{card.unjudgeable_claim_count}</p>
            <p>不可计算原因：{card.unavailable_reason === null ? '无' : card.unavailable_reason === 'NO_DENOMINATOR' ? '无可用分母' : `未支持的原因：${card.unavailable_reason}`}</p>
            {card.exclusion_reason_counts.length ? <ul>{card.exclusion_reason_counts.map((row) => <li key={row.code}>{labelFor(exclusionLabels, row.code)}：{row.run_count}</li>)}</ul> : <p>无排除原因记录。</p>}
          </details></td>
          <td><DetailButton descriptor={card.drilldown} label={`质量明细：${labelFor(metricLabels, card.metric_code)}`} onDrilldown={onDrilldown} /></td>
        </tr>)}</tbody>
      </TableShell>}
      <div className="flex flex-wrap items-center gap-3"><p className="text-sm">共享域名：{quality.shared_domain_citation_count} 条引用事件 / {quality.shared_domain_run_count} 个不同运行。共享候选不代表最终归属。</p>
        <DetailButton descriptor={quality.shared_domain_drilldown} label="共享域名运行明细" onDrilldown={onDrilldown} /></div>
      <div className="min-w-0 space-y-2"><h3 className="font-medium">已知费用（按币种）</h3>
        <p className="text-sm text-text-secondary">仅含已报告费用，零金额保留为真实零；未知费用不补零，不换币或合并币种。</p>
        {!quality.known_costs.length ? <Empty>当前筛选暂无已知费用。</Empty> : <TableShell regionLabel="已知费用">
          <caption className="sr-only">已知费用按币种独立展示；总额及均价保留服务端精度。</caption>
          <thead><tr><th scope="col">币种</th><th scope="col">已知费用运行数</th><th scope="col">总额</th><th scope="col">均价</th><th scope="col">组成明细</th></tr></thead>
          <tbody>{quality.known_costs.map((row) => <tr key={row.currency}><th className="font-normal" scope="row">{row.currency}</th>
            <td>{row.known_run_count}</td><td>{row.total_amount}</td><td>{row.average_amount}</td>
            <td><DetailButton descriptor={row.drilldown} label={`费用运行明细：${row.currency}`} onDrilldown={onDrilldown} /></td></tr>)}</tbody>
        </TableShell>}
      </div>
      <Versions analysis={false} onDrilldown={onDrilldown} rows={quality.collection_versions} title="采集版本" />
      <Versions analysis onDrilldown={onDrilldown} rows={quality.analysis_versions} title="分析版本" />
      <div className="space-y-2"><h3 className="font-medium">质量说明</h3>
        {quality.notes.length ? <ul className="list-inside list-disc space-y-1 text-sm">{quality.notes.map((note) => <li key={note}>{labelFor(noteLabels, note)}</li>)}</ul> : <Empty>服务端未返回额外质量说明。</Empty>}
      </div>
    </>}
  </InsightSection>;
}
