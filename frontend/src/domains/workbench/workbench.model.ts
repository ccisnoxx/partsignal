import type { components } from '@/shared/api/generated/schema';

type WorkbenchActionableCounts = components['schemas']['WorkbenchActionableCounts'];
type WorkbenchAttentionItem = components['schemas']['WorkbenchAttentionItem'];
type WorkbenchLink = components['schemas']['WorkbenchLink'];
type WorkbenchRate = components['schemas']['WorkbenchRate'];
type WorkbenchWorkflowHealth = components['schemas']['WorkbenchWorkflowHealth'];
type WorkbenchWorkflowHealthItem = components['schemas']['WorkbenchWorkflowHealthItem'];
type CountKey = keyof WorkbenchActionableCounts;
type AttentionCategory = WorkbenchAttentionItem['category'];
type HealthDomain = keyof WorkbenchWorkflowHealth;
type HealthStatus = WorkbenchWorkflowHealthItem['status'];
type BadgeTone = 'destructive' | 'info' | 'success' | 'warning';

const workbenchCountLabels = {
  fact_reviews: '事实审核',
  content_reviews: '内容审核',
  publication_verifications: '待核验发布',
  publication_actions: '发布处理',
  content_issues: '内容问题',
  geo_accuracy_issues: 'GEO 准确性问题',
} satisfies Record<CountKey, string>;

const attentionPresentations = {
  FACT_REVIEW: { label: '事实审核', tone: 'info' },
  CONTENT_REVIEW: { label: '内容审核', tone: 'info' },
  PUBLICATION_VERIFICATION: { label: '发布核验', tone: 'warning' },
  PUBLICATION_ACTION: { label: '发布处理', tone: 'warning' },
  CONTENT_ISSUE: { label: '内容问题', tone: 'destructive' },
  GEO_ACCURACY_ISSUE: { label: 'GEO 准确性问题', tone: 'destructive' },
} satisfies Record<AttentionCategory, { label: string; tone: BadgeTone }>;

const healthDomainLabels = {
  product_facts: '产品事实',
  content: '内容生产',
  publication: '发布管理',
  geo: 'GEO',
} satisfies Record<HealthDomain, string>;

const healthStatusPresentations = {
  CLEAR: { label: '正常', tone: 'success' },
  ATTENTION: { label: '需关注', tone: 'warning' },
} satisfies Record<HealthStatus, { label: string; tone: BadgeTone }>;

const geoRateLabels = {
  discovery_rate: '发现率',
  mention_rate: '提及率',
  accuracy_rate: '准确率',
} satisfies Record<keyof components['schemas']['WorkbenchGeoSummary'] & `${string}_rate`, string>;

type WorkbenchCountCard = {
  key: CountKey;
  label: string;
  value: number;
  links: readonly WorkbenchLink[];
};

function resolveWorkbenchCounts(counts: WorkbenchActionableCounts): WorkbenchCountCard[] {
  return [
    singleCount('fact_reviews', counts.fact_reviews),
    singleCount('content_reviews', counts.content_reviews),
    singleCount('publication_verifications', counts.publication_verifications),
    {
      key: 'publication_actions',
      label: workbenchCountLabels.publication_actions,
      value: counts.publication_actions.value,
      links: counts.publication_actions.links,
    },
    singleCount('content_issues', counts.content_issues),
    {
      key: 'geo_accuracy_issues',
      label: workbenchCountLabels.geo_accuracy_issues,
      value: counts.geo_accuracy_issues.value,
      links: counts.geo_accuracy_issues.links,
    },
  ];
}

function singleCount(
  key: Exclude<CountKey, 'publication_actions' | 'geo_accuracy_issues'>,
  count: components['schemas']['WorkbenchCount'],
): WorkbenchCountCard {
  return {
    key,
    label: workbenchCountLabels[key],
    value: count.value,
    // canonical href 由服务端拥有；这里仅补充单链接合同没有携带的展示文案。
    links: [{ label: `查看${workbenchCountLabels[key]}`, href: count.href }],
  };
}

type WorkbenchInboxBucket = components['schemas']['WorkbenchInbox']['active_bucket'];
type WorkbenchInboxItemKind = components['schemas']['WorkbenchInboxItem']['item_kind'];
type WorkPriority = components['schemas']['WorkAssignmentOut']['priority'];
type WorkAssignmentTargetType = components['schemas']['WorkAssignmentDetail']['target_type'];

const inboxBucketOrder: readonly WorkbenchInboxBucket[] = [
  'assigned_to_me',
  'due_today',
  'overdue',
  'pending_review',
  'awaiting_publication',
  'awaiting_verification',
  'needs_fix',
  'high_priority_geo_opportunities',
];

const inboxBucketLabels: Record<WorkbenchInboxBucket, string> = {
  assigned_to_me: '分配给我的',
  due_today: '今日到期',
  overdue: '已经超时',
  pending_review: '等待审核',
  awaiting_publication: '等待发布',
  awaiting_verification: '等待核验',
  needs_fix: '需要修复',
  high_priority_geo_opportunities: '高优先级 GEO 机会',
};

const inboxItemKindPresentations: Record<
  WorkbenchInboxItemKind,
  { label: string; tone: BadgeTone }
> = {
  FACT_REVIEW: { label: '事实审核', tone: 'info' },
  CONTENT_TASK: { label: '内容任务', tone: 'info' },
  CONTENT_REVIEW: { label: '内容审核', tone: 'info' },
  PUBLICATION_WORK: { label: '人工发布', tone: 'warning' },
  PUBLICATION_VERIFICATION: { label: '发布核验', tone: 'warning' },
  CONTENT_ISSUE: { label: '发布问题', tone: 'destructive' },
  OVERDUE_FACT: { label: '事实到期', tone: 'destructive' },
  GEO_OPPORTUNITY: { label: 'GEO 机会', tone: 'warning' },
};

const inboxPriorityPresentations: Record<
  WorkPriority,
  { label: string; tone: 'secondary' | 'info' | 'warning' | 'destructive' }
> = {
  LOW: { label: '低', tone: 'secondary' },
  MEDIUM: { label: '中', tone: 'info' },
  HIGH: { label: '高', tone: 'warning' },
  CRITICAL: { label: '紧急', tone: 'destructive' },
};

function formatWorkbenchRate(rate: WorkbenchRate) {
  if (rate.value === null) return '暂无数据';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate.value);
}

function resolveWorkbenchTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof detected === 'string' && detected.trim().length > 0 && detected.length <= 64) {
      return detected;
    }
  } catch {
    // 缺少 Intl 时区支持时回退至默认东八区。
  }
  return 'Asia/Shanghai';
}

function formatWorkbenchDateTime(value: string, timeZone?: string) {
  const date = new Date(value);
  if (!timeZone) return date.toLocaleString('zh-CN');
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleString('zh-CN');
  }
}

export {
  attentionPresentations,
  formatWorkbenchDateTime,
  formatWorkbenchRate,
  geoRateLabels,
  healthDomainLabels,
  healthStatusPresentations,
  inboxBucketLabels,
  inboxBucketOrder,
  inboxItemKindPresentations,
  inboxPriorityPresentations,
  resolveWorkbenchCounts,
  resolveWorkbenchTimezone,
};
export type {
  WorkAssignmentTargetType,
  WorkPriority,
  WorkbenchInboxBucket,
  WorkbenchInboxItemKind,
};
