import { describe, expect, it, vi } from 'vitest';

import {
  auditActionLabel,
  auditSearchSchema,
  auditSearchToApiParams,
  auditResetSearch,
  canonicalAuditSearchRecord,
  formatAuditValue,
  fromBeijingDateTimeInput,
  isCanonicalAuditSearch,
  parseAuditLogDetailResponse,
  parseAuditLogListResponse,
  projectAuditActionLabel,
  projectAuditChanges,
  projectAuditFacts,
  resolveAuditRelatedLink,
  toBeijingDateTimeInput,
} from './audit.model';

const runtimeLog = {
  id: '20000000-0000-4000-8000-000000000001',
  actor_id: '10000000-0000-4000-8000-000000000001',
  actor: {
    id: '10000000-0000-4000-8000-000000000001',
    display_name: '系统管理员',
    account_type: 'ADMIN',
  },
  business_module: 'CONFIGURATION',
  action: 'ai_channel.updated',
  target_type: 'AIChannel',
  target_id: '30000000-0000-4000-8000-000000000001',
  outcome: 'SUCCESS',
  primary_task: 'VIEW_LOG_DETAIL',
  request_id: 'req-audit-runtime',
  created_at: '2026-08-15T08:00:00Z',
} as const;

function runtimeDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...runtimeLog,
    changes: [{ field: 'revision', before: 4, after: 5 }],
    facts: { revision: 5 },
    result_message: '渠道配置已更新',
    error_code: null,
    related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null },
    ...overrides,
  };
}

function expectRuntimeProjectionFailure(value: unknown, requestedLogId: string = runtimeLog.id) {
  try {
    parseAuditLogDetailResponse(value, requestedLogId);
    throw new Error('未抛出预期错误');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('审计响应安全投影失败');
    expect(String(error)).not.toContain('audit-runtime-secret-sentinel');
  }
}

