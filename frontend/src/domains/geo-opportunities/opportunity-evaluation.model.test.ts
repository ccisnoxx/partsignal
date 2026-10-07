import { describe, expect, it } from 'vitest';
import { evaluationFormSchema, evaluationRequest, type EvaluationValues } from './opportunity-evaluation.model';

const id = '30000000-0000-4000-8000-000000000001';
const values: EvaluationValues = { scope: 'FILTERED', date_from: '2026-10-01T08:00:00+08:00', date_to: '2026-10-02T08:00:00+08:00', rule_set_revision: 2, subject_ids: [id], engine_surface_ids: [], collection_profile_ids: [], collection_modes: ['MANUAL'] };
describe('管理员评估表单合同', () => {
  it('UTC转换且规范去重，不加入API没有的产品过滤', () => {
    expect(evaluationRequest({ ...values, subject_ids: [id, id] })).toEqual({ ...values, subject_ids: [id], date_from: '2026-10-01T00:00:00.000Z', date_to: '2026-10-02T00:00:00.000Z' });
  });
  it.each([{ scope: 'ALL' as const }, { subject_ids: [] }, { date_to: values.date_from }, { date_to: '2026-11-02T08:00:00+08:00' }, { date_from: '2026-10-01T08:00:00' }, { rule_set_revision: 0 }])('阻止不符合显式范围/窗口/revision的请求 %j', (patch) => {
    expect(evaluationFormSchema.safeParse({ ...values, ...patch }).success).toBe(false);
  });
  it('ALL及空模式明确合法，不隐式补MANUAL', () => {
    expect(evaluationRequest({ ...values, scope: 'ALL', subject_ids: [], collection_modes: [] }).collection_modes).toEqual([]);
  });
});
