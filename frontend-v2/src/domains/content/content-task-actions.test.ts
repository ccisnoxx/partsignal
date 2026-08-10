import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
} from './content-task-actions';

type Task = components['schemas']['ContentTaskDetailTask'];

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  identifier: 'CT-00000000',
  status: 'OPEN',
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  available_actions: [],
  deletion: null,
  revision: 3,
  created_by: '00000000-0000-4000-8000-000000000099',
  created_at: '2026-08-10T00:00:00Z',
  archived_at: null,
} satisfies Task;

describe('content task action registry', () => {
  it('十个服务端 primary_task 在 Detail 映射到 canonical route 或 section', () => {
    const id = task.id;
    const workId = '00000000-0000-4000-8000-000000000051';
    const expected = {
      CREATE_FIRST_DRAFT: `/content/tasks/${id}/editor`,
      VIEW_GENERATION_PROGRESS: '#generation',
      HANDLE_GENERATION_FAILURE: '#generation',
      EDIT_AND_SUBMIT_REVIEW: `/content/tasks/${id}/editor`,
      REVIEW_CONTENT: `/content/tasks/${id}/review`,
      REVISE_CONTENT: `/content/tasks/${id}/editor`,
      START_PUBLICATION: '/publishing/work',
      CONTINUE_PUBLICATION: `/publishing/work/${workId}`,
      VIEW_FULL_LINEAGE: '#activity',
      VIEW_CANCELLATION: '#summary',
    } satisfies Record<Task['primary_task'], string>;

    for (const [primaryTask, href] of Object.entries(expected)) {
      expect(resolveContentTaskPrimaryAction(
        { ...task, primary_task: primaryTask as Task['primary_task'] },
        { surface: 'detail', publicationWorkId: workId },
      )).toMatchObject({ key: primaryTask, href, enabled: true });
    }
  });

  it('CONTINUE_PUBLICATION 缺少服务端 work identity 时显式失败', () => {
    expect(() => resolveContentTaskPrimaryAction(
      { ...task, primary_task: 'CONTINUE_PUBLICATION' },
      { surface: 'detail' },
    )).toThrow('缺少当前发布工作');
  });

  it('overflow 穷尽七个 token，并在真实 blocker 存在时提供条件入口', () => {
    const all = resolveContentTaskOverflowActions({
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
    expect(all.map((action) => action.key)).toEqual([
      'CANCEL',
      'DELETE',
      'ARCHIVE',
      'RESTORE',
      'PERMANENT_DELETE',
      'CREATE_GENERATION_JOB',
      'CREATE_MANUAL_VERSION',
    ]);

    const blocked = resolveContentTaskOverflowActions({
      ...task,
      available_actions: ['CANCEL'],
      deletion: { blockers: [{ type: 'GENERATION_JOB', count: 2 }] },
    });
    expect(blocked.at(-1)).toMatchObject({
      key: 'VIEW_DELETE_CONDITIONS',
      command: 'view-delete-conditions',
    });
  });
});
