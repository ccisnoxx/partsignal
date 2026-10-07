import { describe, expect, it, vi } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  replaceCanonicalContentVersion,
  requestChangesSchema,
  resolveContentReviewActions,
  toRequestChangesCommand,
  type ContentReviewContext,
  type ContentVersion,
} from './content-review.model';

type FactVersion = components['schemas']['FactVersion'];

const content = {
  id: '00000000-0000-4000-8000-000000000002',
  task_id: '00000000-0000-4000-8000-000000000001',
  fact_version_id: '00000000-0000-4000-8000-000000000003',
  source_job_id: null,
  based_on_id: null,
  version: 2,
  source_type: 'AI',
  title: '审核内容',
  summary: '摘要',
  body_markdown: '# Canonical',
  tags: ['review'],
  content_hash: 'hash',
  status: 'PENDING_REVIEW',
  workflow_stage: 'CURRENT_REVIEW_PENDING',
  primary_task: 'REVIEW_CONTENT',
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  revision: 0,
  quality_issues: [],
  created_by: '00000000-0000-4000-8000-000000000099',
  created_at: '2026-08-09T01:00:00Z',
} satisfies ContentVersion;

const factVersion = {
  id: content.fact_version_id,
  product_id: '00000000-0000-4000-8000-000000000004',
  version: 1,
  status: 'APPROVED',
  body_markdown: '# 事实',
  classification: 'INTERNAL',
  change_summary: '批准事实',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: ['RETIRE'],
  deletion: null,
  revision: 1,
  created_by: content.created_by,
  approved_by: content.created_by,
  created_at: content.created_at,
  approved_at: content.created_at,
} satisfies FactVersion;

const context = {
  content,
  task: {
    id: content.task_id,
    product_id: factVersion.product_id,
    fact_version_id: factVersion.id,
    platform_profile_id: '00000000-0000-4000-8000-000000000005',
    query_topic_id: null,
    source_published_content_issue_id: null,
    current_content_version_id: content.id,
    workflow_stage: 'REVIEW_PENDING',
    primary_task: 'REVIEW_CONTENT',
    available_actions: [],
    deletion: null,
    status: 'OPEN',
    revision: 2,
    created_by: content.created_by,
    created_at: content.created_at,
    archived_at: null,
  },
  fact_version: factVersion,
  diff: null,
  generation_trace: null,
  humanization_traces: [],
  available_actions: ['SUBMIT_REVIEW', 'APPROVE', 'REQUEST_CHANGES'],
  review_history: [],
} satisfies ContentReviewContext;

describe('content review model', () => {
  it('只把服务端返回的批准与退回 token 映射为页面动作', () => {
    const actions = resolveContentReviewActions(context, {
      pending: false,
      stale: false,
      onApprove: vi.fn(),
      onRequestChanges: vi.fn(),
    });

    expect(actions.map((action) => action.key)).toEqual(['APPROVE', 'REQUEST_CHANGES']);
    expect(actions[0]).toMatchObject({ label: '批准内容', enabled: true, intent: 'primary' });
    expect(actions[1]).toMatchObject({ label: '退回修改', enabled: true, intent: 'secondary' });
    expect(resolveContentReviewActions({ ...context, available_actions: [] }, {
      pending: false,
      stale: false,
      onApprove: vi.fn(),
      onRequestChanges: vi.fn(),
    })).toEqual([]);
  });

  it('拒绝空白意见并只发送修剪后的合法值', () => {
    expect(requestChangesSchema.safeParse({ comment: '   ' }).success).toBe(false);
    expect(toRequestChangesCommand({ comment: '  请补充平台限制  ' }, 4)).toEqual({
      expected_revision: 4,
      comment: '请补充平台限制',
    });
  });

  it('canonical response 只替换当前目标版本', () => {
    const canonical = { ...content, status: 'APPROVED', revision: 1 } satisfies ContentVersion;
    expect(replaceCanonicalContentVersion(context, canonical).content).toEqual(canonical);
    expect(replaceCanonicalContentVersion(context, {
      ...canonical,
      id: '00000000-0000-4000-8000-000000000006',
    })).toBe(context);
  });
});
