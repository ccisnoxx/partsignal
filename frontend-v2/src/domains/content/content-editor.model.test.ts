import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  editorActionKeys,
  editorFormValues,
  editorMode,
  parseTags,
  toContentCommand,
  toContentDraftUpdate,
  toContentRevisionCreate,
  type ContentEditorContext,
} from './content-editor.model';

type ContentVersion = components['schemas']['ContentVersion'];

const ids = {
  task: '10000000-0000-4000-8000-000000000001',
  product: '10000000-0000-4000-8000-000000000002',
  fact: '10000000-0000-4000-8000-000000000003',
  version: '10000000-0000-4000-8000-000000000004',
  user: '10000000-0000-4000-8000-000000000005',
} as const;

function version(
  overrides: Partial<ContentVersion> = {},
): ContentVersion {
  return {
    id: ids.version,
    task_id: ids.task,
    fact_version_id: ids.fact,
    source_job_id: null,
    based_on_id: null,
    version: 1,
    source_type: 'HUMAN',
    title: '当前标题',
    summary: '当前摘要',
    body_markdown: '# 当前正文',
    tags: ['工业,控制', '测试'],
    content_hash: 'a'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['SUBMIT_REVIEW', 'SAVE', 'DELETE'],
    revision: 2,
    quality_issues: [],
    created_by: ids.user,
    created_at: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

function context(
  current: ContentVersion | null,
  overrides: Partial<ContentEditorContext> = {},
): ContentEditorContext {
  return {
    task: {
      id: ids.task,
      identifier: 'CT-1234ABCD',
      status: 'OPEN',
      workflow_stage: current ? 'DRAFT' : 'NO_DRAFT',
      primary_task: current ? 'EDIT_AND_SUBMIT_REVIEW' : 'CREATE_FIRST_DRAFT',
      available_actions: current ? ['CANCEL'] : ['CREATE_MANUAL_VERSION', 'CANCEL'],
      deletion: { blockers: [] },
      revision: 0,
      created_by: ids.user,
      created_at: '2026-08-10T00:00:00Z',
      archived_at: null,
    },
    product: {
      id: ids.product,
      brand: 'PartSignal',
      part_number: 'PS-1',
      category: 'MCU',
      status: 'ACTIVE',
    },
    platform: { id: null, name: '测试平台', website_url: null, logo: null },
    locked_fact_version: {
      id: ids.fact,
      version: 1,
      status: 'APPROVED',
      classification: 'PUBLIC',
      body_markdown: '# 锁定事实',
    },
    current_content: current,
    comparison_content: null,
    diff: null,
    latest_generation: null,
    current_lineage: null,
    source: null,
    ...overrides,
  };
}

describe('Content Editor domain model', () => {
  it('只按服务端 pointer 对应内容和 action token 选择编辑模式', () => {
    expect(editorMode(context(null))).toBe('manual');
    expect(editorMode(context(version()))).toBe('edit');
    expect(editorMode(context(version({
      source_type: 'AI',
      available_actions: ['CREATE_REVISION', 'SUBMIT_REVIEW', 'ABANDON'],
    })))).toBe('readonly');
    expect(editorMode(context(version({
      status: 'CHANGES_REQUESTED',
      workflow_stage: 'CURRENT_CHANGES_REQUESTED',
      primary_task: 'CREATE_REVISION',
      available_actions: ['CREATE_REVISION', 'ABANDON'],
    }), {
      task: {
        ...context(version()).task,
        workflow_stage: 'CHANGES_REQUESTED',
        primary_task: 'REVISE_CONTENT',
      },
    }))).toBe('revision');
  });

  it('人工创建和保存使用不同 payload，逗号保留在合法标签内', () => {
    const values = {
      ...editorFormValues(version()),
      tags_text: ' 工业,控制 \n\n 测试 ',
      change_summary: '创建修订',
    };

    expect(parseTags(values.tags_text)).toEqual(['工业,控制', '测试']);
    expect(toContentRevisionCreate(values)).toEqual({
      title: '当前标题',
      summary: '当前摘要',
      body_markdown: '# 当前正文',
      tags: ['工业,控制', '测试'],
      change_summary: '创建修订',
    });
    expect(toContentDraftUpdate(values, 7)).toEqual({
      expected_revision: 7,
      title: '当前标题',
      summary: '当前摘要',
      body_markdown: '# 当前正文',
      tags: ['工业,控制', '测试'],
    });
    expect(toContentCommand(7)).toEqual({ expected_revision: 7, comment: '' });
  });

  it('Editor surface 排除 Review、Publication 和后续 AI 动作', () => {
    const current = version({
      available_actions: [
        'SAVE',
        'CREATE_REVISION',
        'CREATE_HUMANIZATION_JOB',
        'SUBMIT_REVIEW',
        'APPROVE',
        'REQUEST_CHANGES',
        'ABANDON',
      ],
    });
    expect(editorActionKeys(context(current), 'readonly')).toEqual([
      'SAVE',
      'CREATE_REVISION',
      'SUBMIT_REVIEW',
      'ABANDON',
    ]);
  });
});
