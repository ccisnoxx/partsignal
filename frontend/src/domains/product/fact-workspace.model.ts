import { z } from 'zod';

import type { StickyAction } from '@/design-system/workspace/sticky-action-bar';
import type { components } from '@/shared/api/generated/schema';
import { ProductRequestError, mapProductFormError } from './product.api';

type FactWorkspace = components['schemas']['ProductFactsDraft'];
type FactWorkspaceUpdate = components['schemas']['ProductFactsDraftUpdate'];
type FactReviewSubmission = components['schemas']['FactReviewSubmissionRequest'];
type FactWorkspaceAction = FactWorkspace['available_actions'][number];

const factWorkspaceFormSchema = z.object({
  body_markdown: z.string().refine((value) => value.trim().length > 0, '产品事实 Markdown 不能为空'),
  classification: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']),
});

const factReviewSubmissionSchema = z.object({
  change_summary: z.string().refine((value) => value.trim().length > 0, '变更摘要不能为空'),
});

type FactWorkspaceFormValues = z.infer<typeof factWorkspaceFormSchema>;
type FactReviewSubmissionValues = z.infer<typeof factReviewSubmissionSchema>;
type FactWorkspaceField = keyof FactWorkspaceFormValues;

const factWorkspaceFields = new Set<FactWorkspaceField>(['body_markdown', 'classification']);
const factReviewFields = new Set<keyof FactReviewSubmissionValues>(['change_summary']);

function factWorkspaceValues(workspace: FactWorkspace): FactWorkspaceFormValues {
  return {
    body_markdown: workspace.body_markdown,
    classification: workspace.classification,
  };
}

function toFactWorkspaceUpdate(
  values: FactWorkspaceFormValues,
  expectedRevision: number,
): FactWorkspaceUpdate {
  return { ...values, expected_revision: expectedRevision } satisfies FactWorkspaceUpdate;
}

function toFactReviewSubmission(
  values: FactReviewSubmissionValues,
  expectedRevision: number,
): FactReviewSubmission {
  return { ...values, expected_revision: expectedRevision } satisfies FactReviewSubmission;
}

function mapFactWorkspaceError(error: unknown) {
  const mapped = mapProductFormError(error, factWorkspaceFields);
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<FactWorkspaceField, string>>,
    code: error instanceof ProductRequestError ? error.detail?.code : undefined,
  };
}

function mapFactReviewError(error: unknown) {
  const mapped = mapProductFormError(error, factReviewFields);
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<keyof FactReviewSubmissionValues, string>>,
    code: error instanceof ProductRequestError ? error.detail?.code : undefined,
  };
}

function factWorkspaceErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof ProductRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function resolveFactWorkspaceActions(
  workspace: FactWorkspace,
  options: {
    canSave: boolean;
    dirty: boolean;
    saving: boolean;
    submitting: boolean;
    onSave: () => void;
    onSubmit: () => void;
  },
): StickyAction[] {
  return workspace.available_actions.map((action) => resolveFactWorkspaceAction(action, options));
}

function resolveFactWorkspaceAction(
  action: FactWorkspaceAction,
  options: {
    canSave: boolean;
    dirty: boolean;
    saving: boolean;
    submitting: boolean;
    onSave: () => void;
    onSubmit: () => void;
  },
): StickyAction {
  const pending = options.saving || options.submitting;
  switch (action) {
    case 'SAVE': {
      const enabled = options.dirty && options.canSave && !pending;
      return {
        key: action,
        label: options.saving ? '保存中…' : '保存事实',
        intent: 'secondary',
        enabled,
        disabledReason: pending
          ? '事实请求正在处理'
          : !options.dirty
            ? '当前没有未保存修改'
            : '请先填写非空事实 Markdown',
        onSelect: options.onSave,
      };
    }
    case 'SUBMIT_REVIEW': {
      const enabled = !options.dirty && !pending;
      return {
        key: action,
        label: options.submitting ? '提交中…' : '提交事实审核',
        intent: 'primary',
        enabled,
        disabledReason: pending ? '事实请求正在处理' : '请先保存修改',
        onSelect: options.onSubmit,
      };
    }
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`事实工作台收到未处理的合同 token：${String(value)}`);
}

export {
  factReviewSubmissionSchema,
  factWorkspaceErrorKind,
  factWorkspaceFormSchema,
  factWorkspaceValues,
  mapFactReviewError,
  mapFactWorkspaceError,
  resolveFactWorkspaceActions,
  toFactReviewSubmission,
  toFactWorkspaceUpdate,
};
export type {
  FactReviewSubmissionValues,
  FactWorkspace,
  FactWorkspaceField,
  FactWorkspaceFormValues,
};
