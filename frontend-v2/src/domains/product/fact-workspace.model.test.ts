import { describe, expect, it, vi } from 'vitest';

import {
  factWorkspaceFormSchema,
  resolveFactWorkspaceActions,
  toFactReviewSubmission,
  toFactWorkspaceUpdate,
  type FactWorkspace,
} from './fact-workspace.model';

const workspace = {
  product_id: '00000000-0000-4000-8000-000000000001',
  product: {
    id: '00000000-0000-4000-8000-000000000001',
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACTS_EDITING',
  },
  body_markdown: '## 事实',
  classification: 'INTERNAL',
  approved_fact: null,
  pending_fact: null,
  available_actions: ['SAVE', 'SUBMIT_REVIEW'],
  revision: 7,
} satisfies FactWorkspace;

describe('Fact Workspace model', () => {
  it('只接受非空 Markdown，并把当前 revision 放入写请求', () => {
    expect(factWorkspaceFormSchema.safeParse({ body_markdown: '   ', classification: 'PUBLIC' }).success).toBe(false);
    expect(toFactWorkspaceUpdate({ body_markdown: '## 新事实', classification: 'RESTRICTED' }, 7)).toEqual({
      expected_revision: 7,
      body_markdown: '## 新事实',
      classification: 'RESTRICTED',
    });
    expect(toFactReviewSubmission({ change_summary: '补充数据来源' }, 7)).toEqual({
      expected_revision: 7,
      change_summary: '补充数据来源',
    });
  });

  it('动作只随服务端 token 变化，本地状态只决定可执行性', () => {
    const onSave = vi.fn();
    const onSubmit = vi.fn();
    const actions = resolveFactWorkspaceActions(workspace, {
      canSave: true,
      dirty: false,
      saving: false,
      submitting: false,
      onSave,
      onSubmit,
    });
    expect(actions.map((action) => [action.key, action.enabled])).toEqual([
      ['SAVE', false],
      ['SUBMIT_REVIEW', true],
    ]);

    expect(resolveFactWorkspaceActions({ ...workspace, available_actions: ['SAVE'] }, {
      canSave: true,
      dirty: true,
      saving: false,
      submitting: false,
      onSave,
      onSubmit,
    }).map((action) => action.key)).toEqual(['SAVE']);
    expect(resolveFactWorkspaceActions({ ...workspace, available_actions: [] }, {
      canSave: true,
      dirty: true,
      saving: false,
      submitting: false,
      onSave,
      onSubmit,
    })).toEqual([]);
  });

  it('generated union 之外的 token 显式失败', () => {
    expect(() => resolveFactWorkspaceActions({
      ...workspace,
      available_actions: ['UNKNOWN' as never],
    }, {
      canSave: true,
      dirty: true,
      saving: false,
      submitting: false,
      onSave: vi.fn(),
      onSubmit: vi.fn(),
    })).toThrow('事实工作台收到未处理的合同 token');
  });
});
