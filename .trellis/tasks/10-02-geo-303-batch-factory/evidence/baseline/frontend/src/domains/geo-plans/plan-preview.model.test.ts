import { describe, expect, it } from 'vitest';
import { blockerDestination, blockerLabels, planFieldStep, warningLabels, type PlanBlocker } from './plan-preview.model';

const resource = '10000000-0000-4000-8000-000000000001';
const related = '10000000-0000-4000-8000-000000000002';
describe('计划阻断定位', () => {
  it.each(Object.keys(blockerLabels) as PlanBlocker['code'][])('%s 提供中文原因和具体修正步骤', (code) => {
    const blocker: PlanBlocker = { code, field: 'collection_profile_ids.settings', resource_id: resource, related_resource_id: related };
    const location = blockerDestination(blocker);
    expect(blockerLabels[code]).toMatch(/[\u4e00-\u9fff]/);
    if (code === 'SUBJECT_NOT_FOUND' || code === 'SUBJECT_DISABLED') expect(location).toEqual({ step: 1, field: 'subjects', href: `/configuration/geo-entities?subject_id=${resource}` });
    else if (code === 'PROMPT_NOT_FOUND' || code === 'PROMPT_DISABLED') expect(location).toEqual({ step: 2, field: 'prompt_variant_ids', href: `/geo/questions?selected=${resource}` });
    else if (code === 'BUDGET_EXCEEDED' || code === 'BUDGET_CURRENCY_MISMATCH') expect(location).toEqual({ step: 4, field: 'budget_limit', href: null });
    else expect(location).toEqual({ step: 3, field: 'collection_profile_ids', href: `/configuration/geo-surfaces?tab=profiles&profile_id=${resource}` });
    expect(blocker.resource_id).toBe(resource);
    expect(blocker.related_resource_id).toBe(related);
  });
  it('没有资源 ID 时仍能回到选项与已有资源入口', () => {
    expect(blockerDestination({ code: 'PROFILE_NOT_FOUND', field: 'collection_profile_ids', resource_id: null, related_resource_id: null })).toEqual({ step: 3, field: 'collection_profile_ids', href: '/configuration/geo-surfaces?tab=profiles' });
  });
  it.each([['name', 0], ['subjects.0.role', 1], ['prompt_variant_ids.0', 2], ['collection_profile_ids.settings', 3], ['repeat_count', 4], ['budget_limit', 4], ['rule_set_revision', 4], ['cron_expression', 5], ['timezone', 5], ['schedule_kind', 5]] as const)('字段 %s 定位到步骤 %s', (field, step) => {
    expect(planFieldStep(field)).toBe(step);
  });
  it('所有服务端警告均有明确中文解释', () => {
    expect(Object.keys(warningLabels)).toHaveLength(8);
    expect(warningLabels.BUDGET_UNVERIFIED).toContain('不能保证');
    expect(warningLabels.COST_CURRENCY_MISMATCH).toContain('不进行换汇');
  });
});
