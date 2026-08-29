import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { GeoRequestError } from './geo.api';
import {
  type GeoObservationCorrectionContext,
  tailManualHistory,
} from './geo-observation-detail.model';
import { accuracyValues, localDateTime } from './new-geo-observation.model';

type GeoObservationCreate = components['schemas']['GeoObservationCreate'];

const explicitBoolean = (label: string) => z.boolean().nullable().refine(
  (value) => value !== null,
  `请选择${label}`,
);

const correctionArticleResultSchema = z.object({
  published_article_id: z.uuid(),
  discovered: explicitBoolean('是否发现'),
  mentioned: explicitBoolean('是否提及'),
  accuracy: z.enum(accuracyValues).nullable(),
});

const geoObservationCorrectionFormSchema = z.object({
  query_topic_id: z.string()
    .min(1, '请选择 Query Topic')
    .pipe(z.uuid('请选择有效的 Query Topic')),
  tested_at: z.string().min(1, '请选择观测时间').refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    '请选择有效的观测时间',
  ),
  article_results: z.array(correctionArticleResultSchema)
    .min(1, '当前产品没有可更正的 Published Article'),
  attachment_file_ids: z.array(z.uuid()).refine(
    (items) => new Set(items).size === items.length,
    '证据附件不能重复',
  ),
  notes: z.string(),
});

type GeoObservationCorrectionFormValues = z.input<
  typeof geoObservationCorrectionFormSchema
>;
type GeoObservationCorrectionField = keyof GeoObservationCorrectionFormValues;

function correctionValues(
  context: GeoObservationCorrectionContext,
  now = new Date(),
): GeoObservationCorrectionFormValues {
  const tail = tailManualHistory(context.detail);
  return {
    query_topic_id: tail.query_topic?.id ?? '',
    tested_at: localDateTime(now),
    article_results: context.correction_article_results.map((item) => ({
      published_article_id: item.published_article_id,
      discovered: item.discovered,
      mentioned: item.mentioned,
      accuracy: item.accuracy,
    })),
    attachment_file_ids: [],
    notes: '',
  };
}

function mergeCorrectionValues(
  context: GeoObservationCorrectionContext,
  previous: GeoObservationCorrectionFormValues,
): GeoObservationCorrectionFormValues {
  const tail = tailManualHistory(context.detail);
  const previousById = new Map(
    previous.article_results.map((item) => [item.published_article_id, item]),
  );
  const queryTopicId = tail.query_topic?.id
    ?? (context.query_topic_options.some((item) => item.id === previous.query_topic_id)
      ? previous.query_topic_id
      : '');
  return {
    ...previous,
    query_topic_id: queryTopicId,
    article_results: context.correction_article_results.map((item) => (
      previousById.get(item.published_article_id) ?? {
        published_article_id: item.published_article_id,
        discovered: item.discovered,
        mentioned: item.mentioned,
        accuracy: item.accuracy,
      }
    )),
  };
}

function toGeoObservationCorrectionCreate(
  context: GeoObservationCorrectionContext,
  values: GeoObservationCorrectionFormValues,
): GeoObservationCreate {
  const tail = tailManualHistory(context.detail);
  return {
    product_id: context.detail.product.id,
    query_topic_id: tail.query_topic?.id ?? values.query_topic_id,
    search_platform: tail.observation.search_platform,
    search_query: tail.observation.search_query,
    tested_at: new Date(values.tested_at).toISOString(),
    article_results: values.article_results.map((item) => ({
      published_article_id: item.published_article_id,
      discovered: item.discovered as boolean,
      mentioned: item.mentioned as boolean,
      accuracy: item.accuracy,
    })),
    attachment_file_ids: values.attachment_file_ids,
    notes: values.notes,
    supersedes_id: context.detail.chain_tail_id,
  } satisfies GeoObservationCreate;
}

type GeoCorrectionErrorMapping = {
  fields: Record<string, string>;
  formMessage?: string;
  requestId?: string;
  code?: string;
};

const correctionSimpleFields = new Set<GeoObservationCorrectionField>([
  'query_topic_id',
  'tested_at',
  'notes',
]);
const correctionArticleFields = new Set(['discovered', 'mentioned', 'accuracy']);

function mapGeoObservationCorrectionError(error: unknown): GeoCorrectionErrorMapping {
  if (!(error instanceof GeoRequestError) || !error.detail) {
    return {
      fields: {},
      formMessage: error instanceof Error ? error.message : '追加 GEO 更正失败',
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
      if (simple && correctionSimpleFields.has(simple as GeoObservationCorrectionField)) {
        fields[simple] ??= message;
        continue;
      }
      if (
        loc.length === 4
        && loc[1] === 'article_results'
        && typeof loc[2] === 'number'
        && typeof loc[3] === 'string'
        && correctionArticleFields.has(loc[3])
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
  correctionValues,
  geoObservationCorrectionFormSchema,
  mapGeoObservationCorrectionError,
  mergeCorrectionValues,
  toGeoObservationCorrectionCreate,
};
export type {
  GeoObservationCorrectionField,
  GeoObservationCorrectionFormValues,
};
