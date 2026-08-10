import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type ContentTaskListItem = components['schemas']['ContentTaskListItem'];
type ContentTaskWorkflowStage = ContentTaskListItem['workflow_stage'];
type ContentTaskArchiveStatus = NonNullable<
  operations['listContentTasks']['parameters']['query']
>['archive_status'];
type ContentTaskPrimaryTask = ContentTaskListItem['primary_task'];
type ContentTaskAvailableAction = ContentTaskListItem['available_actions'][number];
type ContentTaskListApiParams = NonNullable<
  operations['listContentTasks']['parameters']['query']
>;
type StatusTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info';

type StatusPresentation = {
  label: string;
  tone: StatusTone;
  description: string;
};

const workflowStageValues = [
  'NO_DRAFT',
  'GENERATING',
  'GENERATION_FAILED',
  'DRAFT',
  'REVIEW_PENDING',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHING',
  'VERIFIED',
  'CANCELLED',
] as const satisfies readonly ContentTaskWorkflowStage[];
const archiveStatusValues = ['ACTIVE', 'ARCHIVED', 'ALL'] as const satisfies readonly NonNullable<
  ContentTaskArchiveStatus
>[];

const contentWorkflowStageRegistry = {
  NO_DRAFT: { label: '待创建初稿', tone: 'outline', description: '任务尚无当前内容' },
  GENERATING: { label: 'AI 生成中', tone: 'info', description: '初稿正在生成' },
  GENERATION_FAILED: { label: '生成失败', tone: 'warning', description: '最近一次初稿生成失败' },
  DRAFT: { label: '草稿编辑中', tone: 'info', description: '当前内容仍是草稿' },
  REVIEW_PENDING: { label: '待内容审核', tone: 'warning', description: '当前内容正在等待审核' },
  CHANGES_REQUESTED: { label: '待修订', tone: 'warning', description: '审核已要求修订当前内容' },
  APPROVED: { label: '待发布', tone: 'success', description: '当前内容已批准，可以开始发布' },
  PUBLISHING: { label: '发布中', tone: 'info', description: '任务已有发布工作' },
  VERIFIED: { label: '已完成', tone: 'success', description: '发布结果已经核验' },
  CANCELLED: { label: '已取消', tone: 'secondary', description: '内容任务已经取消' },
} satisfies Record<ContentTaskWorkflowStage, StatusPresentation>;

const archiveStatusRegistry = {
  ACTIVE: '当前任务',
  ARCHIVED: '已归档',
  ALL: '全部任务',
} satisfies Record<NonNullable<ContentTaskArchiveStatus>, string>;

function normalizeSearchText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeWorkflowStage(value: unknown) {
  return typeof value === 'string' && workflowStageValues.some((stage) => stage === value)
    ? value
    : undefined;
}

function normalizeArchiveStatus(value: unknown) {
  return typeof value === 'string' && archiveStatusValues.some((status) => status === value)
    ? value
    : 'ACTIVE';
}

function normalizePlatformId(value: unknown) {
  return typeof value === 'string' && z.uuid().safeParse(value).success ? value : undefined;
}

