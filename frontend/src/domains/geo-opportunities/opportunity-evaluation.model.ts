import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

const identities = z.array(canonicalUuidSchema).max(50, '每类最多选择 50 个对象');
export const evaluationFormSchema = z.object({
  scope: z.enum(['ALL', 'FILTERED']),
  date_from: z.iso.datetime({ offset: true, message: '请输入带时区的 ISO 时间' }),
  date_to: z.iso.datetime({ offset: true, message: '请输入带时区的 ISO 时间' }),
  rule_set_revision: z.number().int().min(1, '规则修订号必须是正整数'),
  subject_ids: identities, engine_surface_ids: identities, collection_profile_ids: identities,
  collection_modes: z.array(z.enum(['MANUAL', 'API', 'BROWSER'])).max(3),
}).superRefine((value, ctx) => {
  const duration = Date.parse(value.date_to) - Date.parse(value.date_from);
  if (!(duration > 0 && duration <= 31 * 86400000)) ctx.addIssue({ code: 'custom', path: ['date_to'], message: '结束必须晚于开始，窗口最长 31 天' });
  const filtered = Boolean(value.subject_ids.length || value.engine_surface_ids.length || value.collection_profile_ids.length);
  if (filtered !== (value.scope === 'FILTERED')) ctx.addIssue({ code: 'custom', path: ['scope'], message: '全部范围不允许对象过滤；筛选范围至少选择一类 Subject、Surface 或 Profile' });
});
export type EvaluationValues = z.infer<typeof evaluationFormSchema>;
export function evaluationRequest(values: EvaluationValues): components['schemas']['GeoOpportunityEvaluationRequest'] {
  const value = evaluationFormSchema.parse(values);
  return { ...value, date_from: new Date(value.date_from).toISOString(), date_to: new Date(value.date_to).toISOString(),
    subject_ids: [...new Set(value.subject_ids)].sort(), engine_surface_ids: [...new Set(value.engine_surface_ids)].sort(),
    collection_profile_ids: [...new Set(value.collection_profile_ids)].sort(), collection_modes: [...new Set(value.collection_modes)].sort() };
}
const reasons: Record<string, string> = {
  NO_CANDIDATES: '没有符合范围的候选数据', INSUFFICIENT_SAMPLE: '有效样本不足', NOT_COMPARABLE: '窗口或环境不可比较',
  THRESHOLD_NOT_CONFIGURED: '没有配置触发阈值', CITATION_OBSERVATION_UNAVAILABLE: '没有可观察的引用依据',
  PRIMARY_SUBJECT_UNAVAILABLE: '主要监测对象不可用', NO_BASELINE: '缺少历史基线',
};
export function evaluationReason(code: string) { return reasons[code] ? `${reasons[code]}（${code}）` : `服务端未生成原因：${code}`; }
