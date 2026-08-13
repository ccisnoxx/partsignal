import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import { PlatformRequestError } from './platform.api';
import type { PlatformProfile } from './platform-list.model';
import {
  isCanonicalPlatformWorkspaceSearch,
  isPlatformRevisionConflict,
  mapPlatformAccountFormError,
  platformAccountFormSchema,
  platformAccountFormValues,
  platformDetailErrorKind,
  platformOverviewFormSchema,
  platformToGenerationValues,
  platformToOverviewValues,
  platformWorkspaceSearchSchema,
  resolvePlatformAccountOverflowActions,
  resolvePlatformAccountPrimaryAction,
  toPlatformAccountCreate,
  toPlatformAccountUpdate,
  toPlatformGenerationUpdate,
  toPlatformOverviewUpdate,
} from './platform-workspace.model';

type PlatformAccount = components['schemas']['PlatformAccount'];

const profile: PlatformProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '工程师社区',
  slug: 'engineer-community',
  allowed_domains: ['community.example.invalid'],
  platform_type_id: '00000000-0000-4000-8000-000000000010',
  platform_type: {
    id: '00000000-0000-4000-8000-000000000010',
    name: '技术社区',
    slug: 'technical-community',
  },
  website_url: 'https://community.example.invalid/',
  logo: null,
  revision: 4,
  is_active: true,
  platform_prompt: {
    id: '00000000-0000-4000-8000-000000000020',
    name: '社区 Prompt',
    revision: 2,
    updated_at: '2026-08-12T00:00:00Z',
  },
  configuration_complete: true,
  platform_account_count: 1,
  enabled_platform_account_count: 1,
  readiness_status: 'COMPLETE',
  workflow_stage: 'OPERATIONAL',
  primary_task: 'VIEW_PLATFORM_OPERATION',
  available_actions: ['UPDATE', 'DISABLE'],
  deletion: { blockers: [] },
  updated_at: '2026-08-12T00:00:00Z',
};

const account: PlatformAccount = {
  id: '00000000-0000-4000-8000-000000000030',
  platform_profile_id: profile.id,
  label: '运营主账号',
  account_identifier: 'community-main',
  is_active: true,
  workflow_stage: 'OPERATIONAL',
  primary_task: 'MANAGE_ACCOUNT',
  available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
  deletion: { blockers: [] },
  revision: 3,
};

describe('Platform Workspace model', () => {
  it('把缺失、非法或额外 search canonicalize 为唯一 tab URL', () => {
    expect(platformWorkspaceSearchSchema.parse({})).toEqual({ tab: 'overview' });
    expect(platformWorkspaceSearchSchema.parse({ tab: 'unknown' })).toEqual({ tab: 'overview' });
    const accounts = platformWorkspaceSearchSchema.parse({ tab: 'accounts' });
    expect(isCanonicalPlatformWorkspaceSearch({ tab: 'accounts' }, accounts)).toBe(true);
    expect(isCanonicalPlatformWorkspaceSearch({ tab: 'accounts', extra: 'x' }, accounts)).toBe(false);
  });

  it('Overview 单次 PATCH 保留 Prompt，且仅显式改变 Logo', () => {
    const values = platformToOverviewValues(profile);
    expect(platformOverviewFormSchema.parse(values)).toEqual(values);
    expect(toPlatformOverviewUpdate({
      ...values,
      name: '  新名称  ',
      allowedDomains: 'one.example.invalid\ntwo.example.invalid',
    }, profile, undefined)).toEqual({
      expected_revision: 4,
      name: '新名称',
      allowed_domains: ['one.example.invalid', 'two.example.invalid'],
      platform_type_id: profile.platform_type_id,
      platform_prompt_id: profile.platform_prompt?.id,
      website_url: profile.website_url,
    });
    expect(toPlatformOverviewUpdate(values, profile, null)).toMatchObject({ logo: null });
    expect(toPlatformOverviewUpdate(values, profile, {
      source: 'UPLOAD',
      file_id: '00000000-0000-4000-8000-000000000099',
    })).toMatchObject({
      logo: { source: 'UPLOAD', file_id: '00000000-0000-4000-8000-000000000099' },
    });
  });

  it('Generation 只改变 Prompt 并保留同一 Platform revision 的其他权威字段', () => {
    expect(platformToGenerationValues(profile)).toEqual({ promptId: profile.platform_prompt?.id });
    expect(toPlatformGenerationUpdate({ promptId: 'NONE' }, profile)).toEqual({
      expected_revision: 4,
      name: profile.name,
      allowed_domains: profile.allowed_domains,
      platform_type_id: profile.platform_type_id,
      platform_prompt_id: null,
      website_url: profile.website_url,
    });
  });

  it('区分 403/404 并识别需要保留草稿的 revision conflict', () => {
    expect(platformDetailErrorKind(new PlatformRequestError('forbidden', 403))).toBe('forbidden');
    expect(platformDetailErrorKind(new PlatformRequestError('missing', 404))).toBe('not-found');
    expect(isPlatformRevisionConflict(new PlatformRequestError('conflict', 409, {
      code: 'REVISION_CONFLICT',
      message: '平台已变化',
      details: {},
      request_id: 'req-conflict',
    }))).toBe(true);
  });

  it('Account 表单只映射合同字段并携带当前 revision', () => {
    const values = platformAccountFormValues(account);
    expect(platformAccountFormSchema.parse(values)).toEqual(values);
    expect(toPlatformAccountCreate({ label: ' 新账号 ', accountIdentifier: ' account-new ' }, profile.id)).toEqual({
      platform_profile_id: profile.id,
      label: '新账号',
      account_identifier: 'account-new',
    });
    expect(toPlatformAccountUpdate({ label: ' 新标签 ', accountIdentifier: ' updated ' }, account)).toEqual({
      label: '新标签',
      account_identifier: 'updated',
      expected_revision: 3,
    });
  });

  it('Account 行动作穷尽消费服务端 projection，不从角色推导', () => {
    expect(resolvePlatformAccountPrimaryAction(account)).toMatchObject({ command: 'edit-account' });
    expect(resolvePlatformAccountOverflowActions(account).map((action) => action.command)).toEqual([
      'disable-account',
      'delete-account',
    ]);
    expect(resolvePlatformAccountPrimaryAction({
      ...account,
      workflow_stage: 'PLATFORM_DISABLED',
      primary_task: 'HANDLE_PLATFORM',
      available_actions: ['UPDATE', 'DISABLE'],
      deletion: null,
    })).toMatchObject({ href: `/settings/platforms/${profile.id}?tab=overview` });
    expect(() => resolvePlatformAccountOverflowActions({
      ...account,
      available_actions: ['UNKNOWN' as never],
    })).toThrow('Platform Account API 返回未知动作');
  });

  it('Account normalized unique error 定位内部账号标识字段', () => {
    expect(mapPlatformAccountFormError(new PlatformRequestError('重复', 409, {
      code: 'PLATFORM_ACCOUNT_IDENTIFIER_EXISTS',
      message: '该平台已存在相同的运营账号标识',
      details: {
        errors: [{ loc: ['body', 'account_identifier'], msg: '账号标识已存在' }],
      },
      request_id: 'req-account-duplicate',
    }))).toEqual({
      fields: { accountIdentifier: '账号标识已存在' },
      formMessage: undefined,
      requestId: 'req-account-duplicate',
    });
  });
});
