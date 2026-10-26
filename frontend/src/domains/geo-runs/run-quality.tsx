import type { components } from '@/shared/api/generated/schema';
import { exclusionLabels, metricLabels } from '@/shared/lib/geo-metric-labels';
import { TableShell } from '@/design-system/data-table/table-shell';

type Detail = components['schemas']['GeoRunDetail'];
const reviewLabels = {
  NOT_READY: '尚无可复核的当前有效分析', REQUIRED: '仍待人工复核',
  NOT_REQUIRED: '当前分析无需人工复核', REVIEWED: '当前分析已复核',
} satisfies Record<Detail['data_quality']['review_status'], string>;
const roleLabels = { TRIGGER: '触发样本', SUPPORTING: '支持样本', BASELINE: '基线样本', RETEST: '复测样本' };

export function insightHref(filters: NonNullable<Detail['navigation']['insights']>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || (Array.isArray(value) && !value.length)) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  return `/geo/insights/answers?${search}`;
}

export function RunQuality({ detail }: { detail: Detail }) {
  const { data_quality: quality, navigation } = detail;
  return (
    <section aria-label="数据质量与后续导航" className="space-y-4 border-t border-border-subtle pt-4">
      <h3 className="type-section-title">数据质量与指标资格</h3>
      <p className="type-label">{quality.metric_eligible ? '通用资格：可纳入统计候选' : '通用资格：已排除'}</p>
      {quality.exclusion_reasons.length > 0 && (
        <ul className="list-inside list-disc text-sm">
          {quality.exclusion_reasons.map((code) => <li key={code}>{exclusionLabels[code]}</li>)}
        </ul>
      )}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <QualityFact label="当前有效分析" value={quality.current_analysis_status === 'COMPLETED' ? '已完成' : '不可用，查看上方分析记录'} />
        <QualityFact label="复核状态" value={reviewLabels[quality.review_status]} />
        <QualityFact label="统计证据完整性" value={quality.evidence_complete ? '完整' : '未满足证据要求'} />
        <QualityFact label="费用覆盖" value={quality.cost_recorded ? '已记录' : '未知，不计为零'} />
        <QualityFact label="模型版本覆盖" value={quality.model_version_known ? '已知' : '未知，不推断版本'} />
      </dl>
      <p className="text-sm text-text-secondary">
        以下资格复用总览与回答洞察的有效结果口径。具备资格仍可能没有分母贡献；单次运行不代表达到可报告或稳定样本门槛，也不代表表现为零。
      </p>
      {quality.subjects.map((subject) => (
        <details key={subject.subject_id}>
          <summary className="cursor-pointer text-sm">{subject.display_name} · 各指标资格</summary>
          <TableShell regionLabel={`${subject.display_name}指标资格`}>
            <thead><tr><th scope="col">指标</th><th scope="col">资格</th><th scope="col">排除原因</th></tr></thead>
            <tbody>{subject.metrics.map((metric) => (
              <tr key={metric.metric_code}>
                <th className="font-normal" scope="row">{metricLabels[metric.metric_code]}</th>
                <td>{metric.eligible ? '可纳入' : '已排除'}</td>
                <td className="min-w-48">{metric.exclusion_reasons.map((code) => exclusionLabels[code]).join('；') || '无排除原因'}</td>
              </tr>
            ))}</tbody>
          </TableShell>
        </details>
      ))}
      <nav aria-label="运行后续导航" className="space-y-2 text-sm">
        <h4 className="type-label">后续查看与处理</h4>
        {navigation.insights ? (
          <a className="text-interaction-primary underline" href={insightHref(navigation.insights)}>查看同问题与配置的回答洞察（创建日 UTC）</a>
        ) : navigation.insights_unavailable_reason === 'SUPERSEDED_ATTEMPT' ? (
          <p>该运行已被后续尝试替代，不进入当前洞察候选；可在下方尝试链查看最新运行。</p>
        ) : null}
        <p className="text-text-secondary">关联机会保留历史来源版本；导航不会重新评估机会或创建复测。</p>
        {navigation.opportunities.length ? (
          <ul className="space-y-1">{navigation.opportunities.map((link) => (
            <li key={link.opportunity_id}>
              <a className="text-interaction-primary underline" href={`/geo/opportunities?opportunity_id=${link.opportunity_id}`}>关联机会 {link.opportunity_id}</a>
              <span> · {link.source_roles.map((role) => roleLabels[role]).join('、')}</span>
            </li>
          ))}</ul>
        ) : <p>尚无与本运行关联的机会。</p>}
        {navigation.retests.length ? (
          <ul className="space-y-1">{navigation.retests.map((link) => (
            <li className="break-words" key={`${link.baseline_id}:${link.retest_batch_id ?? 'baseline'}`}>
              <a className="text-interaction-primary underline" href={`/geo/opportunities?opportunity_id=${link.opportunity_id}${link.retest_batch_id ? `&retest_batch_id=${link.retest_batch_id}` : ''}`}>
                {link.retest_batch_id ? `查看关联复测 ${link.retest_batch_id}` : `查看复测基线 ${link.baseline_id}`}
              </a>
            </li>
          ))}</ul>
        ) : <p>尚无与本运行批次关联的复测基线或复测。</p>}
      </nav>
    </section>
  );
}

function QualityFact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-text-muted">{label}</dt><dd>{value}</dd></div>;
}
