import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';
import { PlatformRequestError } from './platform.api';

type PlatformAccount = components['schemas']['PlatformAccount'];
type PlatformAccountCreate = components['schemas']['PlatformAccountCreate'];
type PlatformAccountUpdate = components['schemas']['PlatformAccountUpdate'];
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

const platformAccountFormSchema = z.object({
  label: z.string().trim().min(1, '请输入业务标签').max(160, '业务标签不能超过 160 个字符'),
  accountIdentifier: z.string().trim()
    .min(1, '请输入内部账号标识')
    .max(200, '内部账号标识不能超过 200 个字符'),
});

type PlatformAccountFormValues = z.infer<typeof platformAccountFormSchema>;
type PlatformAccountCommand =
  | 'edit-account'
  | 'enable-account'
  | 'disable-account'
  | 'delete-account'
  | 'view-account-delete-conditions';

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

function platformAccountFormValues(account?: PlatformAccount): PlatformAccountFormValues {
  return {
    label: account?.label ?? '',
    accountIdentifier: account?.account_identifier ?? '',
  };
}

function toPlatformAccountCreate(
  values: PlatformAccountFormValues,
  platformId: string,
): PlatformAccountCreate {
  return {
    platform_profile_id: platformId,
    label: values.label.trim(),
    account_identifier: values.accountIdentifier.trim(),
  };
}

function toPlatformAccountUpdate(
  values: PlatformAccountFormValues,
  account: PlatformAccount,
): PlatformAccountUpdate {
  return {
    label: values.label.trim(),
    account_identifier: values.accountIdentifier.trim(),
    expected_revision: account.revision,
  };
}

function resolvePlatformAccountPrimaryAction(account: PlatformAccount): PrimaryRowAction {
  switch (account.primary_task) {
    case 'HANDLE_PLATFORM':
      return {
        key: account.primary_task,
        label: '处理平台',
        intent: 'primary',
        enabled: true,
        href: `/settings/platforms/${account.platform_profile_id}?tab=overview`,
      };
    case 'ENABLE_ACCOUNT':
      return {
        key: account.primary_task,
        label: '启用账号',
        intent: 'primary',
        enabled: true,
        command: 'enable-account',
      };
    case 'MANAGE_ACCOUNT':
      return {
        key: account.primary_task,
        label: '编辑账号',
        intent: 'primary',
        enabled: true,
        command: 'edit-account',
      };
    default:
      return assertNever(account.primary_task);
  }
}

function resolvePlatformAccountOverflowActions(account: PlatformAccount): OverflowRowAction[] {
  const actions = account.available_actions.flatMap((action): OverflowRowAction[] => {
    switch (action) {
      case 'UPDATE':
        return account.primary_task === 'MANAGE_ACCOUNT' ? [] : [{
          key: action,
          label: '编辑账号',
          intent: 'secondary',
          enabled: true,
          command: 'edit-account',
        }];
      case 'ENABLE':
        return account.primary_task === 'ENABLE_ACCOUNT' ? [] : [{
          key: action,
          label: '启用账号',
          intent: 'secondary',
          enabled: true,
          command: 'enable-account',
          confirmation: 'custom',
        }];
      case 'DISABLE':
        return [{
          key: action,
          label: '停用账号',
          intent: 'secondary',
          enabled: true,
          command: 'disable-account',
          confirmation: 'custom',
        }];
      case 'DELETE':
        return [{
          key: action,
          label: '删除账号',
          intent: 'danger',
          enabled: true,
          command: 'delete-account',
          confirmation: 'custom',
        }];
      default:
        return assertNever(action);
    }
  });
  if (account.deletion?.blockers.length) {
    actions.push({
      key: 'VIEW_DELETE_CONDITIONS',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-account-delete-conditions',
      confirmation: 'custom',
    });
  }
  return actions;
}

function mapPlatformAccountFormError(error: unknown) {
  if (!(error instanceof PlatformRequestError) || !error.detail) {
    return { fields: {}, formMessage: error instanceof Error ? error.message : '发布账号请求失败' };
  }
  const fields: Partial<Record<keyof PlatformAccountFormValues, string>> = {};
  const issues = error.detail.details.errors;
  let unknownIssue = false;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        unknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      if (!Array.isArray(loc) || loc.length !== 2 || loc[0] !== 'body' || typeof message !== 'string') {
        unknownIssue = true;
        continue;
      }
      if (loc[1] === 'label') fields.label ??= message;
      else if (loc[1] === 'account_identifier') fields.accountIdentifier ??= message;
      else unknownIssue = true;
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || unknownIssue ? error.detail.message : undefined,
    requestId: error.detail.request_id,
  };
}

function assertNever(value: never): never {
  throw new Error(`Platform Account API 返回未知动作：${String(value)}`);
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
  mapPlatformAccountFormError,
  platformAccountFormSchema,
  platformAccountFormValues,
  platformGenerationFormSchema,
  platformOverviewFormSchema,
  platformToGenerationValues,
  platformToOverviewValues,
  platformWorkspaceSearchSchema,
  platformWorkspaceTabs,
  resolvePlatformAccountOverflowActions,
  resolvePlatformAccountPrimaryAction,
  toPlatformAccountCreate,
  toPlatformAccountUpdate,
  toPlatformGenerationUpdate,
  toPlatformOverviewUpdate,
};
export type {
  PlatformGenerationFormValues,
  PlatformAccountCommand,
  PlatformAccountFormValues,
  PlatformLogoChange,
  PlatformOverviewFormValues,
  PlatformProfileDetail,
  PlatformWorkspaceSearch,
  PlatformWorkspaceTab,
};
