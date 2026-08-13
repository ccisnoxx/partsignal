import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  invalidatePlatformTypeConsumers,
  platformKeys,
  PlatformRequestError,
} from './platform.api';
import {
  mapPlatformTypeFormError,
  platformTypeBlockerHref,
  platformTypeFormSchema,
  platformTypeOverflowActions,
  type PlatformType,
} from './platform-types.model';

function platformType(overrides: Partial<PlatformType> = {}): PlatformType {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    name: '技术社区',
    slug: 'technical-community',
    platform_count: 0,
    available_actions: ['UPDATE', 'DELETE'],
    deletion: { blockers: [] },
    primary_task: 'EDIT_CATEGORY',
    revision: 2,
    created_by: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

describe('platform type model', () => {
  it('把服务端动作映射到 overflow，并拒绝未知或矛盾投影', () => {
    expect(platformTypeOverflowActions(platformType()).map((action) => action.label))
      .toEqual(['编辑', '删除']);
    expect(platformTypeOverflowActions(platformType({
      platform_count: 2,
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 2 }] },
    })).map((action) => action.label)).toEqual(['编辑', '查看删除条件']);
    expect(() => platformTypeOverflowActions(platformType({
      available_actions: ['UPDATE', 'UNKNOWN' as never],
    }))).toThrow('未知 available_action');
    expect(() => platformTypeOverflowActions(platformType({
      primary_task: 'UNKNOWN' as never,
    }))).toThrow('未知 primary_task');
    expect(() => platformTypeOverflowActions(platformType({
      platform_count: 1,
    }))).toThrow('缺少与 platform_count 对应');
  });

  it('校验真实字段边界且只 trim Name，不规范化 Slug', () => {
    expect(platformTypeFormSchema.parse({ name: '  社区  ', slug: 'community-1' }))
      .toEqual({ name: '社区', slug: 'community-1' });
    expect(platformTypeFormSchema.safeParse({ name: '社区', slug: 'Community' }).success)
      .toBe(false);
    expect(platformTypeFormSchema.safeParse({ name: ' ', slug: 'community' }).success)
      .toBe(false);
  });

  it('映射 slug 字段错误并区分 revision conflict', () => {
    const slugError = new PlatformRequestError('slug 冲突', 409, {
      code: 'PLATFORM_TYPE_SLUG_EXISTS',
      message: '平台类型 slug 已存在',
      request_id: 'request-slug',
      details: {
        errors: [{
          loc: ['body', 'slug'],
          msg: '平台类型 slug 已存在',
          type: 'platform_type_slug_exists',
        }],
      },
    });
    expect(mapPlatformTypeFormError(slugError)).toEqual({
      fields: { slug: '平台类型 slug 已存在' },
      formMessage: undefined,
      requestId: 'request-slug',
      revisionConflict: false,
    });

    const revision = new PlatformRequestError('revision 冲突', 409, {
      code: 'REVISION_CONFLICT',
      message: '平台类型已被修改',
      request_id: 'request-revision',
      details: {},
    });
    expect(mapPlatformTypeFormError(revision).revisionConflict).toBe(true);
  });

  it('生成精确 blocker 链接并只失效三个真实消费者', async () => {
    expect(platformTypeBlockerHref('type/id')).toBe(
      '/settings/platforms?platformTypeId=type%2Fid&page=1&pageSize=20',
    );
    const client = new QueryClient();
    client.setQueryData(platformKeys.types(), 'types');
    client.setQueryData([...platformKeys.lists(), { page: 1 }], 'list');
    client.setQueryData(platformKeys.detail('platform-1'), 'detail');
    client.setQueryData(['content', 'unrelated'], 'untouched');

    await invalidatePlatformTypeConsumers(client);

    expect(client.getQueryState(platformKeys.types())?.isInvalidated).toBe(true);
    expect(client.getQueryState([...platformKeys.lists(), { page: 1 }])?.isInvalidated)
      .toBe(true);
    expect(client.getQueryState(platformKeys.detail('platform-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['content', 'unrelated'])?.isInvalidated).toBe(false);
  });
});
