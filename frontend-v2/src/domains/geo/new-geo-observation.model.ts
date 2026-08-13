import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { GeoRequestError } from './geo.api';

type AccuracyStatus = components['schemas']['AccuracyStatus'];
type GeoObservationCreate = components['schemas']['GeoObservationCreate'];
type GeoPublicationCandidate = components['schemas']['GeoPublicationCandidate'];

const accuracyValues = [
  'ACCURATE',
  'PARTIAL',
  'INCORRECT',
  'UNJUDGEABLE',
] as const satisfies readonly AccuracyStatus[];

const accuracyLabels = {
  ACCURATE: '准确',
  PARTIAL: '部分准确',
  INCORRECT: '不准确',
  UNJUDGEABLE: '无法判断',
} satisfies Record<AccuracyStatus, string>;

const requiredId = (label: string) => z.string()
  .min(1, `请选择${label}`)
  .pipe(z.uuid(`请选择有效的${label}`));

const explicitBoolean = (label: string) => z.boolean().nullable().refine(
  (value) => value !== null,
  `请选择${label}`,
);

const articleResultSchema = z.object({
  published_article_id: z.uuid(),
  discovered: explicitBoolean('是否发现'),
  mentioned: explicitBoolean('是否提及'),
  accuracy: z.enum(accuracyValues).nullable(),
});

const newGeoObservationSearchSchema = z.object({
  queryTopicId: z.uuid().optional(),
  geoPlatform: z.string().trim().min(1).max(160).optional(),
});

type NewGeoObservationSearch = z.output<typeof newGeoObservationSearchSchema>;

const newGeoObservationFormSchema = z.object({
  product_id: requiredId('产品'),
  query_topic_id: requiredId('Query Topic'),
  search_platform: z.string().trim().min(1, '请填写 GEO 平台').max(160, 'GEO 平台不能超过 160 个字符'),
  search_query: z.string().trim().min(1, '请填写实际搜索问题'),
  tested_at: z.string().min(1, '请选择观测时间').refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    '请选择有效的观测时间',
  ),
  article_results: z.array(articleResultSchema).min(1, '当前产品没有可登记的 Published Article'),
  attachment_file_ids: z.array(z.uuid()).refine(
    (items) => new Set(items).size === items.length,
    '证据附件不能重复',
  ),
  notes: z.string(),
});

type NewGeoObservationFormValues = z.input<typeof newGeoObservationFormSchema>;
type NewGeoObservationField = keyof NewGeoObservationFormValues;
type ArticleResultValue = NewGeoObservationFormValues['article_results'][number];

const emptyGeoObservationValues = (): NewGeoObservationFormValues => ({
  product_id: '',
  query_topic_id: '',
  search_platform: '',
  search_query: '',
  tested_at: localDateTime(new Date()),
  article_results: [],
  attachment_file_ids: [],
  notes: '',
});

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function syncArticleResults(
  candidates: readonly GeoPublicationCandidate[],
  previous: readonly ArticleResultValue[],
): ArticleResultValue[] {
  const byId = new Map(previous.map((item) => [item.published_article_id, item]));
  return candidates.map((candidate) => byId.get(candidate.published_article_id) ?? {
    published_article_id: candidate.published_article_id,
    discovered: null,
    mentioned: null,
    accuracy: null,
  });
}

function toGeoObservationCreate(values: NewGeoObservationFormValues): GeoObservationCreate {
  return {
    product_id: values.product_id,
    query_topic_id: values.query_topic_id,
    search_platform: values.search_platform.trim(),
    search_query: values.search_query.trim(),
    tested_at: new Date(values.tested_at).toISOString(),
    article_results: values.article_results.map((item) => ({
      published_article_id: item.published_article_id,
      discovered: item.discovered as boolean,
      mentioned: item.mentioned as boolean,
      accuracy: item.accuracy,
    })),
    attachment_file_ids: values.attachment_file_ids,
    notes: values.notes,
  } satisfies GeoObservationCreate;
}

type GeoCreateErrorMapping = {
  fields: Record<string, string>;
  formMessage?: string;
  requestId?: string;
  code?: string;
};

const simpleFields = new Set<NewGeoObservationField>([
  'product_id',
  'query_topic_id',
  'search_platform',
  'search_query',
  'tested_at',
  'notes',
]);
const articleFields = new Set(['discovered', 'mentioned', 'accuracy']);

function mapGeoObservationCreateError(error: unknown): GeoCreateErrorMapping {
  if (!(error instanceof GeoRequestError) || !error.detail) {
    return {
      fields: {},
      formMessage: error instanceof Error ? error.message : '创建 GEO 观测失败',
    };
  }

  const fields: Record<string, string> = {};
  const issues = error.detail.details.errors;
  let hasUnknownIssue = false;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') {
        hasUnknownIssue = true;
        continue;
      }
      const loc = 'loc' in issue ? issue.loc : undefined;
      const message = 'msg' in issue ? issue.msg : undefined;
      if (!Array.isArray(loc) || loc[0] !== 'body' || typeof message !== 'string') {
        hasUnknownIssue = true;
        continue;
      }
      const simple = loc.length === 2 && typeof loc[1] === 'string' ? loc[1] : undefined;
      if (simple && simpleFields.has(simple as NewGeoObservationField)) {
        fields[simple] ??= message;
        continue;
      }
      if (
        loc.length === 4
        && loc[1] === 'article_results'
        && typeof loc[2] === 'number'
        && typeof loc[3] === 'string'
        && articleFields.has(loc[3])
      ) {
        fields[`article_results.${loc[2]}.${loc[3]}`] ??= message;
        continue;
      }
      hasUnknownIssue = true;
    }
  }
  return {
    fields,
    formMessage: Object.keys(fields).length === 0 || hasUnknownIssue
      ? error.detail.message
      : undefined,
    requestId: error.detail.request_id,
    code: error.detail.code,
  };
}

export {
  accuracyLabels,
  accuracyValues,
  emptyGeoObservationValues,
  localDateTime,
  mapGeoObservationCreateError,
  newGeoObservationSearchSchema,
  newGeoObservationFormSchema,
  syncArticleResults,
  toGeoObservationCreate,
};
export type {
  AccuracyStatus,
  ArticleResultValue,
  GeoPublicationCandidate,
  NewGeoObservationField,
  NewGeoObservationFormValues,
  NewGeoObservationSearch,
};