const contentTasksSearchSchema = z.object({
  q: z.preprocess(normalizeSearchText, z.string().max(200).optional()),
  workflowStage: z.preprocess(
    normalizeWorkflowStage,
    z.enum(workflowStageValues).optional(),
  ),
  archiveStatus: z.preprocess(
    normalizeArchiveStatus,
    z.enum(archiveStatusValues),
  ).default('ACTIVE'),
  platformId: z.preprocess(normalizePlatformId, z.uuid().optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type ContentTasksSearch = z.output<typeof contentTasksSearchSchema>;

function contentTasksSearchToApiParams(search: ContentTasksSearch): ContentTaskListApiParams {
  return {
    q: search.q,
    workflow_stage: search.workflowStage,
    archive_status: search.archiveStatus,
    platform_profile_id: search.platformId,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalContentTasksSearchRecord(
  search: ContentTasksSearch,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    archiveStatus: search.archiveStatus,
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  if (search.workflowStage) record.workflowStage = search.workflowStage;
  if (search.platformId) record.platformId = search.platformId;
  return record;
}

function isCanonicalContentTasksSearch(
  raw: Record<string, unknown>,
  search: ContentTasksSearch,
) {
  const expected = canonicalContentTasksSearchRecord(search);
  const rawKeys = Object.keys(raw);
  const expectedKeys = Object.keys(expected);
  return rawKeys.length === expectedKeys.length
    && expectedKeys.every((key) => {
      const value = raw[key];
      return (typeof value === 'string' || typeof value === 'number')
        && String(value) === String(expected[key]);
    });
}

function hasContentTaskFilters(search: ContentTasksSearch) {
  return Boolean(
    search.q
    || search.workflowStage
    || search.platformId
    || search.archiveStatus !== 'ACTIVE',
  );
}

function normalizeContentTaskPageSize(value: number): ContentTasksSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`Content Tasks 表格收到未知分页大小：${value}`);
}

function resolveContentTaskPrimaryAction(task: ContentTaskListItem): PrimaryRowAction {
  const taskId = encodeURIComponent(task.id);
  const action: ContentTaskPrimaryTask = task.primary_task;
  switch (action) {
    case 'CREATE_FIRST_DRAFT':
      return primaryLink(action, '创建初稿', `/content/tasks/${taskId}/editor`);
    case 'VIEW_GENERATION_PROGRESS':
      return primaryLink(action, '查看生成进度', `/content/tasks/${taskId}`);
    case 'HANDLE_GENERATION_FAILURE':
      return primaryLink(action, '处理生成失败', `/content/tasks/${taskId}`);
    case 'EDIT_AND_SUBMIT_REVIEW':
      return primaryLink(action, '编辑并提交审核', `/content/tasks/${taskId}/editor`);
    case 'REVIEW_CONTENT':
      return primaryLink(action, '审核内容', `/content/tasks/${taskId}/review`);
    case 'REVISE_CONTENT':
      return primaryLink(action, '修订内容', `/content/tasks/${taskId}/editor`);
    case 'START_PUBLICATION':
      return primaryLink(action, '开始发布', '/publishing/work');
    case 'CONTINUE_PUBLICATION':
      return primaryLink(action, '继续发布', `/content/tasks/${taskId}`);
    case 'VIEW_FULL_LINEAGE':
      return primaryLink(action, '查看完整链路', `/content/tasks/${taskId}`);
    case 'VIEW_CANCELLATION':
      return primaryLink(action, '查看取消记录', `/content/tasks/${taskId}`);
    default:
      return assertNever(action);
  }
}

function primaryLink(
  key: ContentTaskPrimaryTask,
  label: string,
  href: string,
): PrimaryRowAction {
  return { key, label, href, intent: 'primary', enabled: true };
}

function resolveContentTaskOverflowActions(
  task: ContentTaskListItem,
  pendingAction?: ContentTaskAvailableAction,
): OverflowRowAction[] {
  return task.available_actions.map((action) => {
    const pending = action === pendingAction;
    switch (action) {
      case 'CANCEL':
        return {
          ...commandAction(
            action,
            pending ? '正在取消…' : '取消任务',
            'cancel-content-task',
            pending,
          ),
          confirmation: 'custom',
        };
      case 'DELETE':
        if (!task.deletion || task.deletion.blockers.length > 0) {
          throw new Error(`Content Tasks API 为 ${task.id} 返回了矛盾的 DELETE projection`);
        }
        return {
          key: action,
          label: pending ? '正在删除…' : '删除任务',
          intent: 'danger',
          enabled: !pending,
          command: 'delete-content-task',
          disabledReason: pending ? '删除请求正在处理' : undefined,
          confirmation: {
            title: `确认删除任务“${task.identifier}”`,
            description: '将删除未成功发布的完整内部任务聚合；服务端会在执行时重新检查全部删除条件。',
            confirmLabel: '确认删除',
          },
        };
      case 'ARCHIVE':
        return {
          ...commandAction(action, pending ? '正在归档…' : '归档任务', 'archive-content-task', pending),
          confirmation: {
            title: `归档任务“${task.identifier}”`,
            description: '任务将移出当前任务视图，之后可以从已归档视图恢复。',
            confirmLabel: '确认归档',
            intent: 'default',
          },
        };
      case 'RESTORE':
        return {
          ...commandAction(action, pending ? '正在恢复…' : '恢复任务', 'restore-content-task', pending),
          confirmation: {
            title: `恢复任务“${task.identifier}”`,
            description: '任务将恢复到当前任务视图，业务状态不会改变。',
            confirmLabel: '确认恢复',
            intent: 'default',
          },
        };
      case 'PERMANENT_DELETE':
        return {
          key: action,
          label: pending ? '正在永久删除…' : '永久删除',
          intent: 'danger',
          enabled: !pending,
          command: 'permanently-delete-content-task',
          disabledReason: pending ? '永久删除请求正在处理' : undefined,
          confirmation: 'custom',
        };
      case 'CREATE_GENERATION_JOB':
        return linkAction(action, '使用 AI 创建初稿', `/content/tasks/${encodeURIComponent(task.id)}/editor`);
      case 'CREATE_MANUAL_VERSION':
        return linkAction(action, '手动创建初稿', `/content/tasks/${encodeURIComponent(task.id)}/editor`);
      default:
        return assertNever(action);
    }
  });
}

function commandAction(
  key: ContentTaskAvailableAction,
  label: string,
  command: string,
  pending: boolean,
): OverflowRowAction {
  return {
    key,
    label,
    intent: 'secondary',
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
  };
}

function linkAction(
  key: ContentTaskAvailableAction,
  label: string,
  href: string,
): OverflowRowAction {
  return { key, label, intent: 'secondary', enabled: true, href };
}

function formatCurrentContent(current: ContentTaskListItem['current_content']) {
  return current ? `v${current.version} · ${current.source_type}` : '暂无';
}

function formatRelativeContentTaskTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Content Tasks API 返回了非法时间：${value}`);
  const seconds = (timestamp - now) / 1_000;
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(Math.round(seconds), 'second');
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) return formatter.format(Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return formatter.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (Math.abs(days) < 30) return formatter.format(Math.round(days), 'day');
  const months = days / 30;
  if (Math.abs(months) < 12) return formatter.format(Math.round(months), 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

function formatExactContentTaskTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Content Tasks API 返回了非法时间：${value}`);
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function assertNever(value: never): never {
  throw new Error(`Content Tasks 收到未处理的合同 token：${String(value)}`);
}

export {
  archiveStatusRegistry,
  canonicalContentTasksSearchRecord,
  contentTasksSearchSchema,
  contentTasksSearchToApiParams,
  contentWorkflowStageRegistry,
  formatCurrentContent,
  formatExactContentTaskTime,
  formatRelativeContentTaskTime,
  hasContentTaskFilters,
  isCanonicalContentTasksSearch,
  normalizeContentTaskPageSize,
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
};
export type {
  ContentTaskArchiveStatus,
  ContentTaskAvailableAction,
  ContentTaskListApiParams,
  ContentTaskListItem,
  ContentTaskWorkflowStage,
  ContentTasksSearch,
};
