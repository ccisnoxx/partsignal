import { z } from 'zod';

import type { components, operations } from '@/shared/api/generated/schema';

type ContentCampaignStatus = components['schemas']['ContentCampaignListItem']['status'];
type WorkPriority = components['schemas']['ContentCampaignListItem']['priority'];
type ContentCampaignPrimaryTask = components['schemas']['ContentCampaignListItem']['primary_task'];
type ContentCampaignAction = components['schemas']['ContentCampaignListItem']['available_actions'][number];
type ContentCampaignListItem = components['schemas']['ContentCampaignListItem'];
type ContentCampaignDetail = components['schemas']['ContentCampaignDetail'];
type ContentCampaignCreate = components['schemas']['ContentCampaignCreate'];
type ContentCampaignUpdate = components['schemas']['ContentCampaignUpdate'];
type ContentCampaignOptions = components['schemas']['ContentCampaignOptions'];
type ContentCampaignListApiParams = NonNullable<
  operations['listContentCampaigns']['parameters']['query']
>;

type BadgeTone = 'outline' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive';

const campaignStatusValues = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const satisfies readonly ContentCampaignStatus[];

const workPriorityValues = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const satisfies readonly WorkPriority[];

const campaignStatusRegistry = {
  DRAFT: { label: '草稿', tone: 'outline' },
  ACTIVE: { label: '进行中', tone: 'success' },
  PAUSED: { label: '已暂停', tone: 'warning' },
  COMPLETED: { label: '已完成', tone: 'info' },
  ARCHIVED: { label: '已归档', tone: 'secondary' },
} satisfies Record<ContentCampaignStatus, { label: string; tone: BadgeTone }>;

const workPriorityRegistry = {
  LOW: { label: '低', tone: 'outline' },
  MEDIUM: { label: '中', tone: 'secondary' },
  HIGH: { label: '高', tone: 'warning' },
  CRITICAL: { label: '紧急', tone: 'destructive' },
} satisfies Record<WorkPriority, { label: string; tone: BadgeTone }>;

const campaignPrimaryTaskLabels = {
  CONFIGURE_CAMPAIGN: '完善活动范围',
  ACTIVATE_CAMPAIGN: '激活活动',
  MANAGE_CAMPAIGN: '推进内容与任务',
  RESUME_CAMPAIGN: '恢复活动',
  ARCHIVE_CAMPAIGN: '归档活动',
  VIEW_HISTORY: '查看历史',
} satisfies Record<ContentCampaignPrimaryTask, string>;

function normalizeSearchText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function normalizeStatus(value: unknown) {
  return typeof value === 'string' && campaignStatusValues.some((item) => item === value)
    ? value
    : undefined;
}

function normalizePriority(value: unknown) {
  return typeof value === 'string' && workPriorityValues.some((item) => item === value)
    ? value
    : undefined;
}

const campaignsSearchSchema = z.object({
  q: z.preprocess(normalizeSearchText, z.string().max(200).optional()),
  status: z.preprocess(normalizeStatus, z.enum(campaignStatusValues).optional()),
  priority: z.preprocess(normalizePriority, z.enum(workPriorityValues).optional()),
  page: z.coerce.number().int().positive().catch(1).default(1),
  pageSize: z.coerce.number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .catch(20)
    .default(20),
});

type CampaignsSearch = z.output<typeof campaignsSearchSchema>;

function campaignsSearchToApiParams(search: CampaignsSearch): ContentCampaignListApiParams {
  return {
    q: search.q,
    status: search.status,
    priority: search.priority,
    page: search.page,
    page_size: search.pageSize,
  };
}

const budgetPattern = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;
const currencyPattern = /^[A-Z]{3}$/;

function optionalRateField(label: string) {
  return z.string().trim().refine((value) => {
    if (!value) return true;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
  }, `${label}需为 0 到 100 的数字`);
}

const campaignFormSchema = z.object({
  name: z.string().trim().min(1, '请填写活动名称').max(200, '活动名称不能超过 200 字'),
  description: z.string().trim().max(4000, '活动说明不能超过 4000 字'),
  target_audience: z.string().trim().max(500, '目标受众不能超过 500 字'),
  owner_id: z.string().min(1, '请选择活动负责人').pipe(z.uuid('请选择有效的活动负责人')),
  priority: z.enum(workPriorityValues),
  start_date: z.string().trim(),
  end_date: z.string().trim(),
  budget_amount: z.string().trim(),
  budget_currency: z.string().trim(),
  target_content_count: z.string().trim().refine((value) => {
    if (!value) return true;
    return /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 10000;
  }, '目标内容篇数需为 1 到 10000 的整数'),
  target_discovery_pct: optionalRateField('目标发现率'),
  target_mention_pct: optionalRateField('目标提及率'),
  target_recommendation_pct: optionalRateField('目标推荐率'),
  target_citation_pct: optionalRateField('目标引用率'),
  product_ids: z.array(z.uuid()),
  query_topic_ids: z.array(z.uuid()),
  platform_profile_ids: z.array(z.uuid()),
  monitoring_plan_ids: z.array(z.uuid()),
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.start_date > value.end_date) {
    ctx.addIssue({
      code: 'custom',
      path: ['end_date'],
      message: '结束日期不能早于开始日期',
    });
  }
  const hasAmount = value.budget_amount.length > 0;
  const hasCurrency = value.budget_currency.length > 0;
  if (hasAmount !== hasCurrency) {
    ctx.addIssue({
      code: 'custom',
      path: [hasAmount ? 'budget_currency' : 'budget_amount'],
      message: '预算金额与币种必须同时填写或同时留空',
    });
  }
  if (hasAmount && !budgetPattern.test(value.budget_amount)) {
    ctx.addIssue({
      code: 'custom',
      path: ['budget_amount'],
      message: '预算金额必须为非负数字，最多保留两位小数',
    });
  }
  if (hasCurrency && !currencyPattern.test(value.budget_currency.toUpperCase())) {
    ctx.addIssue({
      code: 'custom',
      path: ['budget_currency'],
      message: '币种需为 3 位大写字母（如 CNY、USD）',
    });
  }
});

