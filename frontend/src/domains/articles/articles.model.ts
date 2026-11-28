import type { components } from '@/shared/api/generated/schema';

export type ArticleOriginType = components['schemas']['ArticleOriginType'];
export type ArticleStatus = components['schemas']['ArticleStatus'];
export type VerificationStatus = components['schemas']['ArticlePublicationVerificationStatus'];

export const originLabels: Record<ArticleOriginType, string> = {
  EXTERNAL_AI: '外部 AI 生成',
  HUMAN: '人工编写',
  SYSTEM_AI: '系统 AI 生成',
  OTHER: '其他来源',
};

export const articleStatusLabels: Record<ArticleStatus, string> = {
  DRAFT: '草稿',
  READY: '可发布',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

export const verificationStatusMeta: Record<
  VerificationStatus,
  { label: string; tone: 'secondary' | 'success' | 'warning' }
> = {
  UNVERIFIED: { label: '已人工登记（未核验）', tone: 'secondary' },
  VERIFIED: { label: '已核验通过', tone: 'success' },
  ISSUE_OPEN: { label: '页面存在待处理问题', tone: 'warning' },
};

export function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
