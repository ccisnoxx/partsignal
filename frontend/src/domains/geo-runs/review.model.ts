import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';

type Detail = components['schemas']['GeoRunDetail'];
type Analysis = components['schemas']['GeoAnalysisResult'];
type Correction = Extract<components['schemas']['GeoReviewCorrectionPayload'], { schema_version: 1 }>;
type ReviewRequest = components['schemas']['GeoRunReviewRequest'];
const decisions = ['CONFIRMED', 'CORRECTED'] as const satisfies readonly components['schemas']['GeoReviewDecision'][];
const recommendations = ['RECOMMENDED', 'CONSIDERED', 'NOT_RECOMMENDED', 'UNKNOWN'] as const satisfies readonly components['schemas']['GeoRecommendationKind'][];
const verdicts = ['ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE'] as const satisfies readonly components['schemas']['GeoClaimVerdict'][];
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const satisfies readonly components['schemas']['GeoClaimSeverity'][];
const categories = ['OWNED', 'COMPETITOR', 'INDUSTRY_MEDIA', 'DISTRIBUTOR', 'COMMUNITY', 'SOCIAL', 'SEARCH_ENGINE', 'ACADEMIC_OR_INSTITUTIONAL', 'OTHER', 'UNKNOWN'] as const satisfies readonly components['schemas']['GeoSourceCategory'][];
const text = z.string().refine((value) => Array.from(value).length <= 2000, '最多 2000 字符').refine((value) => !value.includes('\0'), '不能包含空字符');
const baseSchema = z.object({
  decision: z.enum(['', ...decisions]), comment: text,
  checked: z.array(z.boolean()),
  mentions: z.array(z.object({ enabled: z.boolean(), subject_id: z.string(), count: z.string(), offset: z.string(), aliases: z.string() })),
  recommendations: z.array(z.object({ enabled: z.boolean(), subject_id: z.string(), recommendation: z.enum(recommendations), rank: z.string(), excerpt: text })),
  claims: z.array(z.object({ enabled: z.boolean(), claim_assessment_id: z.string(), verdict: z.enum(verdicts), severity: z.enum(severities), explanation: text })),
  citations: z.array(z.object({ enabled: z.boolean(), citation_id: z.string(), source_category: z.enum(categories), subject_id: z.string() })),
});
type ReviewValues = z.infer<typeof baseSchema>;
function currentAnalysis(detail: Detail) {
  return detail.analysis.revisions.find((row) => row.analysis.id === detail.analysis.selection.current_analysis_revision_id);
}
function severeClaims(analysis: Analysis) {
  return analysis.claims.filter((row) => row.verdict === 'INCORRECT' && (row.severity === 'HIGH' || row.severity === 'CRITICAL'));
}
function currentCorrection(detail: Detail): Correction | null {
  const payload = detail.analysis.reviews.find((row) => row.review.id === detail.analysis.selection.current_review_id)?.review.correction_payload;
  return payload && 'schema_version' in payload ? payload : null;
}
function reviewValues(detail: Detail, analysis: Analysis): ReviewValues {
  // 只继承当前 review 的明确修正；effective 包含机器值，不能当累计人工修正。
  const correction = currentCorrection(detail);
  return {
    decision: '', comment: '', checked: severeClaims(analysis).map(() => false),
    mentions: analysis.analysis.input_snapshot.subjects.map((subject) => {
      const saved = correction?.mentions.find((row) => row.subject_id === subject.id);
      const row = saved ?? analysis.mentions.find((item) => item.subject_id === subject.id);
      return { enabled: Boolean(saved), subject_id: subject.id, count: row ? String(row.mention_count) : '', offset: row?.first_character_offset == null ? '' : String(row.first_character_offset), aliases: row?.matched_aliases.join('\n') ?? '' };
    }),
    recommendations: analysis.analysis.input_snapshot.subjects.map((subject) => {
      const saved = correction?.recommendations.find((row) => row.subject_id === subject.id);
      const row = saved ?? analysis.recommendations.find((item) => item.subject_id === subject.id);
      return { enabled: Boolean(saved), subject_id: subject.id, recommendation: row?.recommendation ?? 'UNKNOWN', rank: row?.rank == null ? '' : String(row.rank), excerpt: row?.rationale_excerpt ?? '' };
    }),
    claims: analysis.claims.map((claim) => {
      const saved = correction?.claims.find((row) => row.claim_assessment_id === claim.id);
      return { enabled: Boolean(saved), claim_assessment_id: claim.id, verdict: saved?.verdict ?? claim.verdict, severity: saved?.severity ?? claim.severity, explanation: saved?.explanation ?? claim.explanation };
    }),
    citations: detail.citations.map((citation) => {
      const saved = correction?.citations.find((row) => row.citation_id === citation.id);
      const row = saved ?? analysis.citations.find((item) => item.citation_id === citation.id);
      return { enabled: Boolean(saved), citation_id: citation.id, source_category: row?.source_category ?? 'UNKNOWN', subject_id: row?.subject_id ?? '' };
    }),
  };
}
function reviewFormSchema(analysis: Analysis) {
  return baseSchema.superRefine((values, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    if (!values.decision) issue(['decision'], '请显式选择复核结论');
    const serious = severeClaims(analysis);
    serious.forEach((_, index) => { if (!values.checked[index]) issue(['checked', index], `请逐条核对严重声明 ${index + 1}`); });
    if ((serious.length || values.decision === 'CORRECTED') && !values.comment.trim()) issue(['comment'], '请填写非空复核说明');
    if (values.decision !== 'CORRECTED') return;
    const selected = [...values.mentions, ...values.recommendations, ...values.claims, ...values.citations].some((row) => row.enabled);
    if (!selected) issue(['decision'], '修正结论至少需要选择一项本次修正');
    const integer = (value: string, min: number) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= 2147483647;
    values.mentions.forEach((row, index) => {
      if (!row.enabled) return;
      if (!integer(row.count, 0)) issue(['mentions', index, 'count'], '提及次数必须为非负整数');
      if (row.offset && !integer(row.offset, 0)) issue(['mentions', index, 'offset'], '字符位置必须为非负整数或空值');
      const aliases = row.aliases.split('\n').map((item) => item.trim()).filter(Boolean);
      if (Number(row.count) === 0 && (row.offset || aliases.length)) issue(['mentions', index, 'count'], '次数为 0 时需清空位置和别名');
      if (Number(row.count) > 0 && !aliases.length) issue(['mentions', index, 'aliases'], '正数提及至少需要一个匹配别名');
      if (aliases.some((item) => Array.from(item).length > 240 || item.includes('\0'))) issue(['mentions', index, 'aliases'], '每个别名最多 240 字符且不能含空字符');
    });
    values.recommendations.forEach((row, index) => {
      if (row.enabled && row.rank && !integer(row.rank, 1)) issue(['recommendations', index, 'rank'], '排名必须为正整数或空值');
    });
    values.claims.forEach((row, index) => {
      if (!row.enabled) return;
      if (!row.explanation.trim()) issue(['claims', index, 'explanation'], '请填写声明解释');
      if (analysis.claims.find((claim) => claim.id === row.claim_assessment_id)?.fact_version_id === null && row.verdict !== 'UNJUDGEABLE') issue(['claims', index, 'verdict'], '没有 FactVersion 依据时只能选择 UNJUDGEABLE');
    });
  });
}
function reviewPayload(values: ReviewValues, analysisId: string, revision: number): ReviewRequest {
  if (!values.decision) throw new Error('请显式选择复核结论');
  const correction: Correction = {
    schema_version: 1,
    mentions: values.mentions.filter((row) => row.enabled).map((row) => ({ subject_id: row.subject_id, mention_count: Number(row.count), first_character_offset: row.offset ? Number(row.offset) : null, matched_aliases: row.aliases.split('\n').map((item) => item.trim()).filter(Boolean) })),
    recommendations: values.recommendations.filter((row) => row.enabled).map((row) => ({ subject_id: row.subject_id, recommendation: row.recommendation, rank: row.rank ? Number(row.rank) : null, rationale_excerpt: row.excerpt.trim() || null })),
    claims: values.claims.filter((row) => row.enabled).map((row) => ({ claim_assessment_id: row.claim_assessment_id, verdict: row.verdict, severity: row.severity, explanation: row.explanation.trim() })),
    citations: values.citations.filter((row) => row.enabled).map((row) => ({ citation_id: row.citation_id, source_category: row.source_category, subject_id: row.subject_id || null })),
  };
  return { analysis_revision_id: analysisId, expected_run_revision: revision, decision: values.decision, correction_payload: values.decision === 'CORRECTED' ? correction : null, comment: values.comment.trim() };
}
// Python offset 按 Unicode codepoint 计数；JS 字符串索引按 UTF-16，不能直接 slice 原文。
function codepointExcerpt(answer: string, offset: number | null) {
  return offset === null ? null : Array.from(answer).slice(offset, offset + 80).join('');
}
export { categories, codepointExcerpt, currentAnalysis, currentCorrection, decisions, recommendations, reviewFormSchema, reviewPayload, reviewValues, severeClaims, severities, verdicts };
export type { Analysis, Correction, Detail, ReviewRequest, ReviewValues };
