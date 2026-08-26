import { z } from 'zod';

import type {
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type PublicationReadyItem = components['schemas']['PublicationReadyItem'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublicationWorkListItem = components['schemas']['PublicationWorkListItem'];
type PublicationWorkStatus = components['schemas']['PublicationWorkStatus'];
type PublicationWorkStage = PublicationWorkListItem['workflow_stage'];
type PublicationWorkEventAction = PublicationWorkListItem['latest_event']['action'];
type PublicationWorkListApiParams = NonNullable<
  operations['listPublicationWorks']['parameters']['query']
>;
type StatusTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive';

const publicationWorkStatusValues = [
  'PREPARING',
  'PLATFORM_REVIEW',
  'AWAITING_VERIFICATION',
  'ACTION_REQUIRED',
  'CLOSED',
] as const satisfies readonly PublicationWorkStatus[];

const publicationStageRegistry = {
  PREPARING: { label: '准备中', tone: 'info' },
  PLATFORM_REVIEW: { label: '平台处理中', tone: 'warning' },
  AWAITING_VERIFICATION: { label: '待核验', tone: 'warning' },
  ACTION_REQUIRED: { label: '需处理', tone: 'destructive' },
  COMPLETED: { label: '已完成', tone: 'success' },
  CLOSED: { label: '已关闭', tone: 'secondary' },
} satisfies Record<PublicationWorkStage, { label: string; tone: StatusTone }>;

const publicationEventRegistry = {
  CREATED: '已开始发布',
  PREPARATION_UPDATED: '已更新准备信息',
  PLATFORM_REVIEW_MARKED: '已标记平台处理中',
  RESULT_REGISTERED: '已登记发布结果',
  VERIFICATION_FAILED: '核验未通过',
  CONTENT_VERSION_CHANGED: '已切换内容版本',
  COMPLETED: '已完成核验',
  CLOSED: '已关闭工作',
} satisfies Record<PublicationWorkEventAction, string>;

function normalizeStatus(value: unknown) {
  return typeof value === 'string' && publicationWorkStatusValues.some((status) => status === value)
    ? value
    : undefined;
}

const publicationWorkSearchSchema = z.object({
  status: z.preprocess(normalizeStatus, z.enum(publicationWorkStatusValues).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type PublicationWorkSearch = z.output<typeof publicationWorkSearchSchema>;

function publicationWorkSearchToApiParams(
  search: PublicationWorkSearch,
): PublicationWorkListApiParams {
  return { page: search.page, page_size: search.pageSize, status: search.status };
}

function canonicalPublicationWorkSearchRecord(
  search: PublicationWorkSearch,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.status) record.status = search.status;
  return record;
}

function isCanonicalPublicationWorkSearch(
  raw: Record<string, unknown>,
  search: PublicationWorkSearch,
) {
  const expected = canonicalPublicationWorkSearchRecord(search);
  const expectedKeys = Object.keys(expected);
  return Object.keys(raw).length === expectedKeys.length
    && expectedKeys.every((key) => String(raw[key]) === String(expected[key]));
}

function normalizePublicationWorkPageSize(value: number): PublicationWorkSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`发布工作表格收到未知分页大小：${value}`);
}

function formatPublicationTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Publication API 返回了非法时间：${value}`);
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatRelativePublicationTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Publication API 返回了非法时间：${value}`);
  const minutes = (timestamp - now) / 60_000;
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (Math.abs(minutes) < 1) return '刚刚';
  if (Math.abs(minutes) < 60) return formatter.format(Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return formatter.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (Math.abs(days) < 30) return formatter.format(Math.round(days), 'day');
  return formatPublicationTime(value);
}

const primaryTaskPresentation = {
  CONTINUE_PREPARATION: { label: '继续准备', hash: 'preparation' },
  REGISTER_RESULT: { label: '登记结果', hash: 'result' },
  RUN_FIRST_VERIFICATION: { label: '开始核验', hash: 'verification' },
  FIX_AND_REVERIFY: { label: '修复并复核', hash: 'verification' },
  VIEW_COMPLETION: { label: '查看完成情况', hash: 'summary' },
  VIEW_CLOSURE: { label: '查看关闭情况', hash: 'summary' },
} satisfies Record<PublicationWorkListItem['primary_task'], { label: string; hash: string }>;

const availableActionPresentation = {
  UPDATE_PREPARATION: { label: '更新准备信息', hash: 'preparation' },
  MARK_PLATFORM_REVIEW: { label: '标记平台处理中', hash: 'preparation' },
  REGISTER_RESULT: { label: '登记结果', hash: 'result' },
  VERIFY: { label: '核验发布结果', hash: 'verification' },
  SWITCH_CONTENT_VERSION: { label: '切换内容版本', hash: 'content-version' },
  CLOSE: { label: '关闭发布工作', hash: 'close' },
} satisfies Record<PublicationWorkListItem['available_actions'][number], {
  label: string;
  hash: string;
}>;

const promotedAvailableAction = {
  CONTINUE_PREPARATION: undefined,
  REGISTER_RESULT: 'REGISTER_RESULT',
  RUN_FIRST_VERIFICATION: 'VERIFY',
  FIX_AND_REVERIFY: 'VERIFY',
  VIEW_COMPLETION: undefined,
  VIEW_CLOSURE: undefined,
} satisfies Record<
  PublicationWorkListItem['primary_task'],
  PublicationWorkListItem['available_actions'][number] | undefined
>;

function workHref(workId: string, hash: string) {
  return `/publishing/work/${workId}#${hash}`;
}

function resolvePublicationPrimaryAction(work: PublicationWorkListItem): PrimaryRowAction {
  const action = primaryTaskPresentation[work.primary_task];
  return {
    key: work.primary_task,
    label: action.label,
    intent: 'primary',
    enabled: true,
    href: workHref(work.id, action.hash),
  };
}

function resolvePublicationOverflowActions(
  work: PublicationWorkListItem,
): OverflowRowAction[] {
  return work.available_actions
    .filter((key) => key !== promotedAvailableAction[work.primary_task])
    .map((key) => {
    const action = availableActionPresentation[key];
    return {
      key,
      label: action.label,
      intent: 'secondary' as const,
      enabled: true,
      href: workHref(work.id, action.hash),
    };
    });
}

export {
  publicationWorkStatusValues,
  canonicalPublicationWorkSearchRecord,
  formatPublicationTime,
  formatRelativePublicationTime,
  isCanonicalPublicationWorkSearch,
  normalizePublicationWorkPageSize,
  publicationEventRegistry,
  publicationStageRegistry,
  publicationWorkSearchSchema,
  publicationWorkSearchToApiParams,
  resolvePublicationOverflowActions,
  resolvePublicationPrimaryAction,
};
export type {
  PublicationReadyItem,
  PublicationWork,
  PublicationWorkListApiParams,
  PublicationWorkListItem,
  PublicationWorkSearch,
  PublicationWorkStage,
};
