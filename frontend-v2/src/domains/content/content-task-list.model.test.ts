import { describe, expect, it } from 'vitest';

import {
  archiveStatusRegistry,
  canonicalContentTasksSearchRecord,
  contentTasksSearchSchema,
  contentTasksSearchToApiParams,
  contentWorkflowStageRegistry,
  formatCurrentContent,
  isCanonicalContentTasksSearch,
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
  type ContentTaskListItem,
} from './content-task-list.model';

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  identifier: 'CT-00000000',
  product_id: '00000000-0000-4000-8000-000000000002',
  fact_version_id: '00000000-0000-4000-8000-000000000003',
  platform_profile_id: '00000000-0000-4000-8000-000000000004',
  query_topic_id: null,
  source_published_content_issue_id: null,
  current_content_version_id: null,
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  available_actions: ['CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
  deletion: null,
  status: 'OPEN',
  revision: 3,
  created_by: '00000000-0000-4000-8000-000000000005',
  created_at: '2026-08-08T00:00:00Z',
  archived_at: null,
  product: {
    id: '00000000-0000-4000-8000-000000000002',
    brand: 'PartSignal',
    part_number: 'PS-001',
  },
  platform: {
    id: '00000000-0000-4000-8000-000000000004',
    name: '工程师社区',
    website_url: null,
    logo: null,
  },
  current_content: null,
  latest_generation_status: null,
  updated_at: '2026-08-09T00:00:00Z',
} satisfies ContentTaskListItem;

describe('Content task list model', () => {
  it('规范化 URL 默认值并显式映射服务端参数', () => {
    const search = contentTasksSearchSchema.parse({
      q: '  PS-001  ',
      workflowStage: 'REVIEW_PENDING',
      archiveStatus: 'ARCHIVED',
      platformId: task.platform_profile_id,
      page: '2',
      pageSize: '50',
      unknown: 'remove-me',
    });

    expect(search).toEqual({
      q: 'PS-001',
      workflowStage: 'REVIEW_PENDING',
      archiveStatus: 'ARCHIVED',
      platformId: task.platform_profile_id,
      page: 2,
      pageSize: 50,
    });
    expect(contentTasksSearchToApiParams(search)).toEqual({
      q: 'PS-001',
      workflow_stage: 'REVIEW_PENDING',
      archive_status: 'ARCHIVED',
      platform_profile_id: task.platform_profile_id,
      page: 2,
      page_size: 50,
    });
    expect(canonicalContentTasksSearchRecord(search)).toEqual({
      q: 'PS-001',
      workflowStage: 'REVIEW_PENDING',
      archiveStatus: 'ARCHIVED',
      platformId: task.platform_profile_id,
      page: 2,
      pageSize: 50,
    });
  });

  it('非法 URL 归一到显式 canonical 默认值', () => {
    const search = contentTasksSearchSchema.parse({
      q: 'x'.repeat(201),
      workflowStage: 'CONTENT_REVIEW',
      archiveStatus: 'UNKNOWN',
      platformId: 'bad-id',
      page: 0,
      pageSize: 99,
    });
    expect(search).toEqual({ archiveStatus: 'ACTIVE', page: 1, pageSize: 20 });
    expect(canonicalContentTasksSearchRecord(search)).toEqual({
      archiveStatus: 'ACTIVE',
      page: 1,
      pageSize: 20,
    });
    expect(isCanonicalContentTasksSearch({}, search)).toBe(false);
    expect(isCanonicalContentTasksSearch({
      archiveStatus: 'ACTIVE',
      page: 1,
      pageSize: 20,
    }, search)).toBe(true);
  });

  it('十个 primary_task 只映射 canonical href', () => {
    const id = task.id;
    const expectations = {
      CREATE_FIRST_DRAFT: ['创建初稿', `/content/tasks/${id}/editor`],
      VIEW_GENERATION_PROGRESS: ['查看生成进度', `/content/tasks/${id}`],
      HANDLE_GENERATION_FAILURE: ['处理生成失败', `/content/tasks/${id}`],
      EDIT_AND_SUBMIT_REVIEW: ['编辑并提交审核', `/content/tasks/${id}/editor`],
      REVIEW_CONTENT: ['审核内容', `/content/tasks/${id}/review`],
      REVISE_CONTENT: ['修订内容', `/content/tasks/${id}/editor`],
      START_PUBLICATION: ['开始发布', '/publishing/work'],
      CONTINUE_PUBLICATION: ['继续发布', `/content/tasks/${id}`],
      VIEW_FULL_LINEAGE: ['查看完整链路', `/content/tasks/${id}`],
      VIEW_CANCELLATION: ['查看取消记录', `/content/tasks/${id}`],
    } as const;
    for (const [primaryTask, [label, href]] of Object.entries(expectations)) {
      expect(resolveContentTaskPrimaryAction({
        ...task,
        primary_task: primaryTask as ContentTaskListItem['primary_task'],
      })).toMatchObject({ key: primaryTask, label, href, enabled: true });
    }
    expect(() => resolveContentTaskPrimaryAction({ ...task, primary_task: 'UNKNOWN' as never }))
      .toThrow('未处理的合同 token');
  });

  it('七个 available_actions 只消费服务端 token 和 deletion projection', () => {
    const resolved = resolveContentTaskOverflowActions({
      ...task,
      available_actions: [
        'CANCEL',
        'DELETE',
        'ARCHIVE',
        'RESTORE',
        'PERMANENT_DELETE',
        'CREATE_GENERATION_JOB',
        'CREATE_MANUAL_VERSION',
      ],
      deletion: { blockers: [] },
    });
    expect(resolved.map((action) => action.key)).toEqual([
      'CANCEL',
      'DELETE',
      'ARCHIVE',
      'RESTORE',
      'PERMANENT_DELETE',
      'CREATE_GENERATION_JOB',
      'CREATE_MANUAL_VERSION',
    ]);
    expect(resolved.find((action) => action.key === 'PERMANENT_DELETE'))
      .toMatchObject({ intent: 'danger', confirmation: 'custom' });
    expect(resolved.find((action) => action.key === 'CREATE_GENERATION_JOB'))
      .toMatchObject({ href: `/content/tasks/${task.id}/editor` });
    expect(() => resolveContentTaskOverflowActions({
      ...task,
      available_actions: ['DELETE'],
      deletion: null,
    })).toThrow('矛盾的 DELETE projection');
    expect(() => resolveContentTaskOverflowActions({
      ...task,
      available_actions: ['UNKNOWN' as never],
    })).toThrow('未处理的合同 token');
  });

  it('状态 registry 和当前内容摘要不读取 raw status', () => {
    expect(Object.keys(contentWorkflowStageRegistry)).toHaveLength(10);
    expect(Object.keys(archiveStatusRegistry)).toEqual(['ACTIVE', 'ARCHIVED', 'ALL']);
    expect(contentWorkflowStageRegistry.REVIEW_PENDING.label).toBe('待内容审核');
    expect(formatCurrentContent(null)).toBe('暂无');
    expect(formatCurrentContent({
      id: '00000000-0000-4000-8000-000000000006',
      version: 7,
      source_type: 'HUMAN',
    })).toBe('v7 · HUMAN');
  });
});
