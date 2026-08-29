import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';
import { formatPublicationTime, formatRelativePublicationTime } from './publication-work.model';

type PublishedArticle = components['schemas']['PublishedArticle'];
type PublishedArticleListItem = components['schemas']['PublishedArticleListItem'];
type PublishedArticleSort = components['schemas']['PublishedArticleSort'];
type PublishedArticleListApiParams = NonNullable<
  operations['listPublishedArticles']['parameters']['query']
>;
type StatusTone = 'success' | 'warning' | 'secondary';

const publishedArticleSortValues = [
  'VERIFIED_DESC',
  'VERIFIED_ASC',
  'PUBLISHED_DESC',
  'PUBLISHED_ASC',
  'TITLE_ASC',
  'TITLE_DESC',
] as const satisfies readonly PublishedArticleSort[];

const publishedArticleSortLabels = {
  VERIFIED_DESC: '首次核验：从新到旧',
  VERIFIED_ASC: '首次核验：从旧到新',
  PUBLISHED_DESC: '发布时间：从新到旧',
  PUBLISHED_ASC: '发布时间：从旧到新',
  TITLE_ASC: '标题：A 到 Z',
  TITLE_DESC: '标题：Z 到 A',
} satisfies Record<PublishedArticleSort, string>;

const publishedArticleStageRegistry = {
  HEALTHY: { label: '健康', tone: 'success' },
  OPEN_ISSUE: { label: '存在内容问题', tone: 'warning' },
  RETIRED: { label: '已退役', tone: 'secondary' },
} satisfies Record<PublishedArticleListItem['workflow_stage'], {
  label: string;
  tone: StatusTone;
}>;

const publicationEventLabels = {
  CREATED: '已开始发布',
  PREPARATION_UPDATED: '已更新准备信息',
  PLATFORM_REVIEW_MARKED: '已标记平台处理中',
  RESULT_REGISTERED: '已登记发布结果',
  VERIFICATION_FAILED: '核验未通过',
  CONTENT_VERSION_CHANGED: '已切换内容版本',
  COMPLETED: '首次核验通过',
  CLOSED: '已关闭工作',
} satisfies Record<PublishedArticle['events'][number]['action'], string>;

function normalizeQuery(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : undefined;
}

function normalizeSort(value: unknown) {
  return typeof value === 'string'
    && publishedArticleSortValues.some((candidate) => candidate === value)
    ? value
    : undefined;
}

const publishedArticleSearchSchema = z.object({
  q: z.preprocess(normalizeQuery, z.string().max(200).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
  sort: z.preprocess(normalizeSort, z.enum(publishedArticleSortValues).optional()),
});

type PublishedArticleSearch = z.output<typeof publishedArticleSearchSchema>;

function publishedArticleSearchToApiParams(
  search: PublishedArticleSearch,
): PublishedArticleListApiParams {
  return {
    page: search.page,
    page_size: search.pageSize,
    search: search.q,
    sort: search.sort ?? 'VERIFIED_DESC',
  };
}

function canonicalPublishedArticleSearchRecord(
  search: PublishedArticleSearch,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  if (search.sort) record.sort = search.sort;
  return record;
}

function isCanonicalPublishedArticleSearch(
  raw: Record<string, unknown>,
  search: PublishedArticleSearch,
) {
  const expected = canonicalPublishedArticleSearchRecord(search);
  const expectedKeys = Object.keys(expected);
  return Object.keys(raw).length === expectedKeys.length
    && expectedKeys.every((key) => String(raw[key]) === String(expected[key]));
}

function normalizePublishedArticlePageSize(value: number): PublishedArticleSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`发布成果表格收到未知分页大小：${value}`);
}

function publishedArticleUrlDomain(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    throw new Error(`Publication API 返回了非法最终 URL：${value}`);
  }
}

export {
  canonicalPublishedArticleSearchRecord,
  formatPublicationTime,
  formatRelativePublicationTime,
  isCanonicalPublishedArticleSearch,
  normalizePublishedArticlePageSize,
  publicationEventLabels,
  publishedArticleSearchSchema,
  publishedArticleSearchToApiParams,
  publishedArticleSortLabels,
  publishedArticleSortValues,
  publishedArticleStageRegistry,
  publishedArticleUrlDomain,
};
export type {
  PublishedArticle,
  PublishedArticleListApiParams,
  PublishedArticleListItem,
  PublishedArticleSearch,
  PublishedArticleSort,
};
