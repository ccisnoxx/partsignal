import { describe, expect, it } from 'vitest';
import { OpportunityRequestError } from './opportunities.api';
import { baselineBatchChoices, businessFailureKind, businessRequest, opportunityContentFormSchema, opportunityRetestFormSchema } from './opportunity-business.model';
import { detail, opportunityId, retestId } from './opportunities.test-support';

describe('机会业务输入与恢复合同', () => {
  it('UUID 输入规范化，空或非法选择不会成为创建载荷', () => {
    expect(opportunityContentFormSchema.parse({ product_id: opportunityId.toUpperCase(), fact_version_id: retestId, platform_profile_id: opportunityId })).toEqual({ product_id: opportunityId, fact_version_id: retestId, platform_profile_id: opportunityId });
    expect(opportunityContentFormSchema.safeParse({ product_id: '', fact_version_id: retestId, platform_profile_id: opportunityId }).success).toBe(false);
    expect(opportunityRetestFormSchema.safeParse({ baseline_batch_id: '基线不明' }).success).toBe(false);
  });
  it('原请求同载荷继承 key，明确改变 revision 或基线创建新的 key', () => {
    const body = { expected_revision: 3, baseline_batch_id: opportunityId };
    const original = businessRequest(body);
    expect(businessRequest({ ...body }, original)).toBe(original);
    expect(businessRequest({ ...body, expected_revision: 4 }, original).key).not.toBe(original.key);
    expect(businessRequest({ ...body, baseline_batch_id: retestId }, original).key).not.toBe(original.key);
  });
  it('网络、5xx 与异常回执保持未知；拒绝和 revision 冲突明确分开', () => {
    expect(businessFailureKind(new TypeError('network'))).toBe('unknown');
    expect(businessFailureKind(new OpportunityRequestError('invalid receipt'))).toBe('unknown');
    expect(businessFailureKind(new OpportunityRequestError('unavailable', 503))).toBe('unknown');
    expect(businessFailureKind(new OpportunityRequestError('conflict', 409))).toBe('conflict');
    expect(businessFailureKind(new OpportunityRequestError('invalid', 422))).toBe('rejected');
    expect(businessFailureKind(new OpportunityRequestError('private', 403))).toBe('denied');
  });
  it('基线候选只投影当前来源页的真实 batch_id，不按运行状态推导资格', () => {
    const value = detail(); const source = value.sources.items[0]!;
    value.sources.items.push({ ...source, id: retestId, run: { ...source.run, status: 'FAILED' } });
    expect(baselineBatchChoices(value)).toEqual([{ value: source.run.batch_id, label: `基线批次 ${source.run.batch_id} · 当前来源页 2 条证据` }]);
  });
});
