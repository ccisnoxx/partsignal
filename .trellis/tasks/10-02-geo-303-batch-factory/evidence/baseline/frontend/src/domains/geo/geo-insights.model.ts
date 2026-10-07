import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type GeoInsightContentPerformance = components['schemas']['GeoInsightContentPerformance'];
type GeoInsightCoverageItem = components['schemas']['GeoInsightCoverageItem'];
type GeoInsightOptimizationAction = components['schemas']['GeoInsightOptimizationAction'];
type GeoInsightPeriodWindow = components['schemas']['GeoInsightPeriodWindow'];
type GeoInsightRateTrend = components['schemas']['GeoInsightRateTrend'];
type GeoInsightRateValue = components['schemas']['GeoInsightRateValue'];
type GeoOptimizationContentTaskCreate = components['schemas']['GeoOptimizationContentTaskCreate'];
type GeoInsightsApiParams = NonNullable<operations['getGeoInsights']['parameters']['query']>;

function utcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function defaultGeoInsightDates(now = new Date()) {
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: utcDate(start), to: utcDate(end) };
}

function normalizeDate(value: unknown) {
  return typeof value === 'string' && z.iso.date().safeParse(value).success
    ? value
    : undefined;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return z.uuid().safeParse(normalized).success ? normalized : undefined;
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : undefined;
}

const geoInsightSearchSchema = z.preprocess((value) => {
  const input = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const defaults = defaultGeoInsightDates();
  return {
    from: normalizeDate(input.from) ?? defaults.from,
    to: normalizeDate(input.to) ?? defaults.to,
    productId: normalizeUuid(input.productId),
    contentPlatformId: normalizeUuid(input.contentPlatformId),
    geoPlatform: normalizeText(input.geoPlatform),
    publishedArticleId: normalizeUuid(input.publishedArticleId),
    queryTopicId: normalizeUuid(input.queryTopicId),
  };
}, z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  productId: z.uuid().optional(),
  contentPlatformId: z.uuid().optional(),
  geoPlatform: z.string().max(160).optional(),
  publishedArticleId: z.uuid().optional(),
  queryTopicId: z.uuid().optional(),
}));

type GeoInsightSearch = z.output<typeof geoInsightSearchSchema>;

function geoInsightSearchToApiParams(search: GeoInsightSearch): GeoInsightsApiParams {
  return {
    date_from: search.from,
    date_to: search.to,
    product_id: search.productId,
    content_platform_id: search.contentPlatformId,
    geo_platform: search.geoPlatform,
    published_article_id: search.publishedArticleId,
    query_topic_id: search.queryTopicId,
  };
}

