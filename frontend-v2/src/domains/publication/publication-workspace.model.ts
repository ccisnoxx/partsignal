import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';

type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublicationAvailableAction = PublicationWork['available_actions'][number];
type PublicationVerificationCreate = components['schemas']['PublicationVerificationCreate'];
type PublicationCoreAction = Extract<
  PublicationAvailableAction,
  'UPDATE_PREPARATION' | 'MARK_PLATFORM_REVIEW' | 'REGISTER_RESULT' | 'CLOSE'
>;
type PublicationVerificationAction = Extract<
  PublicationAvailableAction,
  'VERIFY' | 'SWITCH_CONTENT_VERSION'
>;
type PublicationWorkspaceAction = PublicationCoreAction | PublicationVerificationAction;

const publicationWorkspaceSections = [
  'summary',
  'preparation',
  'result',
  'verification',
  'content-version',
  'close',
] as const;

type PublicationWorkspaceSection = typeof publicationWorkspaceSections[number];

function canonicalPublicationWorkspaceHash(hash: string): PublicationWorkspaceSection {
  const value = hash.replace(/^#/, '');
  return publicationWorkspaceSections.includes(value as PublicationWorkspaceSection)
    ? value as PublicationWorkspaceSection
    : 'summary';
}

function isCanonicalPublicationWorkspaceHash(hash: string) {
  return hash.replace(/^#/, '') === canonicalPublicationWorkspaceHash(hash);
}

const publicationActionPresentation = {
  UPDATE_PREPARATION: { label: '更新准备信息', section: 'preparation' },
  MARK_PLATFORM_REVIEW: { label: '标记平台处理中', section: 'preparation' },
  REGISTER_RESULT: { label: '登记发布结果', section: 'result' },
  VERIFY: { label: '核验发布结果', section: 'verification' },
  SWITCH_CONTENT_VERSION: { label: '切换内容版本', section: 'content-version' },
  CLOSE: { label: '关闭发布工作', section: 'close' },
} satisfies Record<PublicationWorkspaceAction, {
  label: string;
  section: PublicationWorkspaceSection;
}>;

const primaryTaskAction = {
  CONTINUE_PREPARATION: 'UPDATE_PREPARATION',
  REGISTER_RESULT: 'REGISTER_RESULT',
  RUN_FIRST_VERIFICATION: 'VERIFY',
  FIX_AND_REVERIFY: 'VERIFY',
  VIEW_COMPLETION: undefined,
  VIEW_CLOSURE: undefined,
} satisfies Record<PublicationWork['primary_task'], PublicationWorkspaceAction | undefined>;

function publicationCoreActions(work: PublicationWork) {
  const actions = work.available_actions.filter(
    (action): action is PublicationCoreAction => (
      action !== 'VERIFY' && action !== 'SWITCH_CONTENT_VERSION'
    ),
  );
  const primary = primaryTaskAction[work.primary_task];
  return actions.map((action) => ({
    action,
    ...publicationActionPresentation[action],
    intent: action === 'CLOSE'
      ? 'danger' as const
      : action === primary
        ? 'primary' as const
        : 'secondary' as const,
  }));
}

function publicationWorkspaceActions(context: PublicationWorkspaceContext) {
  const primary = primaryTaskAction[context.work.primary_task];
  return context.work.available_actions.flatMap((action) => {
    if (action === 'SWITCH_CONTENT_VERSION' && !context.switch_candidate) return [];
    return [{
      action,
      ...publicationActionPresentation[action],
      intent: action === 'CLOSE'
        ? 'danger' as const
        : action === primary
          ? 'primary' as const
          : 'secondary' as const,
    }];
  });
}

const preparationFormSchema = z.object({
  platformAccountId: z.string().min(1, '请选择发布账号'),
  comment: z.string().trim().max(2000, '备注不能超过 2000 个字符'),
});

const platformReviewFormSchema = z.object({
  comment: z.string().trim().max(2000, '备注不能超过 2000 个字符'),
});

const resultFormSchema = z.object({
  actualTitle: z.string().trim().min(1, '请输入实际发布标题').max(500, '标题不能超过 500 个字符'),
  finalUrl: z.url('请输入有效的最终 URL'),
  publishedAt: z.string().min(1, '请选择发布时间'),
  comment: z.string().trim().max(2000, '备注不能超过 2000 个字符'),
});

const closeFormSchema = z.object({
  reason: z.enum(['PLATFORM_REJECTED', 'BUSINESS_CANCELLED', 'OTHER']),
  comment: z.string().trim().min(1, '请输入关闭说明').max(2000, '说明不能超过 2000 个字符'),
});

const verificationFormSchema = z.object({
  match: z.enum(['MATCH', 'MISMATCH'], { message: '请选择正文是否与批准内容一致' }),
  comment: z.string().trim().max(2000, '备注不能超过 2000 个字符'),
}).superRefine((value, context) => {
  if (value.match === 'MISMATCH' && !value.comment) {
    context.addIssue({ code: 'custom', message: '核验失败必须填写说明', path: ['comment'] });
  }
});

const switchContentVersionFormSchema = z.object({
  comment: z.string().trim().min(1, '请输入换版说明').max(2000, '说明不能超过 2000 个字符'),
});

function publicationVerificationPayload(
  values: z.infer<typeof verificationFormSchema>,
  expectedRevision: number,
): PublicationVerificationCreate {
  const contentMatches = values.match === 'MATCH';
  return {
    outcome: contentMatches ? 'PASSED' : 'FAILED',
    content_matches: contentMatches,
    expected_revision: expectedRevision,
    comment: values.comment,
  };
}

export {
  canonicalPublicationWorkspaceHash,
  closeFormSchema,
  isCanonicalPublicationWorkspaceHash,
  platformReviewFormSchema,
  preparationFormSchema,
  publicationCoreActions,
  publicationVerificationPayload,
  publicationWorkspaceActions,
  publicationWorkspaceSections,
  resultFormSchema,
  switchContentVersionFormSchema,
  verificationFormSchema,
};
export type {
  PublicationCoreAction,
  PublicationVerificationAction,
  PublicationWorkspaceAction,
  PublicationWorkspaceContext,
  PublicationWorkspaceSection,
};
