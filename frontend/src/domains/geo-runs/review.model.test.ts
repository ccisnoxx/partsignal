import { describe, expect, it } from 'vitest';
import { analyzedDetail, analysisId, claimId, factId, reviewId, reviewReceipt } from './analysis.test-support';
import { batchId, runId } from './runs.test-support';
import { codepointExcerpt, currentAnalysis, reviewFormSchema, reviewPayload, reviewValues } from './review.model';

describe('复核输入与 API 边界', () => {
  it('四栏结构化修正生成完整替换载荷，未选择行不冒充累计人工修正', () => {
    const detail = analyzedDetail();
    const analysis = currentAnalysis(detail)!;
    const values = reviewValues(detail, analysis);
    values.decision = 'CORRECTED'; values.comment = '本次明确修正'; values.checked = [true];
    values.mentions[0] = { enabled: true, subject_id: runId, count: '0', offset: '', aliases: '' };
    values.recommendations[0] = { enabled: true, subject_id: runId, recommendation: 'CONSIDERED', rank: '2', excerpt: '可考虑使用' };
    values.claims[0] = { enabled: true, claim_assessment_id: claimId, verdict: 'PARTIAL', severity: 'MEDIUM', explanation: '参数需要纠正' };
    values.citations[0] = { enabled: true, citation_id: batchId, source_category: 'INDUSTRY_MEDIA', subject_id: '' };
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(true);
    expect(reviewPayload(values, analysisId, 7)).toEqual({
      analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CORRECTED', comment: '本次明确修正',
      correction_payload: { schema_version: 1,
        mentions: [{ subject_id: runId, mention_count: 0, first_character_offset: null, matched_aliases: [] }],
        recommendations: [{ subject_id: runId, recommendation: 'CONSIDERED', rank: 2, rationale_excerpt: '可考虑使用' }],
        claims: [{ claim_assessment_id: claimId, verdict: 'PARTIAL', severity: 'MEDIUM', explanation: '参数需要纠正' }],
        citations: [{ citation_id: batchId, source_category: 'INDUSTRY_MEDIA', subject_id: null }],
      },
    });
  });
  it('只继承 current review 明确字段；取消旧修正后不会从 effective 补回', () => {
    const detail = analyzedDetail();
    const review = reviewReceipt().review;
    review.decision = 'CORRECTED';
    review.correction_payload = { schema_version: 1, mentions: [], recommendations: [], claims: [{ claim_assessment_id: claimId, verdict: 'INCORRECT', severity: 'HIGH', explanation: '上次完整说明' }], citations: [] };
    detail.analysis.reviews = [{ review, is_current: true }]; detail.analysis.selection.current_review_id = reviewId;
    const values = reviewValues(detail, currentAnalysis(detail)!);
    expect(values.claims[0]).toMatchObject({ enabled: true, explanation: '上次完整说明' });
    expect(values.mentions[0]?.enabled).toBe(false);
    values.decision = 'CORRECTED'; values.comment = '本次只改引用'; values.checked = [true]; values.claims[0]!.enabled = false; values.citations[0]!.enabled = true;
    expect(reviewPayload(values, analysisId, 8).correction_payload).toMatchObject({ claims: [], citations: [{ citation_id: batchId }] });
  });
  it('严重门禁需要每条显式核对和说明；普通 CONFIRMED 保留 null/空说明许可', () => {
    const detail = analyzedDetail(); const analysis = currentAnalysis(detail)!;
    analysis.claims.push({ ...analysis.claims[0]!, id: factId, severity: 'CRITICAL' });
    const values = reviewValues(detail, analysis); values.decision = 'CONFIRMED';
    expect(values.checked).toEqual([false, false]);
    values.checked = [true, false]; values.comment = '已核对';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(false);
    values.checked = [true, true]; values.comment = '  ';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(false);
    values.comment = '电压差异已确认';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(true);
    expect(reviewPayload(values, analysisId, 7).correction_payload).toBeNull();
    analysis.claims = []; const ordinary = reviewValues(detail, analysis); ordinary.decision = 'CONFIRMED';
    expect(reviewFormSchema(analysis).safeParse(ordinary).success).toBe(true);
    expect(reviewPayload(ordinary, analysisId, 7)).toMatchObject({ comment: '', correction_payload: null });
  });
  it('正数别名、零清空和无 FactVersion 判定都在表单边界保护', () => {
    const detail = analyzedDetail(); const analysis = currentAnalysis(detail)!;
    analysis.claims[0]!.fact_version_id = null; analysis.claims[0]!.verdict = 'UNJUDGEABLE'; analysis.claims[0]!.fact_excerpt = null;
    const values = reviewValues(detail, analysis); values.decision = 'CORRECTED'; values.comment = '仅无事实判定'; values.claims[0]!.enabled = true;
    values.claims[0]!.verdict = 'ACCURATE';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(false);
    values.claims[0]!.verdict = 'UNJUDGEABLE'; values.mentions[0]!.enabled = true; values.mentions[0]!.aliases = '';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(false);
    values.mentions[0]!.aliases = '型号A'; values.mentions[0]!.count = '0';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(false);
    values.mentions[0]!.aliases = ''; values.mentions[0]!.offset = '';
    expect(reviewFormSchema(analysis).safeParse(values).success).toBe(true);
  });
  it('选择来自 explicit selection，Unicode offset 不以 UTF-16 切割', () => {
    const detail = analyzedDetail(); const row = detail.analysis.revisions[0]!;
    detail.analysis.revisions.unshift({ ...row, analysis: { ...row.analysis, id: factId, revision: 9 } });
    expect(currentAnalysis(detail)?.analysis.id).toBe(analysisId);
    expect(codepointExcerpt('😀前文 型号A', 4)).toBe('型号A');
    detail.analysis.selection.current_analysis_revision_id = null;
    expect(currentAnalysis(detail)).toBeUndefined();
  });
});
