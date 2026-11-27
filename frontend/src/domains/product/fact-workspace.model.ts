import { z } from 'zod';

import type { StickyAction } from '@/design-system/workspace/sticky-action-bar';
import type { components } from '@/shared/api/generated/schema';
import { ProductRequestError, mapProductFormError } from './product.api';

type FactWorkspace = components['schemas']['ProductFactsDraft'];
type FactWorkspaceUpdate = components['schemas']['ProductFactsDraftUpdate'];
type FactConfirmReview = components['schemas']['ProductFactsConfirmReviewRequest'];
type FactReviewSubmission = components['schemas']['FactReviewSubmissionRequest'];
type FactWorkspaceAction = FactWorkspace['available_actions'][number];

function optionalDateTimeInputSchema(label: string) {
  return z.string().refine((value) => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return Number.isFinite(new Date(trimmed).getTime());
  }, `${label}格式无效`);
}

const factWorkspaceFormSchema = z.object({
  body_markdown: z.string().refine((value) => value.trim().length > 0, '产品事实 Markdown 不能为空'),
  classification: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']),
  source_owner: z.string().trim().max(160, '外部事实负责人不能超过 160 个字符'),
  source_reference: z.string().trim().max(500, '外部资料编号不能超过 500 个字符'),
  verified_at: optionalDateTimeInputSchema('最近业务确认时间'),
  next_review_at: optionalDateTimeInputSchema('下次复核时间'),
  applicable_region: z.string().trim().max(160, '适用市场或地区不能超过 160 个字符'),
  content_restrictions: z.string().trim().max(4000, '禁止公开表达不能超过 4000 个字符'),
  approved_claims_summary: z.string().trim().max(4000, '允许公开的核心结论摘要不能超过 4000 个字符'),
});

const factReviewSubmissionSchema = z.object({
  change_summary: z.string().refine((value) => value.trim().length > 0, '变更摘要不能为空'),
});

const factConfirmReviewSchema = z.object({
  next_review_at: z.string().refine((value) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return Number.isFinite(new Date(trimmed).getTime());
  }, '请填写有效的下次复核时间'),
});

type FactWorkspaceFormValues = z.infer<typeof factWorkspaceFormSchema>;
type FactReviewSubmissionValues = z.infer<typeof factReviewSubmissionSchema>;
type FactConfirmReviewValues = z.infer<typeof factConfirmReviewSchema>;
type FactWorkspaceField = keyof FactWorkspaceFormValues;

const factWorkspaceFields = new Set<FactWorkspaceField>([
  'body_markdown',
  'classification',
  'source_owner',
  'source_reference',
  'verified_at',
  'next_review_at',
  'applicable_region',
  'content_restrictions',
  'approved_claims_summary',
]);
const factReviewFields = new Set<keyof FactReviewSubmissionValues>(['change_summary']);
const factConfirmReviewFields = new Set<keyof FactConfirmReviewValues>(['next_review_at']);

function toDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function factWorkspaceValues(workspace: FactWorkspace): FactWorkspaceFormValues {
  return {
    body_markdown: workspace.body_markdown,
    classification: workspace.classification,
    source_owner: workspace.source_owner ?? '',
    source_reference: workspace.source_reference ?? '',
    verified_at: toDateTimeLocalInput(workspace.verified_at),
    next_review_at: toDateTimeLocalInput(workspace.next_review_at),
    applicable_region: workspace.applicable_region ?? '',
    content_restrictions: workspace.content_restrictions ?? '',
    approved_claims_summary: workspace.approved_claims_summary ?? '',
  };
}

function toFactWorkspaceUpdate(
  values: FactWorkspaceFormValues,
  expectedRevision: number,
  baseline?: Pick<FactWorkspace, 'verified_at' | 'next_review_at'>,
): FactWorkspaceUpdate {
  const verifiedAt = baseline && values.verified_at === toDateTimeLocalInput(baseline.verified_at)
    ? baseline.verified_at
    : fromDateTimeLocalInput(values.verified_at);
  const nextReviewAt = baseline && values.next_review_at === toDateTimeLocalInput(baseline.next_review_at)
    ? baseline.next_review_at
    : fromDateTimeLocalInput(values.next_review_at);
  return {
    expected_revision: expectedRevision,
    body_markdown: values.body_markdown,
    classification: values.classification,
    source_owner: normalizeOptionalText(values.source_owner),
    source_reference: normalizeOptionalText(values.source_reference),
    verified_at: verifiedAt,
    next_review_at: nextReviewAt,
    applicable_region: normalizeOptionalText(values.applicable_region),
    content_restrictions: normalizeOptionalText(values.content_restrictions),
    approved_claims_summary: normalizeOptionalText(values.approved_claims_summary),
  } satisfies FactWorkspaceUpdate;
}

function toFactReviewSubmission(
  values: FactReviewSubmissionValues,
  expectedRevision: number,
): FactReviewSubmission {
  return { ...values, expected_revision: expectedRevision } satisfies FactReviewSubmission;
}

function toFactConfirmReview(
  values: FactConfirmReviewValues,
  expectedRevision: number,
): FactConfirmReview {
  const nextReviewAt = fromDateTimeLocalInput(values.next_review_at);
  if (!nextReviewAt) {
    throw new Error('请填写有效的下次复核时间');
  }
  return {
    expected_revision: expectedRevision,
    next_review_at: nextReviewAt,
  } satisfies FactConfirmReview;
}

