import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileList = components['schemas']['PlatformProfileList'];
type PlatformReadinessStatus = components['schemas']['PlatformReadinessStatus'];
type PlatformProfileStatus = components['schemas']['PlatformProfileStatus'];
type PlatformPrimaryTask = NonNullable<PlatformProfile['primary_task']>;
type PlatformAvailableAction = PlatformProfile['available_actions'][number];
type PlatformListApiParams = NonNullable<
  operations['listPlatformProfiles']['parameters']['query']
>;
type PlatformCommand = 'enable-platform' | 'disable-platform' | 'delete-platform';
type BadgeTone = 'secondary' | 'success' | 'warning';

const readinessValues = [
  'COMPLETE',
  'MISSING_PROMPT',
  'MISSING_ACCOUNT',
] as const satisfies readonly PlatformReadinessStatus[];
const statusValues = ['ENABLED', 'DISABLED'] as const satisfies readonly PlatformProfileStatus[];

const readinessRegistry = {
  COMPLETE: { label: '完整', tone: 'success' },
  MISSING_PROMPT: { label: '缺 Prompt', tone: 'warning' },
  MISSING_ACCOUNT: { label: '缺账号', tone: 'warning' },
} satisfies Record<PlatformReadinessStatus, { label: string; tone: BadgeTone }>;

const platformStatusRegistry = {
  ENABLED: { label: 'Enabled', tone: 'success' },
  DISABLED: { label: 'Disabled', tone: 'secondary' },
} satisfies Record<PlatformProfileStatus, { label: string; tone: BadgeTone }>;

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return z.uuid().safeParse(normalized).success ? normalized : undefined;
}

function normalizeStatus(value: unknown) {
  return typeof value === 'string' && statusValues.some((item) => item === value)
    ? value
    : undefined;
}

function normalizeReadiness(value: unknown) {
  return typeof value === 'string' && readinessValues.some((item) => item === value)
    ? value
    : undefined;
}

