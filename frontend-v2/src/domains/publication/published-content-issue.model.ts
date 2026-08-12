import { z } from 'zod';

import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components, operations } from '@/shared/api/generated/schema';

type PublishedContentIssue = components['schemas']['PublishedContentIssue'];
type PublishedContentIssueListItem = components['schemas']['PublishedContentIssueListItem'];
type PublishedContentIssueWorkspaceContext = components['schemas']['PublishedContentIssueWorkspaceContext'];
type PublishedContentRepairContext = components['schemas']['PublishedContentRepairContext'];
type PublishedContentIssueListApiParams = NonNullable<
  operations['listPublishedContentIssues']['parameters']['query']
>;
type StatusTone = 'success' | 'warning' | 'secondary' | 'destructive' | 'info';

const issueStatusValues = ['OPEN', 'RESOLVED', 'ALL'] as const;
type PublishedContentIssueStatusFilter = typeof issueStatusValues[number];

const issueStatusLabels = {
  OPEN: '待处理',
  RESOLVED: '已解决',
  ALL: '全部问题',
} satisfies Record<PublishedContentIssueStatusFilter, string>;

const issueKindLabels = {
  PAGE_UNAVAILABLE: '页面不可访问',
  CONTENT_CHANGED: '公开内容发生变化',
  OTHER: '其他问题',
} satisfies Record<PublishedContentIssueListItem['kind'], string>;

const issueStageRegistry = {
  OPEN: { label: '待处理', tone: 'destructive' },
  REPAIRING: { label: '修复中', tone: 'info' },
  AWAITING_RESOLUTION: { label: '待确认解决', tone: 'warning' },
  RESOLVED: { label: '已解决', tone: 'success' },
} satisfies Record<PublishedContentIssueListItem['workflow_stage'], {
  label: string;
  tone: StatusTone;
}>;

const issueSearchSchema = z.object({
  status: z.preprocess(
    (value) => typeof value === 'string' && issueStatusValues.includes(
      value as PublishedContentIssueStatusFilter,
    ) ? value : 'OPEN',
    z.enum(issueStatusValues),
  ).default('OPEN'),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type PublishedContentIssueSearch = z.output<typeof issueSearchSchema>;

function issueSearchToApiParams(
  search: PublishedContentIssueSearch,
): PublishedContentIssueListApiParams {
  return {
    page: search.page,
    page_size: search.pageSize,
    status: search.status === 'ALL' ? undefined : search.status,
  };
}

function canonicalIssueSearchRecord(
  search: PublishedContentIssueSearch,
): Record<string, string | number> {
  return { status: search.status, page: search.page, pageSize: search.pageSize };
}

function isCanonicalIssueSearch(
  raw: Record<string, unknown>,
  search: PublishedContentIssueSearch,
) {
  const expected = canonicalIssueSearchRecord(search);
  const keys = Object.keys(expected);
  return Object.keys(raw).length === keys.length
    && keys.every((key) => String(raw[key]) === String(expected[key]));
}

function normalizeIssuePageSize(value: number): PublishedContentIssueSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`内容问题表格收到未知分页大小：${value}`);
}

const issueWorkspaceSections = ['issue', 'article', 'repair', 'resolution', 'history'] as const;
type PublishedContentIssueWorkspaceSection = typeof issueWorkspaceSections[number];

