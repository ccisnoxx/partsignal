import { z } from 'zod';

import type { StickyAction } from '@/design-system/workspace/sticky-action-bar';
import type { TimelineItem } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import { ContentRequestError } from './content.api';

type ContentReviewContext = components['schemas']['ContentReviewContext'];
type ContentReviewDecision = 'APPROVE' | 'REQUEST_CHANGES';
type ContentVersion = components['schemas']['ContentVersion'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];

const requestChangesSchema = z.object({
  comment: z.string().refine((value) => value.trim().length > 0, '退回意见不能为空'),
});

type RequestChangesValues = z.infer<typeof requestChangesSchema>;

function contentReviewErrorKind(error: unknown): 'not-found' | 'forbidden' | 'generic' {
  if (!(error instanceof ContentRequestError)) return 'generic';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  return 'generic';
}

function mapContentReviewCommandError(error: unknown) {
  if (!(error instanceof ContentRequestError) || !error.detail) {
    return {
      fields: {} as Partial<Record<keyof RequestChangesValues, string>>,
      formMessage: error instanceof Error ? error.message : '内容审核请求失败',
    };
  }

  let comment: string | undefined;
  const issues = error.detail.details.errors;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') continue;
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      if (
        Array.isArray(loc)
        && loc.length === 2
        && loc[0] === 'body'
        && loc[1] === 'comment'
        && typeof message === 'string'
      ) {
        comment ??= message;
      }
    }
  }
  return {
    fields: comment ? { comment } : {},
    formMessage: comment ? undefined : error.detail.message,
    requestId: error.detail.request_id,
    code: error.detail.code,
  };
}

function toRequestChangesCommand(
  values: RequestChangesValues,
  expectedRevision: number,
): RequestChangesCommand {
  return {
    expected_revision: expectedRevision,
    comment: values.comment.trim(),
  };
}

function resolveContentReviewActions(
  context: ContentReviewContext,
  options: {
    pending: boolean;
    stale: boolean;
    onApprove: () => void;
    onRequestChanges: () => void;
  },
): StickyAction[] {
  return context.available_actions
    .filter((action): action is ContentReviewDecision => (
      action === 'APPROVE' || action === 'REQUEST_CHANGES'
    ))
    .map((action) => resolveContentReviewAction(action, context, options));
}

function resolveContentReviewAction(
  action: ContentReviewDecision,
  context: ContentReviewContext,
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
  if (action === 'APPROVE') {
    return {
      key: action,
      label: options.pending ? '处理中…' : '批准内容',
      intent: 'primary',
      enabled,
      disabledReason,
      confirmation: {
        title: `批准内容版本 v${context.content.version}？`,
        description: '批准后该不可变内容版本可进入发布流程。服务端会再次校验权限、状态与 revision。',
        confirmLabel: '确认批准',
        intent: 'default',
      },
      onSelect: options.onApprove,
    };
  }
  return {
    key: action,
    label: '退回修改',
    intent: 'secondary',
    enabled,
    disabledReason,
    onSelect: options.onRequestChanges,
  };
}

function contentReviewTimelineItems(context: ContentReviewContext): TimelineItem[] {
  return context.review_history.map((record) => ({
    id: record.id,
    title: reviewActionLabel(record.action),
    description: record.comment || undefined,
    meta: `${record.actor.display_name} · ${formatDateTime(record.created_at)}`,
  }));
}

function replaceCanonicalContentVersion(
  context: ContentReviewContext,
  canonical: ContentVersion,
): ContentReviewContext {
  return context.content.id === canonical.id ? { ...context, content: canonical } : context;
}

function reviewActionLabel(action: string) {
  switch (action) {
    case 'submit-review': return '提交审核';
    case 'approve': return '批准内容';
    case 'request-changes': return '退回修改';
    default: return `审核记录 · ${action}`;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export {
  contentReviewErrorKind,
  contentReviewTimelineItems,
  mapContentReviewCommandError,
  replaceCanonicalContentVersion,
  requestChangesSchema,
  resolveContentReviewActions,
  toRequestChangesCommand,
};
export type { ContentReviewContext, ContentVersion, RequestChangesValues };
