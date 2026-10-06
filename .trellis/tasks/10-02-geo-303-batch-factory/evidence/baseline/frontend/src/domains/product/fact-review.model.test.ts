import { describe, expect, it, vi } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  replaceCanonicalFactVersion,
  requestChangesSchema,
  resolveFactReviewActions,
  toRequestChangesCommand,
  type FactReviewWorkspace,
} from './fact-review.model';

type FactReviewTarget = components['schemas']['ProductFactReviewTarget'];
type FactVersion = components['schemas']['FactVersion'];

const version = {
  id: '00000000-0000-4000-8000-000000000002',
  product_id: '00000000-0000-4000-8000-000000000001',
  version: 2,
  status: 'PENDING_REVIEW',
  body_markdown: '# 事实',
  classification: 'PUBLIC',
  change_summary: '修订事实',
  primary_task: 'REVIEW_FACT',
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  deletion: null,
  revision: 0,
  created_by: '00000000-0000-4000-8000-000000000099',
  approved_by: null,
  created_at: '2026-08-09T01:00:00Z',
  approved_at: null,
} satisfies FactVersion;

const target = {
  fact_version: version,
  diff: null,
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  review_history: [],
} satisfies FactReviewTarget;

const workspace = {
  product: {
    id: version.product_id,
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_REVIEW_PENDING',
  },
  review: target,
} satisfies FactReviewWorkspace;

describe('fact review model', () => {
  it('只把服务端返回的审核决策映射为动作', () => {
    const approve = vi.fn();
    const requestChanges = vi.fn();

    const actions = resolveFactReviewActions(target, {
      pending: false,
      stale: false,
      onApprove: approve,
      onRequestChanges: requestChanges,
    });

    expect(actions.map((action) => action.key)).toEqual(['APPROVE', 'REQUEST_CHANGES']);
    expect(actions[0]).toMatchObject({ label: '批准事实', enabled: true, intent: 'primary' });
    expect(actions[1]).toMatchObject({ label: '退回修改', enabled: true, intent: 'secondary' });
    expect(resolveFactReviewActions({ ...target, available_actions: [] }, {
      pending: false,
      stale: false,
      onApprove: approve,
      onRequestChanges: requestChanges,
    })).toEqual([]);
  });

  it('拒绝空白退回意见并只发送修剪后的合法值', () => {
    expect(requestChangesSchema.safeParse({ comment: '   ' }).success).toBe(false);
    expect(toRequestChangesCommand({ comment: '  请补充参数  ' }, 3)).toEqual({
      expected_revision: 3,
      comment: '请补充参数',
    });
  });

  it('canonical response 只替换当前目标版本', () => {
    const canonical = { ...version, status: 'APPROVED', revision: 1 } satisfies FactVersion;
    expect(replaceCanonicalFactVersion(workspace, canonical).review?.fact_version).toEqual(canonical);
    expect(replaceCanonicalFactVersion(workspace, {
      ...canonical,
      id: '00000000-0000-4000-8000-000000000003',
    })).toBe(workspace);
  });
});
