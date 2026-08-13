import type { SortingState } from '@tanstack/react-table';
import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type QueryTopicListItem = components['schemas']['QueryTopicListItem'];
type QueryTopic = components['schemas']['QueryTopic'];
type QueryTopicListSort = components['schemas']['QueryTopicListSort'];
type QueryTopicListApiParams = NonNullable<
  operations['listQueryTopicItems']['parameters']['query']
>;
type QueryTopicCreate = components['schemas']['QueryTopicCreate'];
type QueryTopicUpdate = components['schemas']['QueryTopicUpdate'];
type IntentType = QueryTopicCreate['intent_type'];

const sortValues = [
  'QUESTION_ASC',
  'QUESTION_DESC',
  'INTENT_ASC',
  'INTENT_DESC',
] as const satisfies readonly QueryTopicListSort[];

const intentValues = [
  'BRAND',
  'PRODUCT',
  'REPLACEMENT',
  'COMPARISON',
  'APPLICATION',
  'TROUBLESHOOTING',
] as const satisfies readonly IntentType[];

const intentLabels = {
  BRAND: '品牌',
  PRODUCT: '产品',
  REPLACEMENT: '替代',
  COMPARISON: '对比',
  APPLICATION: '应用',
  TROUBLESHOOTING: '故障排查',
} satisfies Record<IntentType, string>;

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeSort(value: unknown) {
  return typeof value === 'string' && sortValues.some((item) => item === value)
    ? value
    : 'QUESTION_ASC';
}

const queryTopicSearchSchema = z.object({
  q: z.preprocess(normalizeText, z.string().max(200).optional()),
  sort: z.preprocess(normalizeSort, z.enum(sortValues)).default('QUESTION_ASC'),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type QueryTopicSearch = z.output<typeof queryTopicSearchSchema>;

function queryTopicSearchToApiParams(search: QueryTopicSearch): QueryTopicListApiParams {
  return {
    q: search.q,
    sort: search.sort,
    page: search.page,
    page_size: search.pageSize,
  };
}

function canonicalQueryTopicSearchRecord(
  search: QueryTopicSearch,
): Record<string, string | number> {
  const record: Record<string, string | number> = {
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  if (search.q) record.q = search.q;
  return record;
}

function isCanonicalQueryTopicSearch(
  raw: Record<string, unknown>,
  search: QueryTopicSearch,
) {
  const expected = canonicalQueryTopicSearchRecord(search);
  return Object.keys(raw).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => String(raw[key]) === String(value));
}

function normalizeQueryTopicPageSize(value: number): QueryTopicSearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`Query Topics 表格收到未知分页大小：${value}`);
}

function queryTopicSortToSorting(sort: QueryTopicListSort): SortingState {
  return sort.startsWith('QUESTION')
    ? [{ id: 'canonical_question', desc: sort === 'QUESTION_DESC' }]
    : [{ id: 'intent_type', desc: sort === 'INTENT_DESC' }];
}

function sortingToQueryTopicSort(sorting: SortingState): QueryTopicListSort {
  const entry = sorting[0];
  if (entry?.id === 'canonical_question') return entry.desc ? 'QUESTION_DESC' : 'QUESTION_ASC';
  if (entry?.id === 'intent_type') return entry.desc ? 'INTENT_DESC' : 'INTENT_ASC';
  throw new Error('Query Topics 表格收到未知排序列');
}

function queryTopicObservationHref(topic: QueryTopicListItem) {
  if (topic.primary_task !== 'USE_FOR_OBSERVATION') {
    throw new Error(`Query Topic API 返回了未知 primary_task：${topic.primary_task as string}`);
  }
  return `/geo/observations/new?queryTopicId=${encodeURIComponent(topic.id)}`;
}

function queryTopicReferenceHrefs(topicId: string) {
  const id = encodeURIComponent(topicId);
  return {
    contentTasks: `/content/tasks?queryTopicId=${id}&queryTopicReference=CONTENT_TASK&archiveStatus=ALL&page=1&pageSize=20`,
    geoOptimization: `/content/tasks?queryTopicId=${id}&queryTopicReference=GEO_OPTIMIZATION_SOURCE&archiveStatus=ALL&page=1&pageSize=20`,
    observations: `/geo/observations?queryTopicId=${id}&page=1&pageSize=20`,
  };
}

const queryTopicFormSchema = z.object({
  canonical_question: z.string().min(1, '请填写标准问题'),
  intent_type: z.enum(intentValues),
  variants: z.array(z.object({ value: z.string().min(1, '请填写变体') })).min(1, '至少填写一个变体'),
});

type QueryTopicFormValues = z.input<typeof queryTopicFormSchema>;

function queryTopicFormValues(topic?: QueryTopic): QueryTopicFormValues {
  return topic ? {
    canonical_question: topic.canonical_question,
    intent_type: topic.intent_type,
    variants: topic.variants.map((value) => ({ value })),
  } : {
    canonical_question: '',
    intent_type: 'PRODUCT',
    variants: [{ value: '' }],
  };
}

function toQueryTopicCreate(values: QueryTopicFormValues): QueryTopicCreate {
  return {
    canonical_question: values.canonical_question,
    intent_type: values.intent_type,
    variants: values.variants.map((item) => item.value),
  };
}

function toQueryTopicUpdate(
  values: QueryTopicFormValues,
  expectedRevision: number,
): QueryTopicUpdate {
  return { ...toQueryTopicCreate(values), expected_revision: expectedRevision };
}

export {
  canonicalQueryTopicSearchRecord,
  intentLabels,
  intentValues,
  isCanonicalQueryTopicSearch,
  normalizeQueryTopicPageSize,
  queryTopicFormSchema,
  queryTopicFormValues,
  queryTopicObservationHref,
  queryTopicReferenceHrefs,
  queryTopicSearchSchema,
  queryTopicSearchToApiParams,
  queryTopicSortToSorting,
  sortingToQueryTopicSort,
  toQueryTopicCreate,
  toQueryTopicUpdate,
};
export type {
  IntentType,
  QueryTopicCreate,
  QueryTopicFormValues,
  QueryTopicListApiParams,
  QueryTopicListItem,
  QueryTopicListSort,
  QueryTopicSearch,
  QueryTopicUpdate,
};