function canonicalIssueWorkspaceHash(hash: string): PublishedContentIssueWorkspaceSection {
  const value = hash.replace(/^#/, '');
  return issueWorkspaceSections.includes(value as PublishedContentIssueWorkspaceSection)
    ? value as PublishedContentIssueWorkspaceSection
    : 'issue';
}

function isCanonicalIssueWorkspaceHash(hash: string) {
  return hash.replace(/^#/, '') === canonicalIssueWorkspaceHash(hash);
}

function issueHref(issueId: string, section: PublishedContentIssueWorkspaceSection) {
  return `/publishing/issues/${issueId}#${section}`;
}

function assertIssueActionContract(issue: PublishedContentIssueListItem) {
  if (
    issue.primary_task === 'HANDLE_CONTENT_ISSUE'
    && (
      issue.available_actions.length !== 2
      || !issue.available_actions.includes('CREATE_REPAIR_TASK')
      || !issue.available_actions.includes('RESOLVE')
    )
  ) {
    throw new Error('内容问题主任务需要 CREATE_REPAIR_TASK 与 RESOLVE 动作');
  }
  if (
    issue.primary_task === 'CONTINUE_REPAIR'
    && (
      !issue.repair_task_id
      || issue.available_actions.length !== 1
      || issue.available_actions[0] !== 'RESOLVE'
    )
  ) {
    throw new Error('继续修复主任务需要 repair_task_id 与唯一 RESOLVE 动作');
  }
  if (
    issue.primary_task === 'CONFIRM_RESOLUTION'
    && (issue.available_actions.length !== 1 || issue.available_actions[0] !== 'RESOLVE')
  ) {
    throw new Error('确认解决主任务需要唯一 RESOLVE 动作');
  }
  if (issue.primary_task === 'VIEW_RESOLUTION' && issue.available_actions.length > 0) {
    throw new Error('已解决内容问题不应返回可执行动作');
  }
}

function resolveIssuePrimaryAction(issue: PublishedContentIssueListItem): PrimaryRowAction {
  assertIssueActionContract(issue);
  if (issue.primary_task === 'HANDLE_CONTENT_ISSUE') {
    return {
      key: 'CREATE_REPAIR_TASK', label: '创建修复任务', intent: 'primary', enabled: true,
      href: issueHref(issue.id, 'repair'),
    };
  }
  if (issue.primary_task === 'CONTINUE_REPAIR') {
    return {
      key: 'CONTINUE_REPAIR', label: '继续修复', intent: 'primary', enabled: true,
      href: `/content/tasks/${issue.repair_task_id}`,
    };
  }
  return {
    key: issue.primary_task,
    label: issue.primary_task === 'CONFIRM_RESOLUTION' ? '确认解决' : '查看解决记录',
    intent: 'primary',
    enabled: true,
    href: issueHref(issue.id, 'resolution'),
  };
}

function resolveIssueOverflowActions(
  issue: PublishedContentIssueListItem,
): OverflowRowAction[] {
  assertIssueActionContract(issue);
  const primaryToken = issue.primary_task === 'HANDLE_CONTENT_ISSUE'
    ? 'CREATE_REPAIR_TASK'
    : issue.primary_task === 'CONFIRM_RESOLUTION'
      ? 'RESOLVE'
      : undefined;
  return issue.available_actions
    .filter((action) => action !== primaryToken)
    .map((action) => ({
      key: action,
      label: action === 'RESOLVE' ? '解决内容问题' : '创建修复任务',
      intent: 'secondary' as const,
      enabled: true,
      href: issueHref(issue.id, action === 'RESOLVE' ? 'resolution' : 'repair'),
    }));
}

const openIssueFormSchema = z.object({
  kind: z.enum(['PAGE_UNAVAILABLE', 'CONTENT_CHANGED', 'OTHER']),
  description: z.string().trim().min(1, '请输入问题描述'),
});

const repairIssueFormSchema = z.object({
  factVersionId: z.uuid('请选择有效的 Fact Version'),
});

const resolveIssueFormSchema = z.object({
  outcome: z.enum(['RESTORED', 'RETIRED']),
  comment: z.string().trim().min(1, '请输入解决说明'),
});

export {
  assertIssueActionContract,
  canonicalIssueSearchRecord,
  canonicalIssueWorkspaceHash,
  isCanonicalIssueSearch,
  isCanonicalIssueWorkspaceHash,
  issueHref,
  issueKindLabels,
  issueSearchSchema,
  issueSearchToApiParams,
  issueStageRegistry,
  issueStatusLabels,
  issueStatusValues,
  issueWorkspaceSections,
  normalizeIssuePageSize,
  openIssueFormSchema,
  repairIssueFormSchema,
  resolveIssueFormSchema,
  resolveIssueOverflowActions,
  resolveIssuePrimaryAction,
};
export type {
  PublishedContentIssue,
  PublishedContentIssueListApiParams,
  PublishedContentIssueListItem,
  PublishedContentIssueSearch,
  PublishedContentIssueStatusFilter,
  PublishedContentIssueWorkspaceContext,
  PublishedContentIssueWorkspaceSection,
  PublishedContentRepairContext,
};
