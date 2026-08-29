import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type User = components['schemas']['User'];
type UserList = components['schemas']['UserList'];
type AccountType = components['schemas']['AccountType'];
type UserStatus = components['schemas']['UserStatus'];
type UserListApiParams = NonNullable<operations['listUsers']['parameters']['query']>;
type UserAvailableAction = User['available_actions'][number];
type UserCommand =
  | 'edit-user'
  | 'reset-password'
  | 'enable-user'
  | 'disable-user'
  | 'delete-user'
  | 'show-deletion-blockers';
type BadgeTone = 'secondary' | 'success' | 'warning' | 'destructive';

const accountTypeValues = ['ADMIN', 'ENGINEER'] as const satisfies readonly AccountType[];
const statusValues = ['ENABLED', 'DISABLED', 'ALL'] as const;

const accountTypeRegistry = {
  ADMIN: { label: 'ADMIN', tone: 'warning' },
  ENGINEER: { label: 'ENGINEER', tone: 'secondary' },
} satisfies Record<AccountType, { label: string; tone: BadgeTone }>;

const userStatusRegistry = {
  ENABLED: { label: 'Enabled', tone: 'success' },
  DISABLED: { label: 'Disabled', tone: 'secondary' },
} satisfies Record<UserStatus, { label: string; tone: BadgeTone }>;

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeEnum<T extends string>(value: unknown, values: readonly T[], fallback?: T) {
  return typeof value === 'string' && values.some((item) => item === value)
    ? value
    : fallback;
}

