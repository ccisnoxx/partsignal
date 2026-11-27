import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { splitContentRestrictions } from './new-content-task.model';

type BatchCellInput = components['schemas']['ContentTaskBatchCellInput'];
type BatchCellStatus = components['schemas']['ContentTaskBatchPreviewCell']['status'];
type BatchDiagnostic = components['schemas']['ContentTaskBatchDiagnostic'];
type BatchPreviewResponse = components['schemas']['ContentTaskBatchPreviewResponse'];
type BatchCreateResponse = components['schemas']['ContentTaskBatchCreateResponse'];
type CreationOptions = components['schemas']['ContentTaskCreationOptions'];

const MAX_BATCH_CELLS = 100;

const batchPlanSearchSchema = z.object({
  campaignId: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return z.uuid().safeParse(trimmed).success ? trimmed.toLowerCase() : trimmed || undefined;
    },
    z.string().optional(),
  ),
});

type BatchPlanSearch = z.output<typeof batchPlanSearchSchema>;

const batchCellStatusRegistry: Record<
  BatchCellStatus,
  { label: string; tone: 'success' | 'warning' | 'destructive' }
> = {
  READY: { label: '可创建', tone: 'success' },
  WARNING: { label: '存在软告警', tone: 'warning' },
  BLOCKED: { label: '硬阻断', tone: 'destructive' },
};

const batchDiagnosticLabels: Record<BatchDiagnostic['code'], string> = {
  PRODUCT_NOT_FOUND: '产品不存在',
  PRODUCT_INACTIVE: '产品已停用',
  NO_APPROVED_FACT: '缺少已批准事实',
  FACT_NOT_FOUND: '事实版本不存在',
  FACT_NOT_APPROVED: '事实版本未批准或为空',
  FACT_PRODUCT_MISMATCH: '事实与产品不匹配',
  PLATFORM_NOT_FOUND: '平台不存在',
  PLATFORM_DISABLED: '平台已停用',
  QUERY_TOPIC_NOT_FOUND: '问题主题不存在',
  QUERY_TOPIC_INACTIVE: '问题主题已停用',
  CAMPAIGN_NOT_FOUND: '活动不存在',
  CAMPAIGN_NOT_ELIGIBLE: '活动状态不可规划',
  CAMPAIGN_SCOPE_MISMATCH: '超出活动范围',
  DUPLICATE_IN_BATCH: '批次内重复',
  EXISTING_ACTIVE_TASK: '已有开放任务',
  RECENT_PUBLISHED_ARTICLE: '近期已有发布文章',
  PLATFORM_MISSING_PROMPT: '平台缺少 Prompt',
  FACT_OVERDUE: '事实复核已到期',
};

function parseAngleLines(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/\r?\n/)) {
    const cleaned = part.trim();
    const norm = cleaned.split(/\s+/).join(' ').toLowerCase();
    if (!cleaned || seen.has(norm)) continue;
    seen.add(norm);
    items.push(cleaned);
  }
  return items;
}

