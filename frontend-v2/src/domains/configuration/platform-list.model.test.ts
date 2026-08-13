import { describe, expect, it } from 'vitest';

import {
  canonicalPlatformSearchRecord,
  isCanonicalPlatformSearch,
  platformSearchSchema,
  platformSearchToApiParams,
  resolvePlatformOverflowActions,
  resolvePlatformPrimaryAction,
  type PlatformProfile,
} from './platform-list.model';

function platform(overrides: Partial<PlatformProfile> = {}): PlatformProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: '工程师社区',
    slug: 'engineer-community',
    allowed_domains: ['community.example.invalid'],
    platform_type_id: null,
    platform_type: null,
    website_url: null,
    logo: null,
    revision: 3,
    is_active: true,
    platform_prompt: null,
    configuration_complete: false,
    platform_account_count: 1,
    enabled_platform_account_count: 1,
    readiness_status: 'MISSING_PROMPT',
    workflow_stage: 'GENERATION_UNCONFIGURED',
    primary_task: 'CONFIGURE_GENERATION',
    available_actions: ['UPDATE', 'DISABLE'],
    deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
    updated_at: null,
    ...overrides,
  };
}

describe('平台列表 URL 与动作模型', () => {
  it('生成显式默认值并把 URL camelCase 映射到 API snake_case', () => {
    const defaults = platformSearchSchema.parse({});
    expect(defaults).toEqual({ page: 1, pageSize: 20 });
    expect(canonicalPlatformSearchRecord(defaults)).toEqual({ page: 1, pageSize: 20 });

    const parsed = platformSearchSchema.parse({
      q: '  工程师  ',
      platformTypeId: '00000000-0000-4000-8000-0000000000AA',
      status: 'ENABLED',
      configurationStatus: 'MISSING_ACCOUNT',
      page: '2',
      pageSize: '50',
    });
    expect(platformSearchToApiParams(parsed)).toEqual({
      q: '工程师',
      platform_type_id: '00000000-0000-4000-8000-0000000000aa',
      status: 'ENABLED',
      readiness_status: 'MISSING_ACCOUNT',
      page: 2,
      page_size: 50,
    });
  });

  it('非法值与未知参数会被 canonical URL replace', () => {
    const parsed = platformSearchSchema.parse({
      platformTypeId: 'not-a-uuid',
      status: 'UNKNOWN',
      configurationStatus: 'INCOMPLETE',
      page: '-1',
      pageSize: '100',
    });
    expect(parsed).toEqual({ page: 1, pageSize: 20 });
    expect(isCanonicalPlatformSearch({ page: '-1', unknown: 'x' }, parsed)).toBe(false);
    expect(isCanonicalPlatformSearch({ page: '1', pageSize: '20' }, parsed)).toBe(true);
  });

  it('穷尽解析 primary 与 available actions，并拒绝矛盾 DELETE', () => {
    expect(resolvePlatformPrimaryAction(platform())).toMatchObject({
      label: '配置生成',
      href: '/settings/platforms/00000000-0000-4000-8000-000000000001',
    });
    expect(resolvePlatformPrimaryAction(platform({ primary_task: null }))).toBeUndefined();

    const disabled = platform({
      is_active: false,
      workflow_stage: 'DISABLED',
      primary_task: 'ENABLE_PLATFORM',
      available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
      deletion: { blockers: [] },
    });
    expect(resolvePlatformOverflowActions(disabled, false).map((action) => action.key))
      .toEqual(['UPDATE', 'DELETE']);
    expect(() => resolvePlatformOverflowActions({ ...disabled, is_active: true }, false))
      .toThrow('矛盾的 DELETE projection');
  });

  it('未知服务端 token 明确失败而不是静默忽略', () => {
    expect(() => resolvePlatformPrimaryAction(platform({
      primary_task: 'UNKNOWN' as PlatformProfile['primary_task'],
    }))).toThrow('未处理的合同 token');
    expect(() => resolvePlatformOverflowActions(platform({
      available_actions: ['UNKNOWN' as PlatformProfile['available_actions'][number]],
    }), false)).toThrow('未处理的合同 token');
  });
});
