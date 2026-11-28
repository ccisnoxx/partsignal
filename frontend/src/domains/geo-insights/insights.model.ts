import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

type Schema = components['schemas'];
export type Overview = Schema['GeoOverview'];
export type AnswerInsights = Schema['GeoAnswerInsights'];
export type Filters = Schema['GeoOverviewFilters'];
export type Metric = Schema['GeoOverviewCard'] | Schema['GeoAnswerInsightMetric'];
export type Drilldown = Schema['GeoOverviewDrilldown'] | Schema['GeoAnswerInsightDrilldown']
  | Schema['GeoInsightCitationDrilldown'] | Schema['GeoInsightClaimDrilldown'] | Schema['GeoInsightQualityDrilldown'];
export type OnDrilldown = (descriptor: Drilldown) => void;
export type BaseParams = operations['getGeoOverview']['parameters']['query'];

export const modeLabels = { MANUAL: '人工', API: 'API', BROWSER: '浏览器' } satisfies Record<Schema['GeoCollectionMode'], string>;
export const sampleLabels = { NONE: '无样本', OBSERVED: '样本不足 · 仅观测', REPORTABLE: '可报告', STABLE: '稳定样本' } satisfies Record<Schema['SampleLevel'], string>;

export const identityFilters = [
  ['subject_ids', '监测对象 ID'], ['product_ids', '产品 ID'], ['query_topic_ids', '问题主题 ID'],
  ['prompt_variant_ids', '问题变体 ID'], ['engine_surface_ids', '观测面 ID'], ['collection_profile_ids', '采集配置 ID'],
] as const;
export const modeSchema = z.enum(['MANUAL', 'API', 'BROWSER']);
export const loginSchema = z.enum(['ANONYMOUS', 'AUTHENTICATED', 'NOT_APPLICABLE']);
export const intentSchema = z.enum(['BRAND', 'PRODUCT', 'REPLACEMENT', 'COMPARISON', 'APPLICATION', 'TROUBLESHOOTING']);
export const languageSchema = z.string().min(2).max(16).regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/).transform((value) => value.toLowerCase());
export const regionSchema = z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase());

const idList = z.array(canonicalUuidSchema).max(50).optional();
export const baseShape = z.object({
  date_from: z.iso.datetime({ offset: true }), date_to: z.iso.datetime({ offset: true }),
  subject_ids: idList, product_ids: idList, query_topic_ids: idList, prompt_variant_ids: idList,
  engine_surface_ids: idList, collection_profile_ids: idList,
  collection_modes: z.array(modeSchema).max(3).optional(), login_states: z.array(loginSchema).max(3).optional(),
  intent_types: z.array(intentSchema).max(10).optional(), language_codes: z.array(languageSchema).max(50).optional(),
  region_codes: z.array(regionSchema).max(50).optional(), mention_mode: z.enum(['BRANDED', 'UNBRANDED']).optional(),
  review_policy: z.literal('REVIEWED_ONLY').optional(),
});
export type BaseSearch = z.output<typeof baseShape>;

export function defaultWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  return { date_from: start.toISOString(), date_to: end.toISOString() };
}
export function splitValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(/[,\s]+/).filter(Boolean) : [];
}
function normalizedList<T extends string>(schema: z.ZodType<T>, value: unknown, maximum: number) {
  const values = splitValues(value).flatMap((entry) => {
    const result = schema.safeParse(entry); return result.success ? [result.data] : [];
  });
  const result = [...new Set(values)].sort().slice(0, maximum);
  return result.length ? result : undefined;
}
function timestamp(value: unknown) {
  const result = z.iso.datetime({ offset: true }).safeParse(value);
  return result.success ? new Date(result.data).toISOString() : undefined;
}
export function normalizeBase(raw: Record<string, unknown>): BaseSearch {
  const defaults = defaultWindow();
  let date_from = timestamp(raw.date_from) ?? defaults.date_from;
  let date_to = timestamp(raw.date_to) ?? defaults.date_to;
  // 只规范 URL 时间输入；前周期计算和可比性由服务端拥有。
  if (date_from >= date_to) { date_from = defaults.date_from; date_to = defaults.date_to; }
  const ids = Object.fromEntries(identityFilters.map(([key]) => [key, normalizedList(canonicalUuidSchema, raw[key], 50)]));
  return cleanRecord(baseShape.parse({ ...ids, date_from, date_to,
    collection_modes: normalizedList(modeSchema, raw.collection_modes, 3),
    login_states: normalizedList(loginSchema, raw.login_states, 3), intent_types: normalizedList(intentSchema, raw.intent_types, 10),
    language_codes: normalizedList(languageSchema, raw.language_codes, 50), region_codes: normalizedList(regionSchema, raw.region_codes, 50),
    mention_mode: raw.mention_mode === 'BRANDED' || raw.mention_mode === 'UNBRANDED' ? raw.mention_mode : undefined,
    review_policy: raw.review_policy === 'REVIEWED_ONLY' ? raw.review_policy : undefined,
  }));
}
export function cleanRecord<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
export function baseParams(search: BaseSearch): BaseParams {
  return cleanRecord({ ...baseShape.parse(search), review_policy: search.review_policy ?? 'EFFECTIVE' });
}
export function baseFromFilters(filters: Filters): BaseSearch {
  return normalizeBase(filters);
}
export function formatRate(value: number | null) {
  return value === null ? '不可计算 · 无可用样本' : new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}
export function formatPoints(value: number | null) {
  if (value === null) return '不可比较';
  const parts = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'always' }).formatToParts(value);
  return `${parts.filter((part) => part.type !== 'percentSign').map((part) => part.value).join('')} 个百分点`;
}
export function formatConfidenceInterval(
  ci: Schema['GeoConfidenceInterval'] | null | undefined,
): string | null {
  if (!ci) return null;
  const fmt = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
  return `95% CI ${fmt.format(ci.lower)}–${fmt.format(ci.upper)} (n=${ci.sample_size})`;
}
export function formatDeltaConfidenceInterval(
  ci: Schema['GeoDeltaConfidenceInterval'] | null | undefined,
): string | null {
  if (!ci) return null;
  const fmt = (value: number) => {
    const parts = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'always' }).formatToParts(value);
    return parts.filter((part) => part.type !== 'percentSign').map((part) => part.value).join('');
  };
  return `95% 差值区间 [${fmt(ci.lower)}, ${fmt(ci.upper)}] 个百分点`;
}
export function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'UTC', hour12: false }) + ' UTC';
}