function mapFactWorkspaceError(error: unknown) {
  const detail = error instanceof ProductRequestError ? error.detail : undefined;
  const code = typeof detail?.code === 'string' ? detail.code : undefined;
  const requestId = typeof detail?.request_id === 'string' && detail.request_id.trim().length > 0
    ? detail.request_id
    : undefined;
  const message = typeof detail?.message === 'string'
    ? detail.message
    : error instanceof Error
      ? error.message
      : '保存事实工作区失败';
  const details = detail?.details;
  const hasSafeDetails = Boolean(
    details
    && typeof details === 'object'
    && !Array.isArray(details),
  );
  const isServerFailure = error instanceof ProductRequestError
    && typeof error.status === 'number'
    && error.status >= 500;
  const mapped = hasSafeDetails
    ? mapProductFormError(error, factWorkspaceFields)
    : { fields: {}, formMessage: message };
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<FactWorkspaceField, string>>,
    formMessage: mapped.formMessage,
    requestId,
    code,
    recovery: !isServerFailure && hasSafeDetails && requestId
      ? code === 'REVISION_CONFLICT' || code === 'INVALID_STATE_TRANSITION'
        ? code
        : undefined
      : undefined,
  };
}

function mapFactReviewError(error: unknown) {
  const detail = error instanceof ProductRequestError ? error.detail : undefined;
  const code = typeof detail?.code === 'string' ? detail.code : undefined;
  const requestId = typeof detail?.request_id === 'string' && detail.request_id.trim().length > 0
    ? detail.request_id
    : undefined;
  const message = typeof detail?.message === 'string'
    ? detail.message
    : error instanceof Error
      ? error.message
      : '提交事实审核失败';
  const genericServerMessage = '提交事实审核失败，请稍后重试。';
  const isServerFailure = error instanceof ProductRequestError
    && typeof error.status === 'number'
    && error.status >= 500;
  const details = detail?.details;
  const hasSafeDetails = Boolean(
    details
    && typeof details === 'object'
    && !Array.isArray(details),
  );
  const mapped = hasSafeDetails
    ? mapProductFormError(error, factReviewFields)
    : { fields: {}, formMessage: message };
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<keyof FactReviewSubmissionValues, string>>,
    formMessage: isServerFailure
      ? genericServerMessage
      : mapped.formMessage,
    requestId,
    code,
    recovery: !isServerFailure && hasSafeDetails && requestId
      ? code === 'FACT_REVIEW_PENDING' || code === 'REVISION_CONFLICT' || code === 'INVALID_STATE_TRANSITION'
        ? code
        : undefined
      : undefined,
  };
}

function mapFactConfirmReviewError(error: unknown) {
  const detail = error instanceof ProductRequestError ? error.detail : undefined;
  const code = typeof detail?.code === 'string' ? detail.code : undefined;
  const requestId = typeof detail?.request_id === 'string' && detail.request_id.trim().length > 0
    ? detail.request_id
    : undefined;
  const message = typeof detail?.message === 'string'
    ? detail.message
    : error instanceof Error
      ? error.message
      : '确认事实复核失败';
  const isServerFailure = error instanceof ProductRequestError
    && typeof error.status === 'number'
    && error.status >= 500;
  const details = detail?.details;
  const hasSafeDetails = Boolean(
    details
    && typeof details === 'object'
    && !Array.isArray(details),
  );
  const mapped = hasSafeDetails
    ? mapProductFormError(error, factConfirmReviewFields)
    : { fields: {}, formMessage: message };
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<keyof FactConfirmReviewValues, string>>,
    formMessage: isServerFailure ? '确认事实复核失败，请稍后重试。' : mapped.formMessage,
    requestId,
    code,
    recovery: !isServerFailure && hasSafeDetails && requestId
      ? code === 'REVISION_CONFLICT' || code === 'FACT_REVIEW_PENDING' || code === 'INVALID_STATE_TRANSITION'
        ? code
        : undefined
      : undefined,
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
    confirmingReview?: boolean;
    blocked?: boolean;
    onSave: () => void;
    onSubmit: () => void;
    onConfirmReview?: () => void;
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
    confirmingReview?: boolean;
    blocked?: boolean;
    onSave: () => void;
    onSubmit: () => void;
    onConfirmReview?: () => void;
  },
): StickyAction {
  const pending = options.saving || options.submitting || Boolean(options.confirmingReview);
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
      const enabled = !options.dirty && !pending && !options.blocked;
      return {
        key: action,
        label: options.submitting ? '提交中…' : '提交事实审核',
        intent: 'primary',
        enabled,
        disabledReason: options.blocked
          ? '该产品已有待审核事实版本'
          : pending
            ? '事实请求正在处理'
            : '请先保存修改',
        onSelect: options.onSubmit,
      };
    }
    case 'CONFIRM_REVIEW': {
      const enabled = !options.dirty && !pending && !options.blocked && Boolean(options.onConfirmReview);
      return {
        key: action,
        label: options.confirmingReview ? '确认中…' : '确认无变更并延期复核',
        intent: 'secondary',
        enabled,
        disabledReason: options.blocked
          ? '该产品已有待审核事实版本'
          : pending
            ? '事实请求正在处理'
            : '请先保存修改后再确认复核延期',
        onSelect: () => options.onConfirmReview?.(),
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
  factConfirmReviewSchema,
  factReviewSubmissionSchema,
  factWorkspaceErrorKind,
  factWorkspaceFormSchema,
  factWorkspaceValues,
  fromDateTimeLocalInput,
  mapFactConfirmReviewError,
  mapFactReviewError,
  mapFactWorkspaceError,
  resolveFactWorkspaceActions,
  toDateTimeLocalInput,
  toFactConfirmReview,
  toFactReviewSubmission,
  toFactWorkspaceUpdate,
};
export type {
  FactConfirmReviewValues,
  FactReviewSubmissionValues,
  FactWorkspace,
  FactWorkspaceField,
  FactWorkspaceFormValues,
};