type CampaignFormValues = z.infer<typeof campaignFormSchema>;

function rateToPctString(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String(Math.round(value * 10000) / 100);
}

function pctStringToRate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Math.round((Number(trimmed) / 100) * 10000) / 10000;
}

function defaultCampaignFormValues(
  ownerId: string,
  detail?: ContentCampaignDetail,
): CampaignFormValues {
  if (!detail) {
    return {
      name: '',
      description: '',
      target_audience: '',
      owner_id: ownerId,
      priority: 'MEDIUM',
      start_date: '',
      end_date: '',
      budget_amount: '',
      budget_currency: '',
      target_content_count: '',
      target_discovery_pct: '',
      target_mention_pct: '',
      target_recommendation_pct: '',
      target_citation_pct: '',
      product_ids: [],
      query_topic_ids: [],
      platform_profile_ids: [],
      monitoring_plan_ids: [],
    };
  }
  return {
    name: detail.name,
    description: detail.description,
    target_audience: detail.target_audience,
    owner_id: detail.owner.id,
    priority: detail.priority,
    start_date: detail.start_date ?? '',
    end_date: detail.end_date ?? '',
    budget_amount: detail.budget_amount ?? '',
    budget_currency: detail.budget_currency ?? '',
    target_content_count: detail.target_metrics.target_content_count
      ? String(detail.target_metrics.target_content_count)
      : '',
    target_discovery_pct: rateToPctString(detail.target_metrics.target_discovery_rate),
    target_mention_pct: rateToPctString(detail.target_metrics.target_mention_rate),
    target_recommendation_pct: rateToPctString(detail.target_metrics.target_recommendation_rate),
    target_citation_pct: rateToPctString(detail.target_metrics.target_citation_rate),
    product_ids: detail.products.map((item) => item.id),
    query_topic_ids: detail.topics.map((item) => item.id),
    platform_profile_ids: detail.platforms.map((item) => item.id),
    monitoring_plan_ids: detail.monitoring_plans.map((item) => item.id),
  };
}

function toCampaignCreatePayload(values: CampaignFormValues): ContentCampaignCreate {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    target_audience: values.target_audience.trim(),
    owner_id: values.owner_id,
    priority: values.priority,
    start_date: values.start_date.trim() || null,
    end_date: values.end_date.trim() || null,
    budget_amount: values.budget_amount.trim() || null,
    budget_currency: values.budget_currency.trim() ? values.budget_currency.trim().toUpperCase() : null,
    target_metrics: {
      target_content_count: values.target_content_count.trim()
        ? Number(values.target_content_count.trim())
        : null,
      target_discovery_rate: pctStringToRate(values.target_discovery_pct),
      target_mention_rate: pctStringToRate(values.target_mention_pct),
      target_recommendation_rate: pctStringToRate(values.target_recommendation_pct),
      target_citation_rate: pctStringToRate(values.target_citation_pct),
    },
    product_ids: values.product_ids,
    query_topic_ids: values.query_topic_ids,
    platform_profile_ids: values.platform_profile_ids,
    monitoring_plan_ids: values.monitoring_plan_ids,
  };
}

function toCampaignUpdatePayload(
  values: CampaignFormValues,
  expectedRevision: number,
): ContentCampaignUpdate {
  const base = toCampaignCreatePayload(values);
  return {
    ...base,
    owner_id: values.owner_id,
    expected_revision: expectedRevision,
  };
}

function formatRatePercent(value: number | null | undefined) {
  if (value === null || value === undefined) return '未设定';
  return `${Math.round(value * 1000) / 10}%`;
}

export {
  campaignFormSchema,
  campaignPrimaryTaskLabels,
  campaignStatusRegistry,
  campaignStatusValues,
  campaignsSearchSchema,
  campaignsSearchToApiParams,
  defaultCampaignFormValues,
  formatRatePercent,
  toCampaignCreatePayload,
  toCampaignUpdatePayload,
  workPriorityRegistry,
  workPriorityValues,
};
export type {
  CampaignFormValues,
  CampaignsSearch,
  ContentCampaignAction,
  ContentCampaignCreate,
  ContentCampaignDetail,
  ContentCampaignListApiParams,
  ContentCampaignListItem,
  ContentCampaignOptions,
  ContentCampaignPrimaryTask,
  ContentCampaignStatus,
  ContentCampaignUpdate,
  WorkPriority,
};
