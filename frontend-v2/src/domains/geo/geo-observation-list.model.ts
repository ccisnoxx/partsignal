import type { SortingState } from '@tanstack/react-table';
import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type GeoObservationListItem = components['schemas']['GeoObservationListItem'];
type GeoObservationListIndicator = components['schemas']['GeoObservationListIndicator'];
type GeoObservationListSort = components['schemas']['GeoObservationListSort'];
type AccuracyStatus = components['schemas']['AccuracyStatus'];
type GeoObservationListApiParams = NonNullable<
  operations['listGeoObservationItems']['parameters']['query']
>;

const accuracyValues = [
  'ACCURATE',
  'PARTIAL',
  'INCORRECT',
  'UNJUDGEABLE',
] as const satisfies readonly AccuracyStatus[];
const sortValues = [
  'OBSERVED_DESC',
  'OBSERVED_ASC',
] as const satisfies readonly GeoObservationListSort[];

const accuracyLabels = {
  ACCURATE: '准确',
  PARTIAL: '部分准确',
  INCORRECT: '不准确',
  UNJUDGEABLE: '无法判断',
} satisfies Record<AccuracyStatus, string>;

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function normalizeUuid(value: unknown) {
  return typeof value === 'string' && z.uuid().safeParse(value).success ? value : undefined;
}

function normalizeDate(value: unknown) {
  return typeof value === 'string' && z.iso.date().safeParse(value).success ? value : undefined;
}

function normalizeAccuracy(value: unknown) {
  return typeof value === 'string' && accuracyValues.some((item) => item === value)
    ? value
    : undefined;
}

function normalizeSort(value: unknown) {
  return typeof value === 'string' && sortValues.some((item) => item === value)
    ? value
    : undefined;
}

const geoObservationSearchSchema = z.object({
  q: z.preprocess((value) => normalizeText(value, 200), z.string().max(200).optional()),
  productId: z.preprocess(normalizeUuid, z.uuid().optional()),
  queryTopicId: z.preprocess(normalizeUuid, z.uuid().optional()),
  geoPlatform: z.preprocess(
    (value) => normalizeText(value, 160),
    z.string().max(160).optional(),
  ),
  accuracy: z.preprocess(normalizeAccuracy, z.enum(accuracyValues).optional()),
  from: z.preprocess(normalizeDate, z.iso.date().optional()),
  to: z.preprocess(normalizeDate, z.iso.date().optional()),
  sort: z.preprocess(normalizeSort, z.enum(sortValues).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type GeoObservationSearch = z.output<typeof geoObservationSearchSchema>;

function geoObservationSearchToApiParams(
  search: GeoObservationSearch,
): GeoObservationListApiParams {
  return {
    search: search.q,
    product_id: search.productId,
    query_topic_id: search.queryTopicId,
    geo_platform: search.geoPlatform,
    accuracy: search.accuracy,
    date_from: search.from,
    date_to: search.to,
    sort: search.sort,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalGeoObservationSearchRecord(
  search: GeoObservationSearch,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  if (search.productId) record.productId = search.productId;
  if (search.queryTopicId) record.queryTopicId = search.queryTopicId;
  if (search.geoPlatform) record.geoPlatform = search.geoPlatform;
  if (search.accuracy) record.accuracy = search.accuracy;
  if (search.from) record.from = search.from;
  if (search.to) record.to = search.to;
  if (search.sort) record.sort = search.sort;
  return record;
}

function isCanonicalGeoObservationSearch(
  raw: Record<string, unknown>,
  search: GeoObservationSearch,
) {
  const expected = canonicalGeoObservationSearchRecord(search);
  const rawKeys = Object.keys(raw);
  const expectedKeys = Object.keys(expected);
  return rawKeys.length === expectedKeys.length
    && expectedKeys.every((key) => {
      const value = raw[key];
      return (typeof value === 'string' || typeof value === 'number')
        && String(value) === String(expected[key]);
    });
}

function hasGeoObservationFilters(search: GeoObservationSearch) {
  return Boolean(
    search.q
    || search.productId
    || search.queryTopicId
    || search.geoPlatform
    || search.accuracy
    || search.from
    || search.to,
  );
}

function normalizeGeoObservationPageSize(value: number): GeoObservationSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`GEO Observations 表格收到未知分页大小：${value}`);
}

function geoObservationSortToSorting(sort?: GeoObservationListSort): SortingState {
  return [{ id: 'observed_at', desc: sort !== 'OBSERVED_ASC' }];
}

function sortingToGeoObservationSort(sorting: SortingState): GeoObservationListSort | undefined {
  const entry = sorting[0];
  if (!entry || entry.id !== 'observed_at') {
    throw new Error('GEO Observations 表格收到未知排序列');
  }
  return entry.desc ? undefined : 'OBSERVED_ASC';
}

function formatGeoObservationIndicator(
  label: string,
  indicator: GeoObservationListIndicator | null,
) {
  if (!indicator) return `${label}不适用`;
  const unassessed = indicator.total_count - indicator.assessed_count;
  return `${label} ${indicator.positive_count}/${indicator.assessed_count}${
    unassessed > 0 ? `（${unassessed} 未评估）` : ''
  }`;
}

function formatGeoObservationTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`GEO Observations API 返回了非法时间：${value}`);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export {
  accuracyLabels,
  accuracyValues,
  canonicalGeoObservationSearchRecord,
  formatGeoObservationIndicator,
  formatGeoObservationTime,
  geoObservationSearchSchema,
  geoObservationSearchToApiParams,
  geoObservationSortToSorting,
  hasGeoObservationFilters,
  isCanonicalGeoObservationSearch,
  normalizeGeoObservationPageSize,
  sortingToGeoObservationSort,
};
export type {
  AccuracyStatus,
  GeoObservationListApiParams,
  GeoObservationListItem,
  GeoObservationListSort,
  GeoObservationSearch,
};
