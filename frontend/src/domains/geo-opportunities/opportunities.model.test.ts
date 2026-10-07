import { describe, expect, it } from 'vitest';
import { decisionFormSchema, dismissFormSchema, fromUtcInput, isCanonicalOpportunitySearch, opportunitySearchSchema, opportunitySearchToParams, sourceSearchToParams, toUtcInput } from './opportunities.model';
import { opportunityId, retestId } from './opportunities.test-support';

describe('GEO 机会 URL 与原因合同', () => {
  it('URL 与 API 使用同名过滤，详情与来源分页不会污染列表请求', () => {
    const search = opportunitySearchSchema.parse({ q: '  电压  ', status: 'ACKNOWLEDGED', priority: 'CRITICAL', rule_code: 'CRITICAL_FACT_ERROR', subject_id: opportunityId, product_id: opportunityId, query_topic_id: opportunityId, prompt_variant_id: opportunityId, collection_profile_id: opportunityId, engine_surface_id: opportunityId, collection_mode: 'MANUAL', created_from: '2026-10-03T16:00:00+08:00', created_to: '2026-10-04T16:00:00+08:00', sort: 'LAST_SEEN_DESC', page: '2', page_size: '10', opportunity_id: opportunityId.toUpperCase(), source_page: '3', source_page_size: '50', resolution_comment: '草稿不能进入 URL' });
    expect(search).toMatchObject({ q: '电压', created_from: '2026-10-03T08:00:00.000Z', created_to: '2026-10-04T08:00:00.000Z', opportunity_id: opportunityId, page: 2, source_page: 3 });
    expect(search).not.toHaveProperty('resolution_comment');
    expect(opportunitySearchToParams(search)).toMatchObject({ q: '电压', status: 'ACKNOWLEDGED', subject_id: opportunityId, page: 2, page_size: 10, sort: 'LAST_SEEN_DESC' });
    expect(opportunitySearchToParams(search)).not.toHaveProperty('opportunity_id'); expect(opportunitySearchToParams(search)).not.toHaveProperty('source_page');
    expect(sourceSearchToParams(search)).toEqual({ source_page: 3, source_page_size: 50 });
    expect(isCanonicalOpportunitySearch(search, search)).toBe(true);
  });
  it('默认过滤与无选中项来源分页规范化，拒绝无效时间和身份', () => {
    expect(opportunitySearchSchema.parse({ page: 1, page_size: 20, source_page: 2, sort: 'PRIORITY_DESC', q: ' ', subject_id: 'invalid', created_from: '2026-10-05T00:00:00Z', created_to: '2026-10-04T00:00:00Z' })).toEqual({});
    expect(opportunitySearchToParams({})).toMatchObject({ page: 1, page_size: 20, sort: 'PRIORITY_DESC' });
    expect(isCanonicalOpportunitySearch({ page: 1 }, {})).toBe(false);
    expect(toUtcInput('2026-10-03T16:00:41.125+08:00')).toBe('2026-10-03T08:00:41.125');
    expect(fromUtcInput(toUtcInput('2026-10-03T16:00:41.125+08:00'))).toBe('2026-10-03T08:00:41.125Z');
    expect(fromUtcInput('2026-10-03T08:00')).toBe('2026-10-03T08:00:00.000Z');
  });
  it('忽略原因 trim 后非空，按 Unicode 字符长度与 NUL 限制校验', () => {
    expect(dismissFormSchema.parse({ resolution_code: '  NOT_ACTIONABLE ', resolution_comment: ' 已核对  ' })).toEqual({ resolution_code: 'NOT_ACTIONABLE', resolution_comment: '已核对' });
    expect(dismissFormSchema.safeParse({ resolution_code: ' ', resolution_comment: '原因' }).success).toBe(false);
    expect(dismissFormSchema.safeParse({ resolution_code: 'CODE', resolution_comment: '\0' }).success).toBe(false);
    expect(dismissFormSchema.safeParse({ resolution_code: '😀'.repeat(40), resolution_comment: '原因' }).success).toBe(true);
    expect(dismissFormSchema.safeParse({ resolution_code: '😀'.repeat(41), resolution_comment: '原因' }).success).toBe(false);
  });
  it('复测选择只在选中机会时保留，使用 URL 身份而不进入列表和来源参数', () => {
    expect(opportunitySearchSchema.parse({ retest_batch_id: retestId })).toEqual({});
    const search = opportunitySearchSchema.parse({ opportunity_id: opportunityId, retest_batch_id: retestId.toUpperCase() });
    expect(search).toEqual({ opportunity_id: opportunityId, retest_batch_id: retestId });
    expect(opportunitySearchToParams(search)).not.toHaveProperty('retest_batch_id');
    expect(sourceSearchToParams(search)).not.toHaveProperty('retest_batch_id');
    expect(decisionFormSchema.safeParse({ resolution_code: ' ', resolution_comment: '处理依据' }).success).toBe(false);
    expect(decisionFormSchema.parse({ resolution_code: ' MANUAL ', resolution_comment: ' 已核对 ' })).toEqual({ resolution_code: 'MANUAL', resolution_comment: '已核对' });
  });
});
