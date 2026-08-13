import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { PlatformRequestError } from './platform.api';

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileDetail = components['schemas']['PlatformProfileDetail'];
type PlatformProfileUpdate = components['schemas']['PlatformProfileUpdate'];
type PlatformLogoChange = PlatformProfileUpdate['logo'] | undefined;

const platformWorkspaceTabs = ['overview', 'accounts', 'generation'] as const;
type PlatformWorkspaceTab = typeof platformWorkspaceTabs[number];

function normalizeTab(value: unknown): PlatformWorkspaceTab {
  return typeof value === 'string'
    && platformWorkspaceTabs.some((tab) => tab === value)
    ? value as PlatformWorkspaceTab
    : 'overview';
}

const platformWorkspaceSearchSchema = z.object({
  tab: z.preprocess(normalizeTab, z.enum(platformWorkspaceTabs)),
});

type PlatformWorkspaceSearch = z.output<typeof platformWorkspaceSearchSchema>;

function isCanonicalPlatformWorkspaceSearch(
  raw: Record<string, unknown>,
  search: PlatformWorkspaceSearch,
) {
  return Object.keys(raw).length === 1 && raw.tab === search.tab;
}

const domainLine = z.string()
  .min(1, '允许域名不能为空')
  .max(253, '允许域名不能超过 253 个字符')
  .refine(
    (value) => !/[/?#@:*]/.test(value),
    '只填写主机名，不要包含协议、路径、端口或通配符',
  );

function parsedDomains(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

const platformOverviewFormSchema = z.object({
  name: z.string().trim().min(1, '请输入平台名称').max(160, '平台名称不能超过 160 个字符'),
  platformTypeId: z.string().min(1, '请选择平台类型').pipe(z.uuid('请选择有效的平台类型')),
  websiteUrl: z.string().trim().refine(
    (value) => value === '' || z.httpUrl().safeParse(value).success,
    '请输入有效的网站 URL',
  ),
  allowedDomains: z.string().superRefine((value, context) => {
    const domains = parsedDomains(value);
    if (domains.length === 0) {
      context.addIssue({ code: 'custom', message: '至少填写一个允许域名' });
      return;
    }
    const duplicate = new Set(domains.map((item) => item.toLocaleLowerCase())).size !== domains.length;
    if (duplicate) context.addIssue({ code: 'custom', message: '允许域名不能重复' });
    domains.forEach((domain) => {
      const result = domainLine.safeParse(domain);
      if (!result.success) {
        context.addIssue({ code: 'custom', message: result.error.issues[0]?.message ?? '允许域名无效' });
      }
    });
  }),
});

type PlatformOverviewFormValues = z.infer<typeof platformOverviewFormSchema>;

const platformGenerationFormSchema = z.object({
  promptId: z.union([z.literal('NONE'), z.uuid('请选择有效的 Prompt')]),
});

type PlatformGenerationFormValues = z.infer<typeof platformGenerationFormSchema>;

function platformToOverviewValues(profile: PlatformProfile): PlatformOverviewFormValues {
  return {
    name: profile.name,
    platformTypeId: profile.platform_type_id ?? '',
    websiteUrl: profile.website_url ?? '',
    allowedDomains: profile.allowed_domains.join('\n'),
  };
}

function platformToGenerationValues(profile: PlatformProfile): PlatformGenerationFormValues {
  return { promptId: profile.platform_prompt?.id ?? 'NONE' };
}

function toPlatformOverviewUpdate(
  values: PlatformOverviewFormValues,
  profile: PlatformProfile,
  logo: PlatformLogoChange,
): PlatformProfileUpdate {
  const update: PlatformProfileUpdate = {
    expected_revision: profile.revision,
    name: values.name.trim(),
    allowed_domains: parsedDomains(values.allowedDomains),
    platform_type_id: values.platformTypeId,
    platform_prompt_id: profile.platform_prompt?.id ?? null,
    website_url: values.websiteUrl.trim() || null,
  };
  if (logo !== undefined) update.logo = logo;
  return update;
}

function toPlatformGenerationUpdate(
  values: PlatformGenerationFormValues,
  profile: PlatformProfile,
): PlatformProfileUpdate {
  if (!profile.platform_type_id) {
    throw new Error('平台缺少有效类型，请先在概览中补齐后再绑定 Prompt');
  }
  return {
    expected_revision: profile.revision,
    name: profile.name,
    allowed_domains: profile.allowed_domains,
    platform_type_id: profile.platform_type_id,
    platform_prompt_id: values.promptId === 'NONE' ? null : values.promptId,
    website_url: profile.website_url,
  };
}

function platformDetailErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof PlatformRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function isPlatformRevisionConflict(error: unknown) {
  return error instanceof PlatformRequestError && error.detail?.code === 'REVISION_CONFLICT';
}

export {
  isCanonicalPlatformWorkspaceSearch,
  isPlatformRevisionConflict,
  platformDetailErrorKind,
  platformGenerationFormSchema,
  platformOverviewFormSchema,
  platformToGenerationValues,
  platformToOverviewValues,
  platformWorkspaceSearchSchema,
  platformWorkspaceTabs,
  toPlatformGenerationUpdate,
  toPlatformOverviewUpdate,
};
export type {
  PlatformGenerationFormValues,
  PlatformLogoChange,
  PlatformOverviewFormValues,
  PlatformProfileDetail,
  PlatformWorkspaceSearch,
  PlatformWorkspaceTab,
};
