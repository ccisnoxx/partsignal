import type { components } from '@/shared/api/generated/schema';

type ContentVersion = components['schemas']['ContentVersion'];

type ContentStatusPresentation = {
  label: string;
  tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
};

const contentVersionStatusRegistry = {
  DRAFT: { label: '草稿', tone: 'info' },
  PENDING_REVIEW: { label: '待审核', tone: 'warning' },
  CHANGES_REQUESTED: { label: '已退回修改', tone: 'warning' },
  APPROVED: { label: '已批准', tone: 'success' },
  SUPERSEDED: { label: '历史版本', tone: 'secondary' },
  ABANDONED: { label: '已放弃', tone: 'secondary' },
} as const satisfies Record<ContentVersion['status'], ContentStatusPresentation>;

function contentReviewActionLabel(action: string) {
  switch (action) {
    case 'submit-review': return '提交审核';
    case 'approve': return '批准内容';
    case 'request-changes': return '退回修改';
    default: return `审核记录 · ${action}`;
  }
}

function formatContentVersionTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export {
  contentReviewActionLabel,
  contentVersionStatusRegistry,
  formatContentVersionTime,
};
export type { ContentStatusPresentation };
