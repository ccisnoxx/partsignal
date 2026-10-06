import { describe, expect, it } from 'vitest';
import { baseParams, formatPoints, formatRate, normalizeBase } from './insights.model';
import { insightSearchSchema, isCanonicalInsightSearch, metricSelector, openDrilldown } from './drilldown.model';
import { filters, id, metric, search, secondId } from './insights.test-support';

describe('回答洞察 URL 合同', () => {
  it('固定时区、列表去重排序、地区规范化，未知筛选不会传入 API', () => {
    const parsed = insightSearchSchema.parse({ ...search, date_from: '2026-08-31T17:00:00-07:00', subject_ids: [secondId, id.toUpperCase(), secondId], region_codes: ['us', 'CN'], collection_modes: ['MANUAL', 'API', 'invalid'], sample_level: 'STABLE', unified_score: 1 });
    expect(parsed.date_from).toBe('2026-09-01T00:00:00.000Z');
    expect(parsed.subject_ids).toEqual([id, secondId]); expect(parsed.region_codes).toEqual(['CN', 'US']);
    expect(baseParams(parsed)).toEqual({ ...search, subject_ids: [id, secondId], region_codes: ['CN', 'US'], collection_modes: ['API', 'MANUAL'], review_policy: 'EFFECTIVE' });
    expect(isCanonicalInsightSearch(parsed, parsed)).toBe(true);
  });
  it('回钻完整保留六种资源、采集、语言、地区、登录、意图与复核口径', () => {
    const descriptor = metric().drilldown;
    descriptor.filters = { ...filters, subject_ids: [id], product_ids: [id], query_topic_ids: [id], prompt_variant_ids: [id], engine_surface_ids: [id], collection_profile_ids: [id], login_states: ['AUTHENTICATED'], language_codes: ['zh-CN'], region_codes: ['CN'], intent_types: ['PRODUCT'], review_policy: 'REVIEWED_ONLY' };
    descriptor.period = 'PREVIOUS'; descriptor.cohort = 'EXCLUDED';
    const parsed = openDrilldown(descriptor);
    expect(baseParams(parsed)).toEqual({ ...descriptor.filters, language_codes: ['zh-cn'], date_from: search.date_from, date_to: search.date_to });
    expect(metricSelector(parsed)).toEqual({ metric_code: 'natural_visibility', cell_key: 'current', period: 'PREVIOUS', cohort: 'EXCLUDED', page: 1, page_size: 20 });
    expect(normalizeBase(parsed)).not.toHaveProperty('detail');
  });
  it('切换明细类型清除无关选择器，不发送无效组成条件', () => {
    const parsed = insightSearchSchema.parse({ ...search, detail: 'quality', quality_code: 'cost_coverage', currency: 'USD', cell_key: 'old', metric_code: 'mention_sov', version_key: 'old', exclusion_reason: 'RUN_NOT_COMPLETED', cohort: 'NUMERATOR', page: 2, page_size: 50 });
    expect(parsed).toEqual({ ...search, detail: 'quality', quality_code: 'cost_coverage', currency: 'USD', cohort: 'NUMERATOR', page: 2, page_size: 50 });
    expect(insightSearchSchema.parse({ ...search, detail: 'metric', cell_key: 'old', metric_code: 'run_success_rate' })).toEqual(search);
  });
  it('空值不可计算，业务值和百分点只格式化，不用分子分母重算', () => {
    expect(formatRate(null)).toContain('不可计算'); expect(formatRate(0.67)).toBe('67%');
    expect(formatPoints(0.02)).toBe('+2 个百分点'); expect(formatPoints(null)).toBe('不可比较');
  });
});
