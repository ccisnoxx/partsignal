import type { components } from '@/shared/api/generated/schema';

export const statusLabels = { OPEN: '待确认', ACKNOWLEDGED: '已确认', IN_PROGRESS: '处理中', RESOLVED: '已解决', DISMISSED: '已忽略' } satisfies Record<components['schemas']['GeoOpportunityStatus'], string>;
export const priorityLabels = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '严重' } satisfies Record<components['schemas']['GeoOpportunityPriority'], string>;
export const opportunityActionTypeLabels = {
  FACT_REVISION: '事实修订', CONTENT_TASK: '内容任务', PUBLICATION_REPAIR: '发布修复',
  ADDITIONAL_MONITORING: '追加监测', OTHER: '其他行动',
} satisfies Record<components['schemas']['GeoOpportunityActionType'], string>;