function parseKeywordsList(raw: string): string[] {
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

function parseMultilineItems(raw: string): string[] {
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

type BuildBatchMatrixInput = {
  productIds: string[];
  topicIds: string[];
  platformIds: string[];
  angles: string[];
  options: CreationOptions;
  sharedAudience: string;
  sharedContentFormat: string;
  sharedCta: string;
  sharedKeywordsText: string;
  sharedForbiddenText: string;
  sharedNotes: string;
};

type BatchBriefValidationInput = {
  angles: string[];
  sharedAudience: string;
  sharedContentFormat: string;
  sharedCta: string;
  sharedKeywordsText: string;
  sharedForbiddenText: string;
  sharedNotes: string;
};

function validateBatchBriefInputs(input: BatchBriefValidationInput): string[] {
  const errors: string[] = [];
  if (input.angles.length === 0) {
    errors.push('请至少输入 1 个内容角度');
  }
  const longAngle = input.angles.find((item) => item.length > 160);
  if (longAngle) {
    errors.push('单条内容角度不能超过 160 字');
  }
  if (input.sharedAudience.trim().length > 500) {
    errors.push('共享目标受众不能超过 500 字');
  }
  if (input.sharedContentFormat.trim().length > 80) {
    errors.push('共享内容形式不能超过 80 字');
  }
  if (input.sharedCta.trim().length > 500) {
    errors.push('共享 CTA 不能超过 500 字');
  }
  if (input.sharedNotes.trim().length > 500) {
    errors.push('共享成功标准备注不能超过 500 字');
  }
  const keywords = parseKeywordsList(input.sharedKeywordsText);
  if (keywords.length > 30) {
    errors.push(`共享目标关键词最多 30 个（当前 ${keywords.length} 个）`);
  }
  if (keywords.some((item) => item.length > 100)) {
    errors.push('单个目标关键词不能超过 100 字');
  }
  const forbidden = parseMultilineItems(input.sharedForbiddenText);
  if (forbidden.length > 50) {
    errors.push(`自定义禁止表达最多 50 条（当前 ${forbidden.length} 条）`);
  }
  if (forbidden.some((item) => item.length > 300)) {
    errors.push('单条禁止表达不能超过 300 字');
  }
  return errors;
}

function buildBatchCells(input: BuildBatchMatrixInput): BatchCellInput[] {
  const productById = new Map(input.options.products.map((item) => [item.id, item]));
  const topicById = new Map(input.options.topics.map((item) => [item.id, item]));
  const keywords = parseKeywordsList(input.sharedKeywordsText);
  const customForbidden = parseMultilineItems(input.sharedForbiddenText);
  const notes = input.sharedNotes.trim();
  const cells: BatchCellInput[] = [];

  for (const productId of input.productIds) {
    const product = productById.get(productId);
    const latestFact = product?.approved_fact_versions[0];
    const autoForbidden = latestFact?.content_restrictions
      ? parseMultilineItems(splitContentRestrictions(latestFact.content_restrictions))
      : [];
    const forbidden = customForbidden.length > 0 ? customForbidden : autoForbidden;

    for (const topicId of input.topicIds) {
      const topic = topicById.get(topicId);
      if (!topic) continue;
      for (const angle of input.angles) {
        for (const platformId of input.platformIds) {
          cells.push({
            product_id: productId,
            query_topic_id: topicId,
            platform_profile_id: platformId,
            fact_version_id: latestFact?.id ?? null,
            brief: {
              target_question: topic.canonical_question,
              search_intent: topic.intent_type,
              content_angle: angle,
              target_audience: input.sharedAudience.trim(),
              must_answer_questions: [],
              required_fact_points: [],
              forbidden_expressions: forbidden,
              content_format: input.sharedContentFormat.trim(),
              cta: input.sharedCta.trim(),
              target_keywords: keywords,
              success_metrics: {
                notes: notes || null,
              },
            },
          });
        }
      }
    }
  }
  return cells;
}

function extractBatchPreviewFromError(error: unknown): BatchPreviewResponse | undefined {
  if (!error || typeof error !== 'object' || !('detail' in error)) return undefined;
  const detail = (error as { detail?: { details?: { preview?: unknown } } }).detail;
  const preview = detail?.details?.preview;
  if (!preview || typeof preview !== 'object' || !('cells' in preview)) return undefined;
  return preview as BatchPreviewResponse;
}

export {
  MAX_BATCH_CELLS,
  batchCellStatusRegistry,
  batchDiagnosticLabels,
  batchPlanSearchSchema,
  buildBatchCells,
  extractBatchPreviewFromError,
  parseAngleLines,
  parseKeywordsList,
  parseMultilineItems,
  validateBatchBriefInputs,
};
export type {
  BatchBriefValidationInput,
  BatchCellInput,
  BatchCellStatus,
  BatchCreateResponse,
  BatchDiagnostic,
  BatchPlanSearch,
  BatchPreviewResponse,
};
