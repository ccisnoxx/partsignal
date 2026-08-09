import { z } from 'zod';

import type { StickyAction } from '@/design-system/workspace/sticky-action-bar';
import type { TimelineItem } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import { ProductRequestError, mapProductFormError } from './product.api';

type FactReviewWorkspace = components['schemas']['ProductFactReviewWorkspace'];
type FactReviewTarget = components['schemas']['ProductFactReviewTarget'];
type FactReviewDecision = FactReviewTarget['available_actions'][number];
type FactVersion = components['schemas']['FactVersion'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];

const requestChangesSchema = z.object({
  comment: z.string().refine((value) => value.trim().length > 0, '退回意见不能为空'),
});

type RequestChangesValues = z.infer<typeof requestChangesSchema>;

const requestChangesFields = new Set<keyof RequestChangesValues>(['comment']);

function factReviewErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof ProductRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function mapFactReviewCommandError(error: unknown) {
  const mapped = mapProductFormError(error, requestChangesFields);
  return {
    ...mapped,
    fields: mapped.fields as Partial<Record<keyof RequestChangesValues, string>>,
    code: error instanceof ProductRequestError ? error.detail?.code : undefined,
  };
}

function toRequestChangesCommand(
  values: RequestChangesValues,
  expectedRevision: number,
): RequestChangesCommand {
  return {
    expected_revision: expectedRevision,
    comment: values.comment.trim(),
  } satisfies RequestChangesCommand;
}

function resolveFactReviewActions(
  target: FactReviewTarget,
  options: {
    pending: boolean;
    stale: boolean;
    onApprove: () => void;
    onRequestChanges: () => void;
  },
): StickyAction[] {
  return target.available_actions.map((action) => resolveFactReviewAction(action, target, options));
}

function resolveFactReviewAction(
  action: FactReviewDecision,
  target: FactReviewTarget,
  options: {
    pending: boolean;
    stale: boolean;
    onApprove: () => void;
    onRequestChanges: () => void;
  },
): StickyAction {
  const enabled = !options.pending && !options.stale;
  const disabledReason = options.pending
    ? '审核请求正在处理'
    : options.stale
      ? '正在刷新服务端审核上下文'
      : undefined;
  switch (action) {
    case 'APPROVE':
      return {
        key: action,
        label: options.pending ? '处理中…' : '批准事实',
        intent: 'primary',
        enabled,
        disabledReason,
        confirmation: {
          title: `批准事实版本 v${target.fact_version.version}？`,
          description: '批准后该不可变事实版本可用于创建内容任务。服务端会再次校验状态与 revision。',
          confirmLabel: '确认批准',
          intent: 'default',
        },
        onSelect: options.onApprove,
      };
    case 'REQUEST_CHANGES':
      return {
        key: action,
        label: '退回修改',
        intent: 'secondary',
        enabled,
        disabledReason,
        onSelect: options.onRequestChanges,
      };
    default:
      return assertNever(action);
  }
}

function reviewTimelineItems(target: FactReviewTarget): TimelineItem[] {
  return target.review_history.map((record) => ({
    id: record.id,
    title: reviewActionLabel(record.action),
    description: record.comment || undefined,
    meta: `${record.actor.display_name} · ${formatDateTime(record.created_at)}`,
  }));
}

function reviewActionLabel(action: string) {
  switch (action) {
    case 'submit-review': return '提交审核';
    case 'approve': return '批准事实';
    case 'request-changes': return '退回修改';
    case 'retire': return '停用事实';
    default: return `审核记录 · ${action}`;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function replaceCanonicalFactVersion(
  workspace: FactReviewWorkspace,
  canonical: FactVersion,
): FactReviewWorkspace {
  if (!workspace.review || workspace.review.fact_version.id !== canonical.id) return workspace;
  return {
    ...workspace,
    review: { ...workspace.review, fact_version: canonical },
  };
}

function assertNever(value: never): never {
  throw new Error(`事实审核收到未处理的合同 token：${String(value)}`);
}

export {
  factReviewErrorKind,
  mapFactReviewCommandError,
  replaceCanonicalFactVersion,
  requestChangesSchema,
  resolveFactReviewActions,
  reviewTimelineItems,
  toRequestChangesCommand,
};
export type {
  FactReviewTarget,
  FactReviewWorkspace,
  FactVersion,
  RequestChangesValues,
};
