import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { OpportunityRequestError } from './opportunities.api';
import type { OpportunityDetail } from './opportunities.model';

export const opportunityContentFormSchema = z.object({
  product_id: canonicalUuidSchema,
  fact_version_id: canonicalUuidSchema,
  platform_profile_id: canonicalUuidSchema,
});
export type OpportunityContentValues = z.infer<typeof opportunityContentFormSchema>;
export const opportunityRetestFormSchema = z.object({ baseline_batch_id: canonicalUuidSchema });
export type OpportunityRetestValues = z.infer<typeof opportunityRetestFormSchema>;
export type ContentCommand = components['schemas']['GeoOpportunityContentTaskRequest'];
export type RetestCommand = components['schemas']['GeoRetestRequest'];
export type BusinessRequest<T> = { body: T; key: string; signature: string };

// 同一请求的恢复继承完整载荷和 key；修订号也是载荷的一部分。
export function businessRequest<T extends ContentCommand | RetestCommand>(body: T, previous?: BusinessRequest<T>): BusinessRequest<T> {
  const signature = JSON.stringify(body);
  return previous?.signature === signature ? previous : { body, signature, key: crypto.randomUUID() };
}
export function businessFailureKind(error: unknown): 'denied' | 'conflict' | 'rejected' | 'unknown' {
  if (!(error instanceof OpportunityRequestError) || !error.status) return 'unknown';
  if ([401, 403, 404].includes(error.status)) return 'denied';
  if (error.status === 409) return 'conflict';
  return error.status >= 400 && error.status < 500 ? 'rejected' : 'unknown';
}
export function businessErrorMessage(error: unknown) {
  if (businessFailureKind(error) === 'denied') return '当前机会或选项不可访问，请关闭详情并确认登录与访问权限。';
  return error instanceof Error ? error.message : '机会业务操作失败';
}
export function baselineBatchChoices(detail: OpportunityDetail) {
  const batches = new Map<string, number>();
  for (const source of detail.sources.items) batches.set(source.run.batch_id, (batches.get(source.run.batch_id) ?? 0) + 1);
  return [...batches].map(([value, count]) => ({ value, label: `基线批次 ${value} · 当前来源页 ${count} 条证据` }));
}
export const retestDifferenceLabels = {
  OPPORTUNITY_NOT_IN_PROGRESS: '机会当前不允许复测', BASELINE_NOT_SOURCE: '基线不属于机会来源',
  BASELINE_NOT_FINISHED: '基线尚未完成', MATRIX_INVALID: '冻结矩阵无效', VARIANT_UNAVAILABLE: '问题变体不可用',
  VARIANT_CHANGED: '问题变体变化', TOPIC_CHANGED: '问题主题变化', PROFILE_UNAVAILABLE: '采集配置不可用',
  PROFILE_CHANGED: '采集配置变化', SURFACE_CHANGED: '观测面变化', SUBJECT_UNAVAILABLE: '监测对象不可用',
  SUBJECT_CHANGED: '监测对象变化', MODEL_VERSION_CHANGED: '模型版本变化', MODEL_VERSION_UNKNOWN: '模型版本未知',
} satisfies Record<components['schemas']['GeoRetestDifferenceCode'], string>;