const platformSearchSchema = z.object({
  q: z.preprocess(normalizeText, z.string().max(200).optional()),
  platformTypeId: z.preprocess(normalizeUuid, z.uuid().optional()),
  status: z.preprocess(normalizeStatus, z.enum(statusValues).optional()),
  configurationStatus: z.preprocess(
    normalizeReadiness,
    z.enum(readinessValues).optional(),
  ),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type PlatformSearch = z.output<typeof platformSearchSchema>;

function platformSearchToApiParams(search: PlatformSearch): PlatformListApiParams {
  return {
    q: search.q,
    platform_type_id: search.platformTypeId,
    status: search.status,
    readiness_status: search.configurationStatus,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalPlatformSearchRecord(search: PlatformSearch): Record<string, string | number> {
  const record: Record<string, string | number> = {
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  if (search.platformTypeId) record.platformTypeId = search.platformTypeId;
  if (search.status) record.status = search.status;
  if (search.configurationStatus) record.configurationStatus = search.configurationStatus;
  return record;
}

function isCanonicalPlatformSearch(raw: Record<string, unknown>, search: PlatformSearch) {
  const expected = canonicalPlatformSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => String(raw[key]) === String(value));
}

function hasPlatformFilters(search: PlatformSearch) {
  return Boolean(
    search.q || search.platformTypeId || search.status || search.configurationStatus,
  );
}

function normalizePlatformPageSize(value: number): PlatformSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`平台列表收到未知分页大小：${value}`);
}

function platformWorkspaceHref(
  platformId: string,
  tab: 'overview' | 'accounts' | 'generation' = 'overview',
) {
  return `/settings/platforms/${encodeURIComponent(platformId)}?tab=${tab}`;
}

function resolvePlatformPrimaryAction(platform: PlatformProfile): PrimaryRowAction | undefined {
  const action = platform.primary_task;
  if (action === null) return undefined;
  switch (action) {
    case 'ENABLE_PLATFORM':
      return {
        key: action,
        label: '重新启用',
        intent: 'primary',
        enabled: true,
        command: 'enable-platform',
      };
    case 'CONFIGURE_GENERATION':
      return primaryLink(action, '配置生成', platform.id, 'generation');
    case 'VIEW_PLATFORM_OPERATION':
      return primaryLink(action, '查看运营', platform.id, 'overview');
    default:
      return assertNever(action);
  }
}

function primaryLink(
  key: PlatformPrimaryTask,
  label: string,
  platformId: string,
  tab: 'overview' | 'accounts' | 'generation',
): PrimaryRowAction {
  return {
    key,
    label,
    intent: 'primary',
    enabled: true,
    href: platformWorkspaceHref(platformId, tab),
  };
}

function resolvePlatformOverflowActions(
  platform: PlatformProfile,
  pending: boolean,
): OverflowRowAction[] {
  const actions = platform.available_actions.flatMap((action) => {
    if (action === 'ENABLE' && platform.primary_task === 'ENABLE_PLATFORM') return [];
    return [resolveAvailableAction(action, platform, pending)];
  });
  if (platform.deletion?.blockers.length && !platform.available_actions.includes('DELETE')) {
    actions.push({
      key: 'VIEW_DELETE_CONDITIONS',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-delete-conditions',
      confirmation: 'custom',
    });
  }
  return actions;
}

function resolveAvailableAction(
  action: PlatformAvailableAction,
  platform: PlatformProfile,
  pending: boolean,
): OverflowRowAction {
  switch (action) {
    case 'UPDATE':
      return {
        key: action,
        label: '编辑平台',
        intent: 'secondary',
        enabled: true,
        href: platformWorkspaceHref(platform.id),
      };
    case 'ENABLE':
      return statusAction(action, '启用平台', 'enable-platform', platform, pending);
    case 'DISABLE':
      return statusAction(action, '停用平台', 'disable-platform', platform, pending);
    case 'DELETE':
      if (!platform.deletion || platform.deletion.blockers.length > 0 || platform.is_active) {
        throw new Error(`平台 ${platform.id} 返回了矛盾的 DELETE projection`);
      }
      return {
        key: action,
        label: pending ? '正在删除…' : '删除平台',
        intent: 'danger',
        enabled: !pending,
        command: 'delete-platform',
        disabledReason: pending ? '请求正在处理' : undefined,
        confirmation: 'custom',
      };
    default:
      return assertNever(action);
  }
}

function statusAction(
  key: 'ENABLE' | 'DISABLE',
  label: string,
  command: 'enable-platform' | 'disable-platform',
  platform: PlatformProfile,
  pending: boolean,
): OverflowRowAction {
  const disabling = key === 'DISABLE';
  return {
    key,
    label: pending ? '正在处理…' : label,
    intent: 'secondary',
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
    confirmation: {
      title: `${label}“${platform.name}”？`,
      description: disabling
        ? '停用后不能新建关联任务、账号或发布工作；既有配置与历史保持不变。'
        : '启用不会自动补齐 Prompt 或发布账号。',
      confirmLabel: label,
    },
  };
}

function deletionBlockerLabel(blocker: components['schemas']['DeletionBlocker']) {
  switch (blocker.type) {
    case 'CONTENT_TASK': return '开放内容任务';
    case 'PUBLICATION_WORK': return '进行中发布工作';
    default: throw new Error(`平台列表收到未知删除阻断类型：${blocker.type}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`平台列表收到未处理的合同 token：${String(value)}`);
}

export {
  canonicalPlatformSearchRecord,
  deletionBlockerLabel,
  hasPlatformFilters,
  isCanonicalPlatformSearch,
  normalizePlatformPageSize,
  platformSearchSchema,
  platformSearchToApiParams,
  platformStatusRegistry,
  platformWorkspaceHref,
  readinessRegistry,
  resolvePlatformOverflowActions,
  resolvePlatformPrimaryAction,
};
export type {
  PlatformCommand,
  PlatformListApiParams,
  PlatformProfile,
  PlatformProfileList,
  PlatformReadinessStatus,
  PlatformSearch,
};
