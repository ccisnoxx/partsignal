import { describe, expect, it, vi } from 'vitest';

import {
  factWorkspaceFormSchema,
  mapFactReviewError,
  resolveFactWorkspaceActions,
  toFactReviewSubmission,
  toFactWorkspaceUpdate,
  type FactWorkspace,
} from './fact-workspace.model';
import { ProductRequestError } from './product.api';

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
  function requestError(detail: unknown, status = 409) {
    return new ProductRequestError('提交事实审核失败（HTTP 409）', status, detail as never);
  }

  it('只有完整的 exact pending envelope 才产生 pending recovery decision', () => {
    const mapped = mapFactReviewError(requestError({
      code: 'FACT_REVIEW_PENDING',
      message: '服务端已有待审核事实',
      details: {},
      request_id: 'req-pending',
    }));
    expect(mapped).toMatchObject({
      code: 'FACT_REVIEW_PENDING',
      requestId: 'req-pending',
      recovery: 'FACT_REVIEW_PENDING',
    });

    expect(mapFactReviewError(requestError({
      code: 'FACT_REVIEW_PENDING',
      message: '该产品已有待审核事实版本',
      details: null,
      request_id: 'req-malformed',
    })).recovery).toBeUndefined();
    expect(mapFactReviewError(requestError({
      code: 'FACT_REVIEW_PENDING',
      message: '该产品已有待审核事实版本',
      details: {},
      request_id: '   ',
    })).recovery).toBeUndefined();
    expect(mapFactReviewError(requestError({
      code: 'OTHER_CONFLICT',
      message: '该产品已有待审核事实版本',
      details: {},
      request_id: 'req-other',
    })).recovery).toBeUndefined();
  });

  it('保持 revision 与既有状态转换的独立 recovery，unknown 500 走安全 fallback', () => {
    expect(mapFactReviewError(requestError({
      code: 'REVISION_CONFLICT', message: 'revision 已过期', details: {}, request_id: 'req-revision',
    })).recovery).toBe('REVISION_CONFLICT');
    expect(mapFactReviewError(requestError({
      code: 'INVALID_STATE_TRANSITION', message: '产品已停用', details: {}, request_id: 'req-state',
    })).recovery).toBe('INVALID_STATE_TRANSITION');
    const malformed = mapFactReviewError(requestError({
      code: 'FACT_REVIEW_PENDING', message: '该产品已有待审核事实版本', request_id: 'req-no-details',
    }));
    expect(malformed).toMatchObject({
      formMessage: '该产品已有待审核事实版本',
      requestId: 'req-no-details',
    });
    expect(malformed.recovery).toBeUndefined();

    const missingRequestId = mapFactReviewError(requestError({
      code: 'FACT_REVIEW_PENDING',
      message: '该产品已有待审核事实版本',
      details: {},
    }));
    expect(missingRequestId).toMatchObject({ formMessage: '该产品已有待审核事实版本' });
    expect(missingRequestId.requestId).toBeUndefined();
    expect(missingRequestId.recovery).toBeUndefined();

    const unknown500 = mapFactReviewError(new ProductRequestError('提交事实审核失败（HTTP 500）', 500));
    expect(unknown500).toMatchObject({ formMessage: '提交事实审核失败，请稍后重试。' });
    expect(unknown500.requestId).toBeUndefined();
    expect(unknown500.recovery).toBeUndefined();
  });

  it('合法字段错误保留字段投影且不重复生成 form summary', () => {
    const mapped = mapFactReviewError(requestError({
      code: 'VALIDATION_ERROR',
      message: '变更摘要无效',
      details: { errors: [{ loc: ['body', 'change_summary'], msg: '变更摘要不能为空' }] },
      request_id: 'req-validation',
    }));
    expect(mapped.fields).toEqual({ change_summary: '变更摘要不能为空' });
    expect(mapped.formMessage).toBeUndefined();
    expect(mapped.requestId).toBe('req-validation');
    expect(mapped.recovery).toBeUndefined();
  });

  it.each(['FACT_REVIEW_PENDING', 'REVISION_CONFLICT', 'INVALID_STATE_TRANSITION'])(
    '任何 5xx 都不会为 %s 建立 recovery 或伪造专用状态',
    (code) => {
      const mapped = mapFactReviewError(requestError({
        code,
        message: '服务端返回了不可恢复错误',
        details: {},
        request_id: `req-${code.toLowerCase()}`,
      }, 500));
      expect(mapped.formMessage).toBe('提交事实审核失败，请稍后重试。');
      expect(mapped.requestId).toBe(`req-${code.toLowerCase()}`);
      expect(mapped.recovery).toBeUndefined();
    },
  );

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
