import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';

type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];
type PublicationWork = components['schemas']['PublicationWork'];
type PublicationAvailableAction = PublicationWork['available_actions'][number];
type PublicationCoreAction = Extract<
  PublicationAvailableAction,
  'UPDATE_PREPARATION' | 'MARK_PLATFORM_REVIEW' | 'REGISTER_RESULT' | 'CLOSE'
>;

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

const publicationCoreActionPresentation = {
  UPDATE_PREPARATION: { label: '更新准备信息', section: 'preparation' },
  MARK_PLATFORM_REVIEW: { label: '标记平台处理中', section: 'preparation' },
  REGISTER_RESULT: { label: '登记发布结果', section: 'result' },
  CLOSE: { label: '关闭发布工作', section: 'close' },
} satisfies Record<PublicationCoreAction, {
  label: string;
  section: PublicationWorkspaceSection;
}>;

const primaryTaskAction = {
  CONTINUE_PREPARATION: 'UPDATE_PREPARATION',
  REGISTER_RESULT: 'REGISTER_RESULT',
  RUN_FIRST_VERIFICATION: undefined,
  FIX_AND_REVERIFY: undefined,
  VIEW_COMPLETION: undefined,
  VIEW_CLOSURE: undefined,
} satisfies Record<PublicationWork['primary_task'], PublicationCoreAction | undefined>;

function publicationCoreActions(work: PublicationWork) {
  const actions = work.available_actions.filter(
    (action): action is PublicationCoreAction => action in publicationCoreActionPresentation,
  );
  const primary = primaryTaskAction[work.primary_task];
  return actions.map((action) => ({
    action,
    ...publicationCoreActionPresentation[action],
    intent: action === 'CLOSE'
      ? 'danger' as const
      : action === primary
        ? 'primary' as const
        : 'secondary' as const,
  }));
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

export {
  canonicalPublicationWorkspaceHash,
  closeFormSchema,
  isCanonicalPublicationWorkspaceHash,
  platformReviewFormSchema,
  preparationFormSchema,
  publicationCoreActions,
  publicationWorkspaceSections,
  resultFormSchema,
};
export type {
  PublicationCoreAction,
  PublicationWorkspaceContext,
  PublicationWorkspaceSection,
};
