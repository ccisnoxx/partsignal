import { describe, expect, it, vi } from 'vitest';

import {
  auditActionLabel,
  auditSearchSchema,
  auditSearchToApiParams,
  canonicalAuditSearchRecord,
  fromBeijingDateTimeInput,
  isCanonicalAuditSearch,
  projectAuditActionLabel,
  projectAuditChanges,
  projectAuditFacts,
  toBeijingDateTimeInput,
} from './audit.model';

describe('系统审计 model', () => {
  it('初始化一次近三天 UTC 范围并规范化 URL/API 字段', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T08:30:45.000Z'));
    vi.resetModules();
    const model = await import('./audit.model');
    const search = model.auditSearchSchema.parse({ actorId: '00000000-0000-4000-8000-000000000001' });

    expect(search).toMatchObject({
      page: 1,
      pageSize: 20,
      createdFrom: '2026-08-13T08:30:45.000Z',
      createdTo: '2026-08-16T08:30:45.000Z',
    });
    expect(model.auditSearchToApiParams(search)).toMatchObject({
      page: 1,
      page_size: 20,
      actor_id: '00000000-0000-4000-8000-000000000001',
      created_from: search.createdFrom,
      created_to: search.createdTo,
    });
    vi.useRealTimers();
  });

  it('非法与反向时间回到 canonical 范围，未知字段被移除', () => {
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-16T00:00:00Z',
      createdTo: '2026-08-15T00:00:00Z',
      page: 0,
      pageSize: 99,
      actorId: 'bad-id',
      unknown: 'drop',
    });
    expect(search.page).toBe(1);
    expect(search.pageSize).toBe(20);
    expect(search.actorId).toBeUndefined();
    expect(new Date(search.createdFrom).getTime()).toBeLessThan(new Date(search.createdTo).getTime());
    expect(isCanonicalAuditSearch(canonicalAuditSearchRecord(search), search)).toBe(true);
  });

  it('北京时间 datetime-local 与 ISO UTC 精确互转', () => {
    expect(toBeijingDateTimeInput('2026-08-16T08:30:00.000Z')).toBe('2026-08-16T16:30');
    expect(fromBeijingDateTimeInput('2026-08-16T16:30')).toBe('2026-08-16T08:30:00.000Z');
  });

  it('安全详情投影只接受登记字段和值合同', () => {
    expect(auditActionLabel('ai_channel.updated')).toBe('更新 AI 渠道');
    expect(projectAuditActionLabel('ai_channel.updated')).toEqual({ status: 'projected', label: '更新 AI 渠道' });
    expect(projectAuditFacts({ revision: 5, configured: true, reason: ['manual', 2] })).toEqual([
      { field: 'revision', label: '修订号', value: '5' },
      { field: 'configured', label: '配置状态', value: '是' },
      { field: 'reason', label: '原因', value: 'manual、2' },
    ]);
    expect(projectAuditChanges([{ field: 'revision', before: 4, after: 5 }])).toEqual([
      { field: 'revision', label: '修订号', before: '4', after: '5' },
    ]);
    const unknownAction = 'audit.action.unknown.sentinel';
    const projection = projectAuditActionLabel(unknownAction);
    expect(projection).toEqual({ status: 'failed' });
    expect(JSON.stringify(projection)).not.toContain(unknownAction);
    expect(() => auditActionLabel(unknownAction)).toThrow('未知动作');
    expect(() => projectAuditFacts({ secret: 'hidden' })).toThrow('未登记事实字段');
  });

  it('详情身份 logId 不进入列表 API 参数', () => {
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-13T00:00:00.000Z',
      createdTo: '2026-08-16T00:00:00.000Z',
      logId: '00000000-0000-4000-8000-000000000099',
    });
    expect(auditSearchToApiParams(search)).not.toHaveProperty('log_id');
  });
});