const userSearchSchema = z.object({
  q: z.preprocess(normalizeText, z.string().max(200).optional()),
  accountType: z.preprocess(
    (value) => normalizeEnum(value, accountTypeValues),
    z.enum(accountTypeValues).optional(),
  ),
  status: z.preprocess(
    (value) => normalizeEnum(value, statusValues, 'ENABLED'),
    z.enum(statusValues),
  ).default('ENABLED'),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type UserSearch = z.output<typeof userSearchSchema>;

function userSearchToApiParams(search: UserSearch): UserListApiParams {
  return {
    q: search.q,
    account_type: search.accountType,
    status: search.status === 'ALL' ? undefined : search.status,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalUserSearchRecord(search: UserSearch): Record<string, string | number> {
  const record: Record<string, string | number> = {
    status: search.status,
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  if (search.accountType) record.accountType = search.accountType;
  return record;
}

function isCanonicalUserSearch(raw: Record<string, unknown>, search: UserSearch) {
  const expected = canonicalUserSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => String(raw[key]) === String(value));
}

function userSelectionScope(search: UserSearch) {
  return JSON.stringify(canonicalUserSearchRecord(search));
}

function hasUserFilters(search: UserSearch) {
  return Boolean(search.q || search.accountType || search.status !== 'ENABLED');
}

function normalizeUserPageSize(value: number): UserSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`用户列表收到未知分页大小：${value}`);
}

function resolveUserActions(user: User, pending: boolean) {
  validateUserProjection(user);
  const primaryAction = primaryActionFor(user, pending);
  const primaryToken = primaryAvailableAction(user);
  const overflow = user.available_actions.flatMap((action) => (
    action === primaryToken ? [] : [overflowActionFor(action, user, pending)]
  ));
  if (!user.available_actions.includes('DELETE') && user.deletion?.blockers.length) {
    overflow.push({
      key: 'show-deletion-blockers',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: !pending,
      command: 'show-deletion-blockers',
      confirmation: 'custom',
    });
  }
  return { primary: primaryAction, overflow };
}

function validateUserProjection(user: User) {
  if (new Set(user.available_actions).size !== user.available_actions.length) {
    throw new Error(`用户 ${user.id} 返回了重复的 available_actions`);
  }
  const primaryToken = primaryAvailableAction(user);
  if (!user.available_actions.includes(primaryToken)) {
    throw new Error(`用户 ${user.id} 的 ${user.primary_task} 缺少 ${primaryToken} action`);
  }
  const hasDelete = user.available_actions.includes('DELETE');
  const blockers = user.deletion?.blockers ?? [];
  if (blockers.some((blocker) => blocker.type !== 'USER_BUSINESS_HISTORY')) {
    throw new Error(`用户 ${user.id} 返回了未知 deletion blocker`);
  }
  if (hasDelete && (user.deletion === null || blockers.length > 0)) {
    throw new Error(`用户 ${user.id} 返回了矛盾的 DELETE projection`);
  }
  if (!hasDelete && user.deletion !== null && blockers.length === 0) {
    throw new Error(`用户 ${user.id} 缺少与空 deletion projection 对应的 DELETE action`);
  }
}

function primaryAvailableAction(user: User): UserAvailableAction {
  switch (user.primary_task) {
    case 'MANAGE_LOGIN_SECURITY': return 'RESET_PASSWORD';
    case 'MANAGE_USER': return 'UPDATE';
    case 'ENABLE_USER': return 'ENABLE';
    default: return assertNever(user.primary_task);
  }
}

function primaryActionFor(user: User, pending: boolean): PrimaryRowAction {
  switch (user.primary_task) {
    case 'MANAGE_LOGIN_SECURITY': return primaryCommand(user.primary_task, '重置临时密码', 'reset-password', pending);
    case 'MANAGE_USER': return primaryCommand(user.primary_task, '管理用户', 'edit-user', pending);
    case 'ENABLE_USER': return primaryCommand(user.primary_task, '启用用户', 'enable-user', pending);
    default: return assertNever(user.primary_task);
  }
}

function primaryCommand(
  key: User['primary_task'],
  label: string,
  command: UserCommand,
  pending: boolean,
): PrimaryRowAction {
  return {
    key,
    label: pending ? '正在处理…' : label,
    intent: 'primary',
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
  };
}

function overflowActionFor(
  action: UserAvailableAction,
  user: User,
  pending: boolean,
): OverflowRowAction {
  switch (action) {
    case 'UPDATE': return customAction(action, '编辑用户', 'edit-user', pending);
    case 'RESET_PASSWORD': return customAction(action, '重置临时密码', 'reset-password', pending);
    case 'ENABLE': return customAction(action, '启用用户', 'enable-user', pending);
    case 'DISABLE': return customAction(action, '停用用户', 'disable-user', pending);
    case 'DELETE': return customAction(action, '删除用户', 'delete-user', pending, 'danger');
    default: return assertNever(action);
  }
}

function customAction(
  key: UserAvailableAction,
  label: string,
  command: UserCommand,
  pending: boolean,
  intent: 'secondary' | 'danger' = 'secondary',
): OverflowRowAction {
  const action = {
    key,
    label: pending ? '正在处理…' : label,
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
    confirmation: 'custom',
  } as const;
  return intent === 'danger'
    ? { ...action, intent: 'danger' }
    : { ...action, intent: 'secondary' };
}

const userCreateFormSchema = z.object({
  username: z.string().trim().min(3, '用户名至少需要 3 个字符'),
  display_name: z.string().trim().min(1, '请填写显示名称'),
  temporary_password: z.string().min(12, '临时密码至少需要 12 个字符'),
  account_type: z.enum(accountTypeValues),
});

const userEditFormSchema = z.object({
  display_name: z.string().trim().min(1, '请填写显示名称'),
  account_type: z.enum(accountTypeValues),
  is_active: z.boolean(),
});

const resetPasswordFormSchema = z.object({
  temporary_password: z.string().min(8, '临时密码至少需要 8 个字符'),
});

type UserCreateFormValues = z.output<typeof userCreateFormSchema>;
type UserEditFormValues = z.output<typeof userEditFormSchema>;
type ResetPasswordFormValues = z.output<typeof resetPasswordFormSchema>;

function assertNever(value: never): never {
  throw new Error(`用户列表收到未处理的合同 token：${String(value)}`);
}

export {
  accountTypeRegistry,
  accountTypeValues,
  canonicalUserSearchRecord,
  hasUserFilters,
  isCanonicalUserSearch,
  normalizeUserPageSize,
  resetPasswordFormSchema,
  resolveUserActions,
  userCreateFormSchema,
  userEditFormSchema,
  userSearchSchema,
  userSearchToApiParams,
  userSelectionScope,
  userStatusRegistry,
};
export type {
  AccountType,
  ResetPasswordFormValues,
  User,
  UserCommand,
  UserCreateFormValues,
  UserEditFormValues,
  UserList,
  UserListApiParams,
  UserSearch,
  UserStatus,
};
