import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import type { BusinessRequest, RepairCommand } from './opportunity-business.model';

export type { RepairCommand } from './opportunity-business.model';
export type RepairMode = components['schemas']['GeoOpportunityPublicationRepairMode'];
export type RepairOptions = components['schemas']['GeoOpportunityPublicationRepairOptions'];
export type RepairCandidate = components['schemas']['GeoOpportunityPublicationRepairCandidate'];
export type RepairSubmission = { command: BusinessRequest<RepairCommand>; articleId: string };
export const repairModeLabels = { OPEN_ISSUE: '登记新发布问题', LINK_ISSUE: '关联已有发布问题', CREATE_REPAIR: '创建修复任务' } satisfies Record<RepairMode, string>;
export const repairKindLabels = { PAGE_UNAVAILABLE: '页面不可用', CONTENT_CHANGED: '内容变化', OTHER: '其他问题' } satisfies Record<components['schemas']['PublishedContentIssueKind'], string>;
export const repairFormSchema = z.object({
  mode: z.enum(['OPEN_ISSUE', 'LINK_ISSUE', 'CREATE_REPAIR']), target_id: canonicalUuidSchema,
  kind: z.enum(['PAGE_UNAVAILABLE', 'CONTENT_CHANGED', 'OTHER']), description: z.string(), fact_version_id: z.string(),
}).superRefine((value, ctx) => {
  if (value.mode === 'OPEN_ISSUE' && (!value.description.trim() || value.description.length > 2000 || value.description.includes('\0'))) ctx.addIssue({ code: 'custom', path: ['description'], message: '请填写1至2000字的非空问题描述，不含空字符。' });
  if (value.mode === 'CREATE_REPAIR' && !canonicalUuidSchema.safeParse(value.fact_version_id).success) ctx.addIssue({ code: 'custom', path: ['fact_version_id'], message: '请选择同产品已批准事实版本。' });
});
export type RepairValues = z.infer<typeof repairFormSchema>;
export const emptyRepairValues: RepairValues = { mode: 'OPEN_ISSUE', target_id: '', kind: 'OTHER', description: '', fact_version_id: '' };
export const candidateId = (candidate: RepairCandidate) => candidate.published_content_issue_id ?? candidate.published_article_id;