function canonicalGeoInsightSearchRecord(search: GeoInsightSearch) {
  return Object.fromEntries(Object.entries({
    from: search.from,
    to: search.to,
    productId: search.productId,
    contentPlatformId: search.contentPlatformId,
    geoPlatform: search.geoPlatform,
    publishedArticleId: search.publishedArticleId,
    queryTopicId: search.queryTopicId,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function geoInsightPrintHref(search: GeoInsightSearch) {
  return `/geo/insights/print?${new URLSearchParams(canonicalGeoInsightSearchRecord(search)).toString()}`;
}

function isCanonicalGeoInsightSearch(
  raw: Record<string, unknown>,
  search: GeoInsightSearch,
) {
  const expected = canonicalGeoInsightSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => raw[key] === value);
}

function formatInsightRate(rate: GeoInsightRateValue) {
  if (rate.denominator === 0 || rate.value === null) return '暂无数据';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate.value);
}

function formatInsightChange(trend: GeoInsightRateTrend) {
  if (trend.previous.denominator === 0) return '上一周期暂无样本';
  if (trend.previous.value === 0 && trend.change === null) return '相对变化不可计算';
  if (trend.change === null) return '不可比较';
  const value = new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(trend.change);
  return `较上一周期 ${value}`;
}

function formatInsightGeneratedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function observationListHref(
  period: GeoInsightPeriodWindow,
  filters: { geoPlatform?: string; queryTopicId?: string },
) {
  const params = new URLSearchParams({
    from: period.date_from,
    to: period.date_to,
    page: '1',
    pageSize: '20',
  });
  if (filters.geoPlatform) params.set('geoPlatform', filters.geoPlatform);
  if (filters.queryTopicId) params.set('queryTopicId', filters.queryTopicId);
  return `/geo/observations?${params.toString()}`;
}

function contentInsightHref(
  item: GeoInsightContentPerformance,
  period: GeoInsightPeriodWindow,
) {
  if (item.primary_task === 'VIEW_CONTENT_PERFORMANCE') {
    if (item.optimization_action !== null) {
      throw new Error('GEO Content Performance 的查看动作不能携带优化来源');
    }
    return `/publishing/articles/${encodeURIComponent(item.published_article_id)}`;
  }
  if (item.optimization_action === null) {
    throw new Error('GEO Content Performance 缺少服务端优化来源');
  }
  if (
    !['CONTENT_DECLINE', 'LONG_UNMENTIONED'].includes(item.optimization_action.rule_code)
    || item.optimization_action.published_article_id !== item.published_article_id
    || item.optimization_action.query_topic_id !== null
    || item.optimization_action.geo_platform !== null
  ) {
    throw new Error('GEO Content Performance 优化来源身份不一致');
  }
  assertActionPeriod(item.optimization_action, period);
  return undefined;
}

function coverageInsightHref(
  item: GeoInsightCoverageItem,
  period: GeoInsightPeriodWindow,
) {
  switch (item.primary_task) {
    case 'VIEW_OBSERVATION_DETAILS':
      if (item.optimization_action !== null) {
        throw new Error('GEO Coverage 查看动作不能携带优化来源');
      }
      return observationListHref(period, {
        geoPlatform: item.geo_platform,
        queryTopicId: item.query_topic_id,
      });
    case 'ADD_OBSERVATION':
      if (item.optimization_action !== null) {
        throw new Error('GEO Coverage 补样本动作不能携带优化来源');
      }
      return `/geo/observations/new?${new URLSearchParams({
        queryTopicId: item.query_topic_id,
        geoPlatform: item.geo_platform,
      }).toString()}`;
    case 'CREATE_OPTIMIZATION_TASK':
      if (item.optimization_action === null) {
        throw new Error('GEO Coverage 缺少服务端优化来源');
      }
      if (
        item.optimization_action.rule_code !== 'QUESTION_COVERAGE_GAP'
        || item.optimization_action.published_article_id !== null
        || item.optimization_action.query_topic_id !== item.query_topic_id
        || item.optimization_action.geo_platform !== item.geo_platform
      ) {
        throw new Error('GEO Coverage 优化来源身份不一致');
      }
      assertActionPeriod(item.optimization_action, period);
      return undefined;
  }
}

function assertActionPeriod(
  action: GeoInsightOptimizationAction,
  period: GeoInsightPeriodWindow,
) {
  if (action.date_from !== period.date_from || action.date_to !== period.date_to) {
    throw new Error('GEO 优化来源周期与当前洞察不一致');
  }
}

const requiredId = (label: string) => z.string()
  .min(1, `请选择${label}`)
  .pipe(z.uuid(`请选择有效的${label}`));

const geoOptimizationTargetSchema = z.object({
  product_id: requiredId('产品'),
  platform_profile_id: requiredId('目标平台'),
  fact_version_id: requiredId('已批准事实版本'),
});

type GeoOptimizationTarget = z.infer<typeof geoOptimizationTargetSchema>;
type GeoOptimizationTargetField = keyof GeoOptimizationTarget;

function toGeoOptimizationCreate(
  action: GeoInsightOptimizationAction,
  target: GeoOptimizationTarget,
): GeoOptimizationContentTaskCreate {
  return { ...action, ...target } satisfies GeoOptimizationContentTaskCreate;
}

export {
  canonicalGeoInsightSearchRecord,
  contentInsightHref,
  coverageInsightHref,
  defaultGeoInsightDates,
  formatInsightChange,
  formatInsightGeneratedAt,
  formatInsightRate,
  geoInsightPrintHref,
  geoInsightSearchSchema,
  geoInsightSearchToApiParams,
  geoOptimizationTargetSchema,
  isCanonicalGeoInsightSearch,
  observationListHref,
  toGeoOptimizationCreate,
};
export type {
  GeoInsightSearch,
  GeoInsightsApiParams,
  GeoOptimizationTarget,
  GeoOptimizationTargetField,
};
