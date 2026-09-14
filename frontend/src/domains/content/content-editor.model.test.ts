import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import { ContentRequestError } from './content.api';
import {
  editorActionKeys,
  editorFormValues,
  editorMode,
  mapContentEditorError,
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
  it('只按 exact code 投影 review pending blocker，并保留结构化元数据', () => {
    const mapped = mapContentEditorError(new ContentRequestError(
      '任务已有待审核内容版本',
      409,
      {
        code: 'CONTENT_REVIEW_PENDING',
        message: '该任务已有待审核内容版本',
        details: {},
        request_id: 'req-pending',
      },
    ));

    expect(mapped).toMatchObject({
      blockerKind: 'content-review-pending',
      code: 'CONTENT_REVIEW_PENDING',
      formMessage: '该任务已有待审核内容版本',
      requestId: 'req-pending',
    });
    expect(mapContentEditorError(new ContentRequestError(
      '任意文本',
      409,
      {
        code: 'REVISION_CONFLICT',
        message: '任意文本',
        details: {},
        request_id: 'req-revision',
      },
    )).blockerKind).toBe('revision');
  });

  it('malformed details、其他 code 和缺失 request ID 安全回退，不按 message 猜测', () => {
    const malformedDetails = mapContentEditorError(new ContentRequestError(
      '看起来像 pending 的文本',
      409,
      {
        code: 'CONTENT_REVIEW_PENDING',
        message: '看起来像 pending 的文本',
        details: { errors: 'not-an-array' },
        request_id: 'req-malformed',
      },
    ));
    expect(malformedDetails).toMatchObject({
      fields: {},
      formMessage: '看起来像 pending 的文本',
      code: 'CONTENT_REVIEW_PENDING',
      requestId: 'req-malformed',
    });
    expect(malformedDetails.blockerKind).toBeUndefined();

    const malformedIssue = mapContentEditorError(new ContentRequestError(
      '内容审核暂不可用',
      409,
      {
        code: 'CONTENT_REVIEW_PENDING',
        message: '内容审核暂不可用',
        details: { errors: [{ unexpected: true }] },
        request_id: 'req-malformed-issue',
      },
    ));
    expect(malformedIssue.blockerKind).toBeUndefined();

    const malformed = mapContentEditorError(new ContentRequestError(
      '服务端失败',
      500,
      { code: 'SERVER_ERROR', message: '服务端失败', details: null, request_id: undefined } as never,
    ));
    expect(malformed).toMatchObject({ fields: {}, formMessage: '服务端失败', code: 'SERVER_ERROR' });
    expect(malformed.blockerKind).toBeUndefined();
    expect(malformed.requestId).toBeUndefined();

    const missingRequestId = mapContentEditorError(new ContentRequestError(
      '该任务已有待审核内容版本',
      409,
      { code: 'CONTENT_REVIEW_PENDING', message: '该任务已有待审核内容版本', details: {} } as never,
    ));
    expect(missingRequestId).toMatchObject({
      fields: {},
      formMessage: '该任务已有待审核内容版本',
      code: 'CONTENT_REVIEW_PENDING',
    });
    expect(missingRequestId.blockerKind).toBeUndefined();
    expect(missingRequestId.requestId).toBeUndefined();
  });

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
