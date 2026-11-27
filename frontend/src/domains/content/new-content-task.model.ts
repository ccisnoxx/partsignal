import { z } from 'zod';

import { intentValues } from '@/domains/geo/query-topic-list.model';
import type { components } from '@/shared/api/generated/schema';

type ContentTaskCreate = components['schemas']['ContentTaskCreate'];

const requiredId = (label: string) => z.string()
  .min(1, `请选择${label}`)
  .pipe(z.uuid(`请选择有效的${label}`));

const optionalId = z.string().trim().refine(
  (value) => value === '' || z.uuid().safeParse(value).success,
  '请选择有效的内容活动',
);

function parseLines(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/\r?\n/)) {
    const cleaned = part.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    items.push(cleaned);
  }
  return items;
}

function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/[\r\n,，]+/)) {
    const cleaned = part.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    items.push(cleaned);
  }
  return items;
}

function validateBriefListField(
  raw: string,
  parser: (value: string) => string[],
  limits: { maxItems: number; maxLength: number; label: string; path: string },
  ctx: z.RefinementCtx,
) {
  const items = parser(raw);
  if (items.length > limits.maxItems) {
    ctx.addIssue({
      code: 'custom',
      path: [limits.path],
      message: `${limits.label}最多填写 ${limits.maxItems} 条（当前 ${items.length} 条）`,
    });
  }
  const tooLong = items.find((item) => item.length > limits.maxLength);
  if (tooLong) {
    ctx.addIssue({
      code: 'custom',
      path: [limits.path],
      message: `${limits.label}单条不能超过 ${limits.maxLength} 字`,
    });
  }
}

const newContentTaskFormSchema = z.object({
  campaign_id: optionalId,
  product_id: requiredId('产品'),
  fact_version_id: requiredId('已批准事实版本'),
  platform_profile_id: requiredId('目标平台'),
  query_topic_id: requiredId('目标问题主题'),
  target_question: z.string().trim().min(1, '请填写目标问题').max(500, '目标问题不能超过 500 字'),
  search_intent: z.enum(intentValues),
  content_angle: z.string().trim().min(1, '请填写内容角度').max(160, '内容角度不能超过 160 字'),
  target_audience: z.string().trim().max(500, '目标受众不能超过 500 字'),
  must_answer_questions_text: z.string(),
  required_fact_points_text: z.string(),
  forbidden_expressions_text: z.string(),
  content_format: z.string().trim().max(80, '内容形式不能超过 80 字'),
  cta: z.string().trim().max(500, 'CTA 不能超过 500 字'),
  target_keywords_text: z.string(),
  success_metrics_notes: z.string().trim().max(500, '成功指标备注不能超过 500 字'),
}).superRefine((values, ctx) => {
  validateBriefListField(
    values.must_answer_questions_text,
    parseLines,
    { maxItems: 20, maxLength: 300, label: '必须回答的问题', path: 'must_answer_questions_text' },
    ctx,
  );
  validateBriefListField(
    values.required_fact_points_text,
    parseLines,
    { maxItems: 20, maxLength: 300, label: '必须覆盖的产品事实', path: 'required_fact_points_text' },
    ctx,
  );
  validateBriefListField(
    values.forbidden_expressions_text,
    parseLines,
    { maxItems: 50, maxLength: 300, label: '禁止表达', path: 'forbidden_expressions_text' },
    ctx,
  );
  validateBriefListField(
    values.target_keywords_text,
    parseKeywords,
    { maxItems: 30, maxLength: 100, label: '目标关键词', path: 'target_keywords_text' },
    ctx,
  );
});

type NewContentTaskFormValues = z.infer<typeof newContentTaskFormSchema>;
type NewContentTaskField = keyof NewContentTaskFormValues;

function splitContentRestrictions(raw: string | null | undefined): string {
  if (!raw) return '';
  return parseLines(raw.replace(/[；;]+/g, '\n'))
    .slice(0, 50)
    .map((item) => item.slice(0, 300))
    .join('\n');
}

function toContentTaskCreate(values: NewContentTaskFormValues): ContentTaskCreate {
  const notes = values.success_metrics_notes.trim();
  return {
    product_id: values.product_id,
    fact_version_id: values.fact_version_id,
    platform_profile_id: values.platform_profile_id,
    campaign_id: values.campaign_id.trim() || null,
    query_topic_id: values.query_topic_id,
    brief: {
      target_question: values.target_question.trim(),
      search_intent: values.search_intent,
      content_angle: values.content_angle.trim(),
      target_audience: values.target_audience.trim(),
      must_answer_questions: parseLines(values.must_answer_questions_text),
      required_fact_points: parseLines(values.required_fact_points_text),
      forbidden_expressions: parseLines(values.forbidden_expressions_text),
      content_format: values.content_format.trim(),
      cta: values.cta.trim(),
      target_keywords: parseKeywords(values.target_keywords_text),
      success_metrics: {
        notes: notes || null,
      },
    },
  } satisfies ContentTaskCreate;
}

function normalizeUuidParam(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return z.uuid().safeParse(trimmed).success ? trimmed.toLowerCase() : trimmed;
}

const newContentTaskSearchSchema = z.object({
  productId: z.preprocess(normalizeUuidParam, z.string().optional()),
  campaignId: z.preprocess(normalizeUuidParam, z.string().optional()),
});

type NewContentTaskSearch = z.output<typeof newContentTaskSearchSchema>;
type ProductHandoff =
  | { kind: 'none' }
  | { kind: 'invalid'; value: string }
  | { kind: 'valid'; productId: string };
type CampaignHandoff =
  | { kind: 'none' }
  | { kind: 'invalid'; value: string }
  | { kind: 'valid'; campaignId: string };

function resolveProductHandoff(search: NewContentTaskSearch): ProductHandoff {
  if (search.productId === undefined) return { kind: 'none' };
  if (!z.uuid().safeParse(search.productId).success) {
    return { kind: 'invalid', value: search.productId };
  }
  return { kind: 'valid', productId: search.productId };
}

function resolveCampaignHandoff(search: NewContentTaskSearch): CampaignHandoff {
  if (search.campaignId === undefined) return { kind: 'none' };
  if (!z.uuid().safeParse(search.campaignId).success) {
    return { kind: 'invalid', value: search.campaignId };
  }
  return { kind: 'valid', campaignId: search.campaignId };
}

export {
  newContentTaskFormSchema,
  newContentTaskSearchSchema,
  resolveCampaignHandoff,
  resolveProductHandoff,
  splitContentRestrictions,
  toContentTaskCreate,
};
export type {
  CampaignHandoff,
  NewContentTaskField,
  NewContentTaskFormValues,
  NewContentTaskSearch,
  ProductHandoff,
};
