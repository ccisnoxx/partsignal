import { describe, expect, it } from 'vitest';

import {
  canonicalIssueSearchRecord,
  canonicalIssueWorkspaceHash,
  isCanonicalIssueSearch,
  issueSearchSchema,
  issueSearchToApiParams,
  resolveIssueOverflowActions,
  resolveIssuePrimaryAction,
  type PublishedContentIssueListItem,
} from './published-content-issue.model';

const baseIssue = {
  id: '10000000-0000-4000-8000-000000000001',
  kind: 'CONTENT_CHANGED',
  description: '公开内容发生变化',
  status: 'OPEN',
  opened_at: '2026-08-12T00:00:00Z',
  resolved_at: null,
  resolution_outcome: null,
  resolution_comment: null,
  published_article_id: '20000000-0000-4000-8000-000000000002',
  content_title: '测试内容',
  platform_profile_name: '工程师社区',
  actual_title: '公开测试内容',
  final_url: 'https://example.invalid/article',
  revision: 0,
  repair_task_id: null,
  workflow_stage: 'OPEN',
  primary_task: 'HANDLE_CONTENT_ISSUE',
  available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'],
} satisfies PublishedContentIssueListItem;

describe('Published Content Issue model', () => {
  it('canonical search 显式保留 OPEN/page/pageSize，ALL 只在 API 省略 status', () => {
    const search = issueSearchSchema.parse({});
    expect(search).toEqual({ status: 'OPEN', page: 1, pageSize: 20 });
    expect(canonicalIssueSearchRecord(search)).toEqual({ status: 'OPEN', page: 1, pageSize: 20 });
    expect(isCanonicalIssueSearch({}, search)).toBe(false);
    expect(issueSearchToApiParams({ ...search, status: 'ALL' })).toEqual({
      page: 1, page_size: 20, status: undefined,
    });
    expect(canonicalIssueWorkspaceHash('#unknown')).toBe('issue');
    expect(canonicalIssueWorkspaceHash('#resolution')).toBe('resolution');
  });

  it('主入口和 overflow 只消费 primary_task、available_actions 与 repair_task_id', () => {
    expect(resolveIssuePrimaryAction(baseIssue)).toMatchObject({
      key: 'CREATE_REPAIR_TASK', href: `/publishing/issues/${baseIssue.id}#repair`,
    });
    expect(resolveIssueOverflowActions(baseIssue)).toEqual([expect.objectContaining({
      key: 'RESOLVE', href: `/publishing/issues/${baseIssue.id}#resolution`,
    })]);

    const repairTaskId = '30000000-0000-4000-8000-000000000003';
    expect(resolveIssuePrimaryAction({
      ...baseIssue,
      workflow_stage: 'REPAIRING',
      primary_task: 'CONTINUE_REPAIR',
      available_actions: ['RESOLVE'],
      repair_task_id: repairTaskId,
    })).toMatchObject({ key: 'CONTINUE_REPAIR', href: `/content/tasks/${repairTaskId}` });
  });

  it('服务端主任务缺 token 或 repair_task_id 时 fail fast', () => {
    expect(() => resolveIssuePrimaryAction({
      ...baseIssue,
      available_actions: ['RESOLVE'],
    })).toThrow('需要 CREATE_REPAIR_TASK 与 RESOLVE');
    expect(() => resolveIssuePrimaryAction({
      ...baseIssue,
      workflow_stage: 'REPAIRING',
      primary_task: 'CONTINUE_REPAIR',
      available_actions: ['RESOLVE'],
    })).toThrow('需要 repair_task_id 与唯一 RESOLVE');
  });
});
