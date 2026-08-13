import { describe, expect, it } from 'vitest';

import { PlatformRequestError } from './platform.api';
import type { PlatformProfile } from './platform-list.model';
import {
  isCanonicalPlatformWorkspaceSearch,
  isPlatformRevisionConflict,
  platformDetailErrorKind,
  platformOverviewFormSchema,
  platformToGenerationValues,
  platformToOverviewValues,
  platformWorkspaceSearchSchema,
  toPlatformGenerationUpdate,
  toPlatformOverviewUpdate,
} from './platform-workspace.model';

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
});
