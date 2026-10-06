import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

type Run = components['schemas']['GeoRunListItem'];
type Batch = components['schemas']['GeoBatchListItem'];
type RunParams = NonNullable<operations['listGeoObservationRuns']['parameters']['query']>;
type BatchParams = NonNullable<operations['listGeoObservationBatches']['parameters']['query']>;
const runStatusLabels = {
  PENDING: '待采集',
  RUNNING: '采集中',
  COLLECTED: '已采集',
  ANALYZING: '分析中',
  NEEDS_REVIEW: '待复核',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  BUDGET_BLOCKED: '预算阻断',
} satisfies Record<Run['status'], string>;
const batchStatusLabels = {
  PLANNED: '准备中',
  QUEUED: '已排队',
  RUNNING: '进行中',
  COMPLETED: '已完成',
  PARTIAL: '部分完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  BUDGET_BLOCKED: '预算阻断',
} satisfies Record<Batch['status'], string>;
const modeLabels = { MANUAL: '人工录入', API: 'API', BROWSER: '浏览器' } satisfies Record<
  components['schemas']['GeoCollectionMode'],
  string
>;
const runPrimaryLabels = {
  ENTER_MANUAL_OBSERVATION: '人工录入',
  VIEW_EXECUTION_PROGRESS: '运行进度',
  VIEW_REVIEW: '查看复核',
  VIEW_OBSERVATION: '查看观测',
  HANDLE_FAILURE: '处理失败',
  VIEW_FAILURE: '查看失败',
} satisfies Record<Run['primary_task'], string>;
const batchPrimaryLabels = {
  VIEW_EXECUTION_PROGRESS: '运行进度',
  ENTER_MANUAL_OBSERVATIONS: '待人工录入',
  VIEW_RESULTS: '批次结果',
  HANDLE_FAILURE: '失败明细',
} satisfies Record<Batch['primary_task'], string>;
const runStatuses = z.enum([
  'PENDING',
  'RUNNING',
  'COLLECTED',
  'ANALYZING',
  'NEEDS_REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_BLOCKED',
]);
const batchStatuses = z.enum([
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
  'BUDGET_BLOCKED',
]);
const errors = z.enum([
  'COLLECTOR_CONFIGURATION_INVALID',
  'COLLECTOR_DISABLED',
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RESPONSE_INVALID',
  'PROVIDER_RESPONSE_TOO_LARGE',
  'COLLECTOR_UNKNOWN_OUTCOME',
  'DATA_CLASSIFICATION_FORBIDDEN',
  'PROFILE_NEEDS_REAUTH',
  'WORKER_LOST',
  'BUDGET_EXCEEDED',
  'ANALYSIS_FAILED',
  'REVIEW_FAILED',
]);
const ids = [
  'plan_id',
  'subject_id',
  'product_id',
  'query_topic_id',
  'prompt_variant_id',
  'collection_profile_id',
  'engine_surface_id',
  'batch_id',
  'run_id',
] as const;
const shape = z.object({
  view: z.literal('runs').optional(),
  q: z.string().optional(),
  plan_id: canonicalUuidSchema.optional(),
  subject_id: canonicalUuidSchema.optional(),
  product_id: canonicalUuidSchema.optional(),
  query_topic_id: canonicalUuidSchema.optional(),
  prompt_variant_id: canonicalUuidSchema.optional(),
  collection_profile_id: canonicalUuidSchema.optional(),
  engine_surface_id: canonicalUuidSchema.optional(),
  batch_id: canonicalUuidSchema.optional(),
  run_id: canonicalUuidSchema.optional(),
  status: runStatuses.optional(),
  batch_status: batchStatuses.optional(),
  collection_mode: z.enum(['MANUAL', 'API', 'BROWSER']).optional(),
  trigger_type: z.enum(['MANUAL', 'SCHEDULED', 'RETEST']).optional(),
  error_code: errors.optional(),
  needs_review: z.boolean().optional(),
  latest_only: z.literal(false).optional(),
  created_from: z.string().optional(),
  created_to: z.string().optional(),
  sort: z.literal('CREATED_ASC').optional(),
  page: z.number().optional(),
  page_size: z.union([z.literal(10), z.literal(50)]).optional(),
  edit: z.literal(1).optional(),
  create: z.literal(1).optional(),
});
function enumValue<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}
function date(value: unknown) {
  const result = z.iso.datetime({ offset: true }).safeParse(value);
  return result.success ? new Date(result.data).toISOString() : undefined;
}
function boolean(value: unknown) {
  return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
}
const runSearchSchema = z.preprocess((value) => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const normalized: Record<string, unknown> = {};
  for (const id of ids) normalized[id] = enumValue(canonicalUuidSchema, raw[id]);
  const from = date(raw.created_from);
  const to = date(raw.created_to);
  const page = Number(raw.page);
  const size = Number(raw.page_size);
  Object.assign(normalized, {
    view: raw.view === 'runs' ? 'runs' : undefined,
    q:
      typeof raw.q === 'string' && !raw.q.includes('\0') && raw.q.trim().length <= 200
        ? raw.q.trim() || undefined
        : undefined,
    status: enumValue(runStatuses, raw.status),
    batch_status: enumValue(batchStatuses, raw.batch_status),
    collection_mode: enumValue(z.enum(['MANUAL', 'API', 'BROWSER']), raw.collection_mode),
    trigger_type: enumValue(z.enum(['MANUAL', 'SCHEDULED', 'RETEST']), raw.trigger_type),
    error_code: enumValue(errors, raw.error_code),
    needs_review: boolean(raw.needs_review),
    latest_only: boolean(raw.latest_only) === false ? false : undefined,
    created_from: from && to && from >= to ? undefined : from,
    created_to: from && to && from >= to ? undefined : to,
    sort: raw.sort === 'CREATED_ASC' ? 'CREATED_ASC' : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    page_size: size === 10 || size === 50 ? size : undefined,
    edit:
      !(raw.create === 1 || raw.create === '1') && normalized.run_id && (raw.edit === 1 || raw.edit === '1')
        ? 1
        : undefined,
    create: raw.create === 1 || raw.create === '1' ? 1 : undefined,
  });
  if (normalized.create) normalized.run_id = undefined;
  return Object.fromEntries(Object.entries(normalized).filter(([, entry]) => entry !== undefined));
}, shape);
type RunSearch = z.output<typeof runSearchSchema>;
function readParams(search: RunSearch) {
  return {
    q: search.q,
    created_from: search.created_from,
    created_to: search.created_to,
    sort: search.sort ?? 'CREATED_DESC',
    page: search.page ?? 1,
    page_size: search.page_size ?? 20,
  } as const;
}
function runSearchToParams(search: RunSearch): RunParams {
  return {
    ...readParams(search),
    plan_id: search.plan_id,
    subject_id: search.subject_id,
    product_id: search.product_id,
    query_topic_id: search.query_topic_id,
    prompt_variant_id: search.prompt_variant_id,
    collection_profile_id: search.collection_profile_id,
    engine_surface_id: search.engine_surface_id,
    batch_id: search.batch_id,
    collection_mode: search.collection_mode,
    status: search.status,
    error_code: search.error_code,
    needs_review: search.needs_review,
    latest_only: search.latest_only ?? true,
  };
}
function batchSearchToParams(search: RunSearch): BatchParams {
  return {
    ...readParams(search),
    plan_id: search.plan_id,
    subject_id: search.subject_id,
    status: search.batch_status,
    trigger_type: search.trigger_type,
  };
}
function isCanonicalRunSearch(raw: Record<string, unknown>, search: RunSearch) {
  return (
    Object.keys(raw).length === Object.keys(search).length &&
    Object.entries(search).every(([key, value]) => String(raw[key]) === String(value))
  );
}
// 仅决定读取频率；动作与转换仍以服务端workflow投影为准。
function runPollInterval(stage: Run['workflow_stage']): number | false {
  switch (stage) {
    case 'QUEUED':
    case 'COLLECTION_IN_PROGRESS':
    case 'ANALYSIS_PENDING':
    case 'ANALYSIS_IN_PROGRESS':
      return 5000;
    case 'MANUAL_ENTRY_REQUIRED':
    case 'REVIEW_REQUIRED':
    case 'COMPLETED':
    case 'RETRYABLE_FAILURE':
    case 'HISTORICAL_FAILURE':
    case 'CANCELLED':
    case 'BUDGET_BLOCKED':
      return false;
  }
}
function batchPollInterval(stage: Batch['workflow_stage']): number | false {
  switch (stage) {
    case 'PREPARING':
    case 'QUEUED':
    case 'IN_PROGRESS':
      return 5000;
    case 'MANUAL_ENTRY_REQUIRED':
    case 'COMPLETED':
    case 'PARTIAL':
    case 'FAILED':
    case 'CANCELLED':
    case 'BUDGET_BLOCKED':
      return false;
  }
}
function timestamp(value: string | null) {
  return value === null ? '未记录' : new Date(value).toLocaleString('zh-CN', { hour12: false });
}
function runCost(run: Pick<Run, 'cost_amount' | 'cost_currency'>) {
  return run.cost_amount === null ? '未知' : `${run.cost_amount} ${run.cost_currency}`;
}
export {
  batchPollInterval,
  batchPrimaryLabels,
  batchSearchToParams,
  batchStatusLabels,
  isCanonicalRunSearch,
  modeLabels,
  runCost,
  runPollInterval,
  runPrimaryLabels,
  runSearchSchema,
  runSearchToParams,
  runStatusLabels,
  timestamp,
};
export type { Batch, BatchParams, Run, RunParams, RunSearch };