describe('系统审计 model', () => {
  it('管理员机会评估安全回执可展示，未知对象不生成导航', () => {
    const evaluated = parseAuditLogDetailResponse(runtimeDetail({
      business_module: 'GEO_OBSERVATION', action: 'geo_opportunity.evaluated',
      target_type: 'GeoOpportunityEvaluationRun', changes: [],
      related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null },
      facts: { scope: 'FILTERED', evaluated_cells: 10, created: 1, existing_reused: 0,
        skipped: 9, unavailable_reasons: ['INSUFFICIENT_SAMPLE'], revision: 1,
        as_of: '2026-10-05T08:00:00Z', filter_sha256: 'a'.repeat(64) },
    }), runtimeLog.id);
    expect(auditActionLabel(evaluated.action)).toBe('管理员评估 GEO 机会');
    expect(projectAuditFacts(evaluated.facts).map((item) => item.label)).toContain('评估结果数');
    expect(resolveAuditRelatedLink(evaluated)).toBeUndefined();
    expectRuntimeProjectionFailure(runtimeDetail({
      business_module: 'GEO_OBSERVATION', action: 'geo_opportunity.evaluated',
      facts: { answer_text: 'audit-runtime-secret-sentinel' },
    }));
  });

  it('机会创建与严格复测审计使用登记动作、闭合安全事实和机会导航', () => {
    const common = {
      business_module: 'GEO_OBSERVATION', target_type: 'GeoOpportunity', changes: [],
      related_entry: { status: 'AVAILABLE', kind: 'GeoOpportunity', parent_id: null },
    };
    const opened = parseAuditLogDetailResponse(runtimeDetail({ ...common,
      action: 'geo_opportunity.opened', facts: { revision: 1, status: 'OPEN' },
    }), runtimeLog.id);
    expect(auditActionLabel(opened.action)).toBe('创建 GEO 机会');
    const retest = parseAuditLogDetailResponse(runtimeDetail({ ...common,
      action: 'geo.retest.created', facts: { baseline_id: runtimeLog.id,
        baseline_batch_id: runtimeLog.id, batch_id: runtimeLog.id,
        requested_run_count: 5, revision: 4 },
    }), runtimeLog.id);
    expect(auditActionLabel(retest.action)).toBe('创建 GEO 严格复测');
    expect(projectAuditFacts(retest.facts).map((item) => item.label)).toEqual([
      '冻结基线 ID', '基线批次 ID', '复测批次 ID', '请求运行数', '修订号',
    ]);
    expect(resolveAuditRelatedLink(retest)).toMatchObject({
      href: `/geo/opportunities?opportunity_id=${runtimeLog.target_id}`,
    });
    expectRuntimeProjectionFailure(runtimeDetail({ ...common, action: 'geo.retest.created',
      facts: { baseline_id: runtimeLog.id, answer_text: 'audit-runtime-secret-sentinel' },
    }));
  });

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

  it('每次解析与 reset 都捕获同一 now，跨 UTC 午夜不复用模块加载时间', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T23:59:30.000Z'));
    const beforeMidnight = auditSearchSchema.parse({});
    vi.setSystemTime(new Date('2026-08-17T00:01:30.000Z'));
    const afterMidnight = auditSearchSchema.parse({});
    const reset = auditResetSearch();

    expect(beforeMidnight.createdTo).toBe('2026-08-16T23:59:30.000Z');
    expect(beforeMidnight.createdFrom).toBe('2026-08-13T23:59:30.000Z');
    expect(afterMidnight.createdTo).toBe('2026-08-17T00:01:30.000Z');
    expect(afterMidnight.createdFrom).toBe('2026-08-14T00:01:30.000Z');
    expect(reset).toMatchObject(afterMidnight);
    vi.useRealTimers();
  });

  it('无效或反向窗口使用解析时的同一默认快照', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T00:01:30.000Z'));
    const search = auditSearchSchema.parse({ createdFrom: '2026-08-18T00:00:00Z', createdTo: '2026-08-16T00:00:00Z' });
    expect(search.createdFrom).toBe('2026-08-14T00:01:30.000Z');
    expect(search.createdTo).toBe('2026-08-17T00:01:30.000Z');
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
    expect(() => projectAuditFacts({ secret: 'hidden' })).toThrow('未登记字段');
  });

  it('拒绝对象、嵌套数组与原型字段，失败信息不回显输入 token', () => {
    const sentinel = 'audit-value-secret-sentinel';
    const unsafeValues: unknown[] = [
      { secret: sentinel },
      [[sentinel]],
      [sentinel, { secret: sentinel }],
      Number.POSITIVE_INFINITY,
    ];
    for (const value of unsafeValues) {
      expect(() => formatAuditValue(value as never)).toThrow('无法安全展示的值');
      try {
        formatAuditValue(value as never);
      } catch (error) {
        expect(String(error)).not.toContain(sentinel);
      }
    }

    for (const field of ['__proto__', 'constructor', 'toString', sentinel]) {
      expect(() => projectAuditFacts({ [field]: sentinel })).toThrow('未登记字段');
      expect(() => projectAuditChanges([{ field, after: sentinel }])).toThrow('未登记字段');
      try {
        projectAuditFacts({ [field]: sentinel });
      } catch (error) {
        expect(String(error)).not.toContain(field);
        expect(String(error)).not.toContain(sentinel);
      }
    }
  });

  it('列表校验完整 metadata 与 actor，重建 exact cache shape 并保留未知 action', () => {
    const unknownAction = 'audit.action.unknown.sentinel';
    const parsed = parseAuditLogListResponse({
      items: [{
        ...runtimeLog,
        action: unknownAction,
        actor: { ...runtimeLog.actor, raw_actor: 'audit-runtime-secret-sentinel' },
        raw_json: 'audit-runtime-secret-sentinel',
      }],
      page: 1,
      page_size: 20,
      total: 1,
      raw_page: 'audit-runtime-secret-sentinel',
    }, { page: 1, page_size: 20 });

    expect(parsed).toEqual({
      items: [{ ...runtimeLog, action: unknownAction }],
      page: 1,
      page_size: 20,
      total: 1,
    });
    expect(JSON.stringify(parsed)).not.toContain('audit-runtime-secret-sentinel');
    expect(parsed.items[0]?.action).toBe(unknownAction);
    expect(() => parseAuditLogListResponse({
      items: [{ ...runtimeLog, actor: { ...runtimeLog.actor, account_type: 'OWNER' } }],
      page: 1,
      page_size: 20,
      total: 1,
    }, { page: 1, page_size: 20 })).toThrow('审计响应安全投影失败');
  });

  it('列表与详情把规范化响应身份严格绑定请求 key', () => {
    const upperLogId = runtimeLog.id.toUpperCase();
    expect(parseAuditLogDetailResponse(runtimeDetail({ id: upperLogId }), runtimeLog.id).id).toBe(runtimeLog.id);
    expectRuntimeProjectionFailure(runtimeDetail(), '20000000-0000-4000-8000-000000000099');

    const response = { items: [runtimeLog], page: 2, page_size: 10, total: 21 };
    expect(parseAuditLogListResponse(response, { page: 2, page_size: 10 })).toMatchObject({ page: 2, page_size: 10 });
    expect(() => parseAuditLogListResponse(response, { page: 1, page_size: 10 })).toThrow('审计响应安全投影失败');
    expect(() => parseAuditLogListResponse(response, { page: 2, page_size: 20 })).toThrow('审计响应安全投影失败');
    for (const [field, value] of [['page', 1.5], ['page_size', Number.MAX_SAFE_INTEGER + 1], ['total', Number.NaN]] as const) {
      expect(() => parseAuditLogListResponse({ ...response, [field]: value }, { page: 2, page_size: 10 }))
        .toThrow('审计响应安全投影失败');
    }
  });

  it('list/detail 都拒绝 actor 身份不一致与单边缺失，并规范化 UUID 大小写', () => {
    const actorCases = [
      {
        ...runtimeLog,
        actor: { ...runtimeLog.actor, id: '10000000-0000-4000-8000-000000000099' },
      },
      { ...runtimeLog, actor_id: null },
      { ...runtimeLog, actor: null },
    ];
    for (const item of actorCases) {
      expect(() => parseAuditLogListResponse(
        { items: [item], page: 1, page_size: 20, total: 1 },
        { page: 1, page_size: 20 },
      )).toThrow('审计响应安全投影失败');
      expectRuntimeProjectionFailure(runtimeDetail({ actor_id: item.actor_id, actor: item.actor }));
    }

    const normalized = parseAuditLogDetailResponse(runtimeDetail({
      actor_id: runtimeLog.actor_id.toUpperCase(),
      actor: { ...runtimeLog.actor, id: runtimeLog.actor.id.toUpperCase() },
    }), runtimeLog.id.toUpperCase());
    expect(normalized.actor_id).toBe(runtimeLog.actor_id);
    expect(normalized.actor?.id).toBe(runtimeLog.actor.id);
  });

  it('详情 top-level、actor、related_entry 与 change 均严格拒绝 extras', () => {
    expectRuntimeProjectionFailure({ ...runtimeDetail(), raw_json: 'audit-runtime-secret-sentinel' });
    expectRuntimeProjectionFailure(runtimeDetail({
      actor: { ...runtimeLog.actor, raw_actor: 'audit-runtime-secret-sentinel' },
    }));
    expectRuntimeProjectionFailure(runtimeDetail({
      related_entry: {
        status: 'AVAILABLE', kind: 'AIChannel', parent_id: null, raw_related: 'audit-runtime-secret-sentinel',
      },
    }));
    expectRuntimeProjectionFailure(runtimeDetail({
      changes: [{
        field: 'revision', before: 4, after: 5, raw_change: 'audit-runtime-secret-sentinel',
      }],
    }));
    expectRuntimeProjectionFailure(runtimeDetail({ changes: [{ field: 'revision' }] }));
  });

  it('详情 facts/change 按 business_module 专属白名单拒绝跨模块已知字段', () => {
    expectRuntimeProjectionFailure(runtimeDetail({ facts: { account_type: 'ADMIN' } }));
    expectRuntimeProjectionFailure(runtimeDetail({ changes: [{ field: 'display_name', after: '新名称' }] }));

    expect(parseAuditLogDetailResponse(runtimeDetail({
      business_module: 'IDENTITY',
      changes: [{ field: 'display_name', after: '新名称' }],
      facts: { account_type: 'ADMIN' },
    }), runtimeLog.id)).toMatchObject({
      business_module: 'IDENTITY',
      changes: [{ field: 'display_name', after: '新名称' }],
      facts: { account_type: 'ADMIN' },
    });
  });

  it('详情 safe value 拒绝对象、嵌套数组、非有限数与原型字段', () => {
    for (const unsafeValue of [
      { secret: 'audit-runtime-secret-sentinel' },
      [['audit-runtime-secret-sentinel']],
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expectRuntimeProjectionFailure(runtimeDetail({ facts: { reason: unsafeValue } }));
    }

    const prototypeFact = JSON.parse('{"__proto__":"audit-runtime-secret-sentinel"}') as Record<string, unknown>;
    expectRuntimeProjectionFailure(runtimeDetail({ facts: prototypeFact }));
    expectRuntimeProjectionFailure(runtimeDetail({
      changes: [{ field: '__proto__', after: 'audit-runtime-secret-sentinel' }],
    }));
    expectRuntimeProjectionFailure(runtimeDetail({ result_message: { secret: 'audit-runtime-secret-sentinel' } }));
    expectRuntimeProjectionFailure(runtimeDetail({ request_id: { secret: 'audit-runtime-secret-sentinel' } }));

    const customPrototypeArray = ['audit-runtime-secret-sentinel'];
    Object.setPrototypeOf(customPrototypeArray, { custom: true });
    expectRuntimeProjectionFailure(runtimeDetail({ facts: { reason: customPrototypeArray } }));
  });

  it('问题变体审计按登记类型跳转详情，已删除资源不显示入口', () => {
    const detail = parseAuditLogDetailResponse(runtimeDetail({
      action: 'geo_prompt_variant.created', target_type: 'GeoPromptVariant',
      related_entry: { status: 'AVAILABLE', kind: 'GeoPromptVariant', parent_id: null },
    }), runtimeLog.id);
    expect(resolveAuditRelatedLink(detail)).toEqual({
      href: `/geo/questions?selected=${runtimeLog.target_id}`, label: '查看问题变体',
    });
    expect(auditActionLabel(detail.action)).toBe('创建 GEO 问题变体');
    const missing = parseAuditLogDetailResponse(runtimeDetail({
      action: 'geo_prompt_variant.deleted', target_type: 'GeoPromptVariant',
      related_entry: { status: 'MISSING', kind: 'GeoPromptVariant', parent_id: null },
    }), runtimeLog.id);
    expect(resolveAuditRelatedLink(missing)).toBeUndefined();
  });

  it('related_entry 严格遵循后端 target registry、status 与 parent 矩阵', () => {
    const parentId = '50000000-0000-4000-8000-000000000001';
    const parentlessKinds = [
      'Product', 'ContentTask', 'PublicationWork', 'PublishedContentIssue', 'GeoObservation', 'GeoOpportunity',
      'PlatformProfile', 'AIChannel', 'GeoPromptVariant',
    ] as const;
    const parentKinds = ['FactVersion', 'ContentVersion', 'PlatformAccount', 'AIModel'] as const;
    const validCases = [
      ...parentlessKinds.flatMap((kind) => [
        { target_type: kind, target_id: runtimeLog.target_id, related_entry: { status: 'AVAILABLE' as const, kind, parent_id: null } },
        { target_type: kind, target_id: runtimeLog.target_id, related_entry: { status: 'MISSING' as const, kind, parent_id: null } },
      ]),
      ...parentKinds.flatMap((kind) => [
        { target_type: kind, target_id: runtimeLog.target_id, related_entry: { status: 'AVAILABLE' as const, kind, parent_id: parentId.toUpperCase() } },
        { target_type: kind, target_id: runtimeLog.target_id, related_entry: { status: 'MISSING' as const, kind, parent_id: null } },
      ]),
      { target_type: 'PlatformProfileVersion', target_id: runtimeLog.target_id, related_entry: { status: 'MISSING' as const, kind: 'PlatformProfileVersion', parent_id: 'historical-parent-id' } },
      { target_type: 'User', target_id: runtimeLog.target_id, related_entry: { status: 'UNSUPPORTED' as const, kind: null, parent_id: null } },
    ];
    for (const value of validCases) {
      expect(parseAuditLogDetailResponse(runtimeDetail(value), runtimeLog.id).related_entry)
        .toMatchObject(value.related_entry.status === 'AVAILABLE' && value.related_entry.parent_id
          ? { ...value.related_entry, parent_id: parentId }
          : value.related_entry);
    }

    const factVersion = parseAuditLogDetailResponse(runtimeDetail({
      target_type: 'FactVersion',
      related_entry: { status: 'AVAILABLE', kind: 'FactVersion', parent_id: parentId },
    }), runtimeLog.id);
    expect(resolveAuditRelatedLink(factVersion)).toEqual({
      href: `/products/${parentId}/facts/versions/${runtimeLog.target_id}`,
      label: '查看事实版本',
    });

    const upperTargetId = runtimeLog.target_id.toUpperCase();
    const canonicalAvailable = parseAuditLogDetailResponse(runtimeDetail({
      target_id: upperTargetId,
      related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null },
    }), runtimeLog.id);
    expect(canonicalAvailable.target_id).toBe(runtimeLog.target_id);
    expect(resolveAuditRelatedLink(canonicalAvailable)).toEqual({
      href: `/settings/ai/${runtimeLog.target_id}?tab=basic`,
      label: '查看 AI 渠道',
    });

    const historicalTargetId = 'historical-non-uuid-target';
    expect(parseAuditLogDetailResponse(runtimeDetail({
      target_id: historicalTargetId,
      related_entry: { status: 'MISSING', kind: 'AIChannel', parent_id: null },
    }), runtimeLog.id).target_id).toBe(historicalTargetId);

    for (const prototypeName of ['__proto__', 'constructor', 'toString']) {
      expect(parseAuditLogDetailResponse(runtimeDetail({
        target_type: prototypeName,
        target_id: historicalTargetId,
        related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null },
      }), runtimeLog.id)).toMatchObject({
        target_type: prototypeName,
        target_id: historicalTargetId,
        related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null },
      });
      expectRuntimeProjectionFailure(runtimeDetail({
        target_type: prototypeName,
        related_entry: { status: 'AVAILABLE', kind: prototypeName, parent_id: null },
      }));
    }

    const sentinel = 'audit-runtime-secret-sentinel';
    const invalidCases = [
      { target_type: 'User', related_entry: { status: 'AVAILABLE', kind: 'User', parent_id: null } },
      { target_type: 'AIChannel', related_entry: { status: 'AVAILABLE', kind: 'Product', parent_id: null } },
      { target_type: 'AIChannel', target_id: null, related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null } },
      { target_type: 'AIChannel', target_id: sentinel, related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null } },
      { target_type: 'AIChannel', related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: sentinel } },
      { target_type: 'FactVersion', related_entry: { status: 'AVAILABLE', kind: 'FactVersion', parent_id: null } },
      { target_type: 'FactVersion', related_entry: { status: 'MISSING', kind: 'FactVersion', parent_id: sentinel } },
      { target_type: 'PlatformProfileVersion', related_entry: { status: 'AVAILABLE', kind: 'PlatformProfileVersion', parent_id: sentinel } },
      { target_type: 'PublicationWork', related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null } },
      { target_type: 'UnknownTarget', related_entry: { status: 'UNSUPPORTED', kind: sentinel, parent_id: sentinel } },
    ];
    for (const value of invalidCases) expectRuntimeProjectionFailure(runtimeDetail(value));

    expect(() => resolveAuditRelatedLink(runtimeDetail(invalidCases[1]) as never))
      .toThrow('审计响应安全投影失败');
  });

  it('详情身份 logId 不进入列表 API 参数', () => {
    const search = auditSearchSchema.parse({
      createdFrom: '2026-08-13T00:00:00.000Z',
      createdTo: '2026-08-16T00:00:00.000Z',
      logId: '00000000-0000-4000-8000-000000000099',
    });
    expect(auditSearchToApiParams(search)).not.toHaveProperty('log_id');
  });

  it('GEO 规则更新只投影 revision，不展示配置或其他配置模块详情', () => {
    const update = runtimeDetail({
      business_module: 'CONFIGURATION', action: 'geo_rule_set.updated', target_type: 'GeoRuleSet', target_id: 'current',
      facts: { revision: 3 }, changes: [], related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null },
    });
    const detail = parseAuditLogDetailResponse(update, runtimeLog.id);
    expect(auditActionLabel(detail.action)).toBe('更新 GEO 规则集');
    expect(projectAuditFacts(detail.facts)).toEqual([{ field: 'revision', label: '修订号', value: '3' }]);
    expect(resolveAuditRelatedLink(detail)).toBeUndefined();
    for (const facts of [{ revision: 3, configuration: 'hidden' }, { revision: 3, reason: 'hidden' }, { revision: 0 }]) {
      expectRuntimeProjectionFailure({ ...update, facts });
    }
    expectRuntimeProjectionFailure({ ...update, changes: [{ field: 'revision', before: 2, after: 3 }] });
  });
  it.each([
    ['geo_opportunity.acknowledged', 'ACKNOWLEDGED', '确认 GEO 机会'],
    ['geo_opportunity.dismissed', 'DISMISSED', '忽略 GEO 机会'],
  ])('机会审计 %s 仅允许低敏状态与修订号，并链接到机会 Drawer', (action, status, label) => {
    const raw = runtimeDetail({ action, business_module: 'GEO_OBSERVATION', target_type: 'GeoOpportunity',
      changes: [], facts: { revision: 3, status }, related_entry: { status: 'AVAILABLE', kind: 'GeoOpportunity', parent_id: null } });
    const parsed = parseAuditLogDetailResponse(raw, runtimeLog.id);
    expect(auditActionLabel(action)).toBe(label);
    expect(projectAuditFacts(parsed.facts)).toEqual([{ field: 'revision', label: '修订号', value: '3' }, { field: 'status', label: '状态', value: status }]);
    expect(resolveAuditRelatedLink(parsed)).toEqual({ href: `/geo/opportunities?opportunity_id=${runtimeLog.target_id}`, label: '查看 GEO 机会' });
    for (const facts of [{ revision: 3, status, resolution_comment: 'hidden' }, { revision: 3, status, answer_text: 'hidden' }, { revision: 3, status, download_url: 'hidden' }, { revision: 0, status }, { revision: 3, status: 'OPEN' }]) expectRuntimeProjectionFailure({ ...raw, facts });
    expectRuntimeProjectionFailure({ ...raw, business_module: 'CONFIGURATION' });
    expectRuntimeProjectionFailure({ ...raw, changes: [{ field: 'status', after: status }] });
  });
});


