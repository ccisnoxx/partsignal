import { describe, expect, it } from 'vitest';

import {
  canonicalUserSearchRecord,
  isCanonicalUserSearch,
  resolveUserActions,
  userSearchSchema,
  userSearchToApiParams,
  type User,
} from './user-list.model';

function managedUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'operator',
    display_name: '运营人员',
    account_type: 'ENGINEER',
    is_active: true,
    must_change_password: false,
    workflow_stage: 'ACTIVE',
    primary_task: 'MANAGE_USER',
    available_actions: ['UPDATE', 'RESET_PASSWORD', 'DISABLE'],
    deletion: { blockers: [{ type: 'USER_BUSINESS_HISTORY', count: 2 }] },
    revision: 4,
    created_at: '2026-08-16T08:00:00Z',
    ...overrides,
  };
}

describe('用户列表 URL 与动作模型', () => {
  it('生成显式默认 URL 并映射 snake_case API 参数', () => {
    const defaults = userSearchSchema.parse({});
    expect(defaults).toEqual({ status: 'ENABLED', page: 1, pageSize: 20 });
    expect(canonicalUserSearchRecord(defaults)).toEqual({ status: 'ENABLED', page: 1, pageSize: 20 });

    const parsed = userSearchSchema.parse({
      q: '  operator  ', accountType: 'ENGINEER', status: 'ALL', page: '2', pageSize: '50',
    });
    expect(userSearchToApiParams(parsed)).toEqual({
      q: 'operator', account_type: 'ENGINEER', status: undefined, page: 2, page_size: 50,
    });
  });

  it('非法值、超长查询和未知参数需要 canonical replace', () => {
    const parsed = userSearchSchema.parse({ q: 'x'.repeat(201), status: 'UNKNOWN', page: '-1', pageSize: '100' });
    expect(parsed).toEqual({ status: 'ENABLED', page: 1, pageSize: 20 });
    expect(isCanonicalUserSearch({ status: 'UNKNOWN', extra: 'x' }, parsed)).toBe(false);
    expect(isCanonicalUserSearch({ status: 'ENABLED', page: '1', pageSize: '20' }, parsed)).toBe(true);
  });

  it('primary 只由 primary_task 决定且从 overflow 去重', () => {
    const actions = resolveUserActions(managedUser(), false);
    expect(actions.primary).toMatchObject({ label: '管理用户', command: 'edit-user' });
    expect(actions.overflow.map((action) => action.key)).toEqual([
      'RESET_PASSWORD', 'DISABLE', 'show-deletion-blockers',
    ]);

    const disabled = resolveUserActions(managedUser({
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_USER',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    }), false);
    expect(disabled.primary).toMatchObject({ label: '启用用户', command: 'enable-user' });
    expect(disabled.overflow.map((action) => action.key)).toEqual(['UPDATE', 'DELETE']);
  });

  it('重复、未知和矛盾 projection 明确失败', () => {
    expect(() => resolveUserActions(managedUser({ available_actions: ['UPDATE', 'UPDATE'] }), false))
      .toThrow('重复的 available_actions');
    expect(() => resolveUserActions(managedUser({ primary_task: 'UNKNOWN' as User['primary_task'] }), false))
      .toThrow('未处理的合同 token');
    expect(() => resolveUserActions(managedUser({ available_actions: ['UPDATE', 'UNKNOWN' as User['available_actions'][number]] }), false))
      .toThrow('未处理的合同 token');
    expect(() => resolveUserActions(managedUser({ available_actions: ['UPDATE', 'DELETE'] }), false))
      .toThrow('矛盾的 DELETE projection');
  });
});
