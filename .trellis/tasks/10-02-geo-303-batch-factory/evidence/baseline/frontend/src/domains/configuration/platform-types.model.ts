import { z } from 'zod';

import type { OverflowRowAction } from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';
import { PlatformRequestError } from './platform.api';

type PlatformType = components['schemas']['PlatformType'];
type PlatformTypeCreate = components['schemas']['PlatformTypeCreate'];
type PlatformTypeUpdate = components['schemas']['PlatformTypeUpdate'];

const platformTypeFormSchema = z.object({
  name: z.string().trim().min(1, '请填写名称').max(160, '名称不能超过 160 个字符'),
  slug: z.string()
    .min(1, '请填写 Slug')
    .max(100, 'Slug 不能超过 100 个字符')
    .regex(/^[a-z0-9-]+$/, 'Slug 只能包含小写字母、数字和连字符'),
});

type PlatformTypeFormValues = z.output<typeof platformTypeFormSchema>;

function platformTypeFormValues(platformType?: PlatformType): PlatformTypeFormValues {
  return {
    name: platformType?.name ?? '',
    slug: platformType?.slug ?? '',
  };
}

function toPlatformTypeCreate(values: PlatformTypeFormValues): PlatformTypeCreate {
  return values;
}

function toPlatformTypeUpdate(
  values: PlatformTypeFormValues,
  expectedRevision: number,
): PlatformTypeUpdate {
  return { ...values, expected_revision: expectedRevision };
}

function platformTypeOverflowActions(platformType: PlatformType): OverflowRowAction[] {
  if (platformType.primary_task !== 'EDIT_CATEGORY') {
    throw new Error(
      `Platform Type API 返回了未知 primary_task：${platformType.primary_task as string}`,
    );
  }
  const tokens = new Set<string>();
  for (const token of platformType.available_actions as string[]) {
    if (token !== 'UPDATE' && token !== 'DELETE') {
      throw new Error(`Platform Type API 返回了未知 available_action：${token}`);
    }
    if (tokens.has(token)) throw new Error(`Platform Type API 返回了重复 available_action：${token}`);
    tokens.add(token);
  }
  if (!tokens.has('UPDATE')) throw new Error('Platform Type API 未提供 UPDATE 动作');
  if (!platformType.deletion) throw new Error('Platform Type API 未提供 deletion 投影');

  const blockers = platformType.deletion.blockers;
  for (const blocker of blockers) {
    if (blocker.type !== 'PLATFORM_PROFILE') {
      throw new Error(`Platform Type API 返回了未知 deletion blocker：${blocker.type}`);
    }
  }
  if (blockers.length > 1) throw new Error('Platform Type API 返回了重复的平台引用 blocker');
  const blocker = blockers[0];
  if (blocker && blocker.count !== platformType.platform_count) {
    throw new Error('Platform Type API 的 platform_count 与 deletion blocker 不一致');
  }
  if (!blocker && platformType.platform_count !== 0) {
    throw new Error('Platform Type API 缺少与 platform_count 对应的 deletion blocker');
  }
  if (tokens.has('DELETE') === Boolean(blocker)) {
    throw new Error('Platform Type API 的 DELETE 动作与 deletion blocker 不一致');
  }

  return [
    {
      key: 'edit',
      label: '编辑',
      intent: 'secondary',
      enabled: true,
      command: 'edit-platform-type',
      confirmation: 'custom',
    },
    blocker ? {
      key: 'conditions',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-platform-type-delete-conditions',
      confirmation: 'custom',
    } : {
      key: 'delete',
      label: '删除',
      intent: 'danger',
      enabled: true,
      command: 'delete-platform-type',
      confirmation: 'custom',
    },
  ];
}

function platformTypeBlockerHref(platformTypeId: string) {
  return `/settings/platforms?platformTypeId=${encodeURIComponent(platformTypeId)}&page=1&pageSize=20`;
}

function mapPlatformTypeFormError(error: unknown) {
  if (!(error instanceof PlatformRequestError) || !error.detail) {
    return { fields: {}, formMessage: errorMessage(error), revisionConflict: false };
  }
  const fields: Partial<Record<keyof PlatformTypeFormValues, string>> = {};
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
      const field = Array.isArray(loc) && loc.length === 2 && loc[0] === 'body'
        ? loc[1]
        : undefined;
      if ((field === 'name' || field === 'slug') && typeof message === 'string') {
        fields[field as keyof PlatformTypeFormValues] ??= message;
      } else {
        unknownIssue = true;
      }
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || unknownIssue
      ? error.detail.message
      : undefined,
    requestId: error.detail.request_id,
    revisionConflict: error.detail.code === 'REVISION_CONFLICT',
  };
}

function isPlatformTypeRevisionConflict(error: unknown) {
  return error instanceof PlatformRequestError && error.detail?.code === 'REVISION_CONFLICT';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export {
  errorMessage,
  isPlatformTypeRevisionConflict,
  mapPlatformTypeFormError,
  platformTypeBlockerHref,
  platformTypeFormSchema,
  platformTypeFormValues,
  platformTypeOverflowActions,
  toPlatformTypeCreate,
  toPlatformTypeUpdate,
};
export type { PlatformType, PlatformTypeFormValues };
