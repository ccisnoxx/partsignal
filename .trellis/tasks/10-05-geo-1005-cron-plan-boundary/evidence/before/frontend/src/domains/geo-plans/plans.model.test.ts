import { describe, expect, it } from 'vitest';
import { planCreate, planFormSchema, planSearchSchema, planSearchToParams, planValues, shouldBlockPlanNavigation } from './plans.model';
import { planOverflow, planPrimary } from './plan-actions';
import { plan, planId } from './plans.test-support';

describe('计划 URL 与 generated 配置边界', () => {
  it('规范筛选、分页和单一编辑身份；列表请求不携带工作区状态', () => {
    const search = planSearchSchema.parse({ q: '  替代  ', status: 'PAUSED', schedule_kind: 'CRON', page: '2', page_size: '50', sort: 'NAME_ASC', selected: planId.toUpperCase(), edit: '1', ignored: true });
    expect(search).toEqual({ q: '替代', status: 'PAUSED', schedule_kind: 'CRON', page: 2, page_size: 50, sort: 'NAME_ASC', selected: planId, edit: 1 });
    expect(planSearchToParams(search)).toEqual({ q: '替代', status: 'PAUSED', schedule_kind: 'CRON', page: 2, page_size: 50, sort: 'NAME_ASC' });
    expect(planSearchSchema.parse({ new: '1', selected: planId, edit: 1, page: -2, page_size: 100 })).toEqual({ new: 1 });
    expect(planSearchSchema.parse({ status: 'UNKNOWN', selected: 'bad', edit: 1 })).toEqual({});
  });
  it('同一草稿筛选不触发 dirty，关闭、其他身份和路由离开会触发', () => {
    const current = { pathname: '/geo/plans', search: { selected: planId, edit: 1 } };
    expect(shouldBlockPlanNavigation(current, { ...current, search: { ...current.search, q: '变更筛选' } })).toBe(false);
    expect(shouldBlockPlanNavigation(current, { ...current, search: { selected: planId } })).toBe(true);
    expect(shouldBlockPlanNavigation(current, { ...current, search: { new: 1 } })).toBe(true);
    expect(shouldBlockPlanNavigation(current, { pathname: '/geo/questions', search: {} })).toBe(true);
  });
  it('完整配置保留显式角色、精确十进制和 nullable；拒绝重复引用和缺少 PRIMARY', () => {
    const values = { ...planValues(plan()), budget_limit: '0.000001' };
    expect(planCreate(planFormSchema.parse(values))).toMatchObject({ subjects: plan().subjects, budget_limit: '0.000001', cron_expression: null });
    expect(planFormSchema.safeParse({ ...values, subjects: [{ ...values.subjects[0], role: 'REFERENCE' }] }).success).toBe(false);
    expect(planFormSchema.safeParse({ ...values, prompt_variant_ids: [...values.prompt_variant_ids, ...values.prompt_variant_ids] }).success).toBe(false);
    for (const budget_limit of ['1e3', '-1', '100000000', '0.0000001']) expect(planFormSchema.safeParse({ ...values, budget_limit }).success).toBe(false);
  });
  it('动作只来自服务端，归档仅提供 COPY，缺少 ACTIVATE 时主动作禁用', () => {
    const archived = plan({ status: 'ARCHIVED', workflow_stage: 'ARCHIVED', primary_task: 'VIEW_HISTORY', available_actions: ['COPY'], deletion: { blockers: ['ARCHIVED'] } });
    expect(planPrimary(archived)).toBeUndefined();
    expect(planOverflow(archived).map((item) => item.key)).toEqual(['COPY', 'VIEW_DELETION_CONDITIONS']);
    expect(planPrimary(plan({ available_actions: [] }))).toMatchObject({ key: 'ACTIVATE', enabled: false });
  });
});
