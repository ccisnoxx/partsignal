import type { ReactNode } from 'react';
import type { components } from '@/shared/api/generated/schema';
import { TableShell } from '@/design-system/data-table/table-shell';
import { codepointExcerpt, currentAnalysis, type Analysis, type Correction, type Detail } from './review.model';
import { timestamp } from './runs.model';

type Results = Pick<components['schemas']['GeoReviewedResults'], 'mentions' | 'recommendations' | 'claims' | 'citations' | 'citation_classification_complete'>;
function RunAnalysis({ detail, reviewControl }: { detail: Detail; reviewControl?: ReactNode }) {
  const selected = currentAnalysis(detail);
  const { analysis } = detail;
  return <section aria-label="分析与人工复核" className="min-w-0 space-y-5 border-t border-border-subtle pt-4">
    <h3 className="type-section-title">分析与人工复核</h3>
    <p className="text-sm">需要复核：{analysis.review_required ? '是' : '否'} · 复核门禁：{analysis.review_gate_passed ? '已通过' : '未通过'}。状态以服务端投影为准。</p>
    {selected ? <>
      <section aria-label="当前机器分析" className="min-w-0 space-y-3">
        <h4 className="font-medium">当前机器分析 · Revision {selected.analysis.revision}（只读）</h4>
        <AnalysisIdentity value={selected} />
        <AnalysisResults detail={detail} label="机器" results={selected} subjects={selected.analysis.input_snapshot.subjects} />
      </section>
      {analysis.effective_results ? <section aria-label="当前有效结果" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
        <h4 className="font-medium">当前有效结果（服务端投影）</h4>
        <p className="break-all text-sm">当前复核 ID：{analysis.selection.current_review_id ?? '无；使用机器结果'}。人工结论不会改写上方机器结果。</p>
        <AnalysisResults detail={detail} label="有效" results={analysis.effective_results} subjects={selected.analysis.input_snapshot.subjects} />
      </section> : <p className="text-sm">服务端尚无有效结果。</p>}
    </> : <p className="text-sm text-text-secondary">{analysis.selection.current_analysis_revision_id ? '服务端当前分析引用不可读取，请重新读取详情。' : '尚无当前成功分析；分析待处理或失败时请查看运行状态及下方历史。'}</p>}
    {reviewControl}
    <section aria-label="分析与复核历史，只读" className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
      <h4 className="font-medium">分析与复核历史（只读）</h4>
      {!analysis.revisions.length && <p className="text-sm">尚无分析 revision。</p>}
      {analysis.revisions.map((revision) => <details key={revision.analysis.id} className="min-w-0 space-y-3">
        <summary className="cursor-pointer break-words text-sm">分析 Revision {revision.analysis.revision} · {revision.analysis.status} · {revision.analysis.id === analysis.selection.current_analysis_revision_id ? '当前' : '历史'} · {timestamp(revision.analysis.created_at)}</summary>
        <AnalysisIdentity value={revision} />
        <AnalysisResults detail={detail} label={`历史 ${revision.analysis.revision}`} results={revision} subjects={revision.analysis.input_snapshot.subjects} />
      </details>)}
      {!analysis.reviews.length && <p className="text-sm">尚无人工复核记录。</p>}
      {analysis.reviews.map(({ review }) => <details className="min-w-0 space-y-3" key={review.id}>
        <summary className="cursor-pointer break-words text-sm">复核 {review.decision} · {review.id === analysis.selection.current_review_id ? '当前' : '历史'} · {timestamp(review.created_at)}</summary>
        <dl className="space-y-2 break-words text-sm [overflow-wrap:anywhere]">
          <div><dt>复核 ID / 分析 ID</dt><dd>{review.id} / {review.analysis_revision_id}</dd></div>
          <div><dt>复核人 ID</dt><dd>{review.reviewer_id}</dd></div>
          <div><dt>人工复核说明</dt><dd className="whitespace-pre-wrap">{review.comment || '未填写（服务端允许）'}</dd></div>
        </dl>
        {review.correction_payload && 'schema_version' in review.correction_payload && <CorrectionHistory correction={review.correction_payload} />}
        {!review.correction_payload && <p className="text-sm">确认机器结论；没有修正载荷。</p>}
      </details>)}
    </section>
  </section>;
}
function AnalysisIdentity({ value }: { value: Analysis }) {
  const row = value.analysis;
  return <dl className="grid gap-2 text-sm sm:grid-cols-2">
    <div className="min-w-0"><dt>分析 ID / 输入 SHA-256</dt><dd className="break-all">{row.id} / {row.input_sha256}</dd></div>
    <div><dt>分析器 / 版本</dt><dd>{row.analyzer_type} / {row.analyzer_version}</dd></div>
    <div><dt>分析状态 / 完成时间</dt><dd>{row.status} / {timestamp(row.finished_at)}</dd></div>
    <div className="min-w-0"><dt>复核原因</dt><dd className="break-words">{row.review_required_reasons.length ? row.review_required_reasons.join('、') : '无'}</dd></div>
    {row.error_code && <div className="sm:col-span-2" role="alert"><dt>分析失败</dt><dd>{row.error_code} · {row.error_summary}</dd></div>}
  </dl>;
}
function AnalysisResults({ detail, label, results, subjects }: { detail: Detail; label: string; results: Results; subjects: Analysis['analysis']['input_snapshot']['subjects'] }) {
  const subjectName = (id: string | null) => id === null ? '未关联对象' : `${subjects.find((row) => row.id === id)?.display_name ?? id} (${id})`;
  return <div className="min-w-0 space-y-4">
    <section className="min-w-0 space-y-2"><h5 className="text-sm font-medium">提及</h5>
      {results.mentions.length ? <TableShell regionLabel={`${label}提及结果`}><thead><tr><th>监测对象</th><th>次数 / 首次位置</th><th>匹配别名与原文定位</th></tr></thead><tbody>
        {results.mentions.map((row) => <tr key={row.subject_id}><td className="max-w-64 break-words [overflow-wrap:anywhere]">{subjectName(row.subject_id)}</td><td>{row.mention_count} / {row.first_character_offset ?? '未记录'}</td><td className="max-w-lg whitespace-pre-wrap break-words"><p>{row.matched_aliases.join('、') || '无匹配别名'}</p>{detail.answer && row.first_character_offset !== null && <p>原文定位：{codepointExcerpt(detail.answer.answer_text, row.first_character_offset)}</p>}</td></tr>)}
      </tbody></TableShell> : <p className="text-sm">无提及结果。</p>}
      <p className="text-xs text-text-muted">首次位置为 Python Unicode codepoint，从 0 开始；原文定位按 codepoint 读取。</p>
    </section>
    <section className="min-w-0 space-y-2"><h5 className="text-sm font-medium">推荐</h5>
      {results.recommendations.length ? <TableShell regionLabel={`${label}推荐结果`}><thead><tr><th>监测对象</th><th>推荐 / 排名</th><th>理由摘录</th></tr></thead><tbody>
        {results.recommendations.map((row) => <tr key={row.subject_id}><td className="max-w-64 break-words [overflow-wrap:anywhere]">{subjectName(row.subject_id)}</td><td>{row.recommendation} / {row.rank ?? '无排名'}</td><td className="max-w-lg whitespace-pre-wrap break-words">{row.rationale_excerpt ?? '无摘录'}</td></tr>)}
      </tbody></TableShell> : <p className="text-sm">无推荐结果。</p>}
    </section>
    <section className="min-w-0 space-y-2"><h5 className="text-sm font-medium">声明与事实依据</h5>
      {results.claims.length ? <TableShell regionLabel={`${label}声明结果`}><thead><tr><th>对象 / 声明原文</th><th>FactVersion / 事实摘录</th><th>判定 / 严重度 / 解释</th></tr></thead><tbody>
        {results.claims.map((row) => <tr key={row.id}>
          <td className="max-w-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><p>{subjectName(row.subject_id)}</p><p>{row.claim_kind} · {row.claim_text}</p><p className="text-xs text-text-muted">声明 ID：{row.id}</p></td>
          <td className="max-w-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><p>{row.fact_version_id ?? '无 FactVersion；只能 UNJUDGEABLE'}</p><p>{row.fact_excerpt ?? '无事实摘录'}</p></td>
          <td className="max-w-lg whitespace-pre-wrap break-words"><p>{row.verdict} · {row.severity}</p><p>{row.explanation}</p></td>
        </tr>)}
      </tbody></TableShell> : <p className="text-sm">无声明结果。</p>}
    </section>
    <section className="min-w-0 space-y-2"><h5 className="text-sm font-medium">引用分类</h5>
      <p className="text-sm">分类完整性：{results.citation_classification_complete ? '完整' : '不完整'}。来源分类与内容关联对象是独立字段。</p>
      {results.citations.length ? <TableShell regionLabel={`${label}引用分类`}><thead><tr><th>原始引用</th><th>来源分类</th><th>内容关联对象</th></tr></thead><tbody>
        {results.citations.map((row) => <tr key={row.citation_id}><td className="max-w-lg break-all">{detail.citations.find((citation) => citation.id === row.citation_id)?.original_url ?? row.citation_id}</td><td>{row.source_category}</td><td className="max-w-64 break-words [overflow-wrap:anywhere]">{subjectName(row.subject_id)}</td></tr>)}
      </tbody></TableShell> : <p className="text-sm">无引用分类结果。</p>}
    </section>
  </div>;
}
function CorrectionHistory({ correction }: { correction: Correction }) {
  return <div className="space-y-2 text-sm [overflow-wrap:anywhere]">
    <p>本次完整修正载荷；不累计合并上一条复核。</p>
    <ul className="space-y-2">
      {correction.mentions.map((row) => <li key={`mention:${row.subject_id}`}>提及 {row.subject_id}：{row.mention_count} 次，位置 {row.first_character_offset ?? '空'}，别名 {row.matched_aliases.join('、') || '空'}</li>)}
      {correction.recommendations.map((row) => <li key={`recommendation:${row.subject_id}`}>推荐 {row.subject_id}：{row.recommendation}，排名 {row.rank ?? '空'}，摘录 {row.rationale_excerpt ?? '空'}</li>)}
      {correction.claims.map((row) => <li key={`claim:${row.claim_assessment_id}`}>声明 {row.claim_assessment_id}：{row.verdict} · {row.severity} · {row.explanation}</li>)}
      {correction.citations.map((row) => <li key={`citation:${row.citation_id}`}>引用 {row.citation_id}：{row.source_category}，关联对象 {row.subject_id ?? '空'}</li>)}
    </ul>
  </div>;
}
export { CorrectionHistory, RunAnalysis };