describe('GEO-706 处理审计安全投影', () => {
  it.each([
    ['geo_opportunity.resolved', 'MANUAL_RESOLVE', 'RESOLVED', '解决 GEO 机会'],
    ['geo_opportunity.resolved', 'RETEST_RESOLVE', 'RESOLVED', '解决 GEO 机会'],
    ['geo_opportunity.continued', 'CONTINUE', 'IN_PROGRESS', '继续跟进 GEO 机会'],
  ])('%s / %s 仅展示低敏处理身份', (action, decision, status, label) => {
    const facts = { decision_id: '00000000-0000-4000-8000-000000000706', decision, revision: 4, status };
    const raw = runtimeDetail({ action, business_module: 'GEO_OBSERVATION', target_type: 'GeoOpportunity',
      changes: [], facts, related_entry: { status: 'AVAILABLE', kind: 'GeoOpportunity', parent_id: null } });
    const parsed = parseAuditLogDetailResponse(raw, runtimeLog.id);
    expect(auditActionLabel(parsed.action)).toBe(label);
    expect(projectAuditFacts(parsed.facts)).toContainEqual({ field: 'decision_id', label: '处理记录 ID', value: facts.decision_id });
    for (const patch of [
      { resolution_comment: '保密依据' }, { comparison_snapshot: '内部证据' },
      { decision_id: 'invalid' }, { decision: 'UNKNOWN' }, { status: 'OPEN' }, { revision: 0 },
    ]) expectRuntimeProjectionFailure({ ...raw, facts: { ...facts, ...patch } });
    expectRuntimeProjectionFailure({ ...raw, changes: [{ field: 'status', after: status }] });
  });
});
