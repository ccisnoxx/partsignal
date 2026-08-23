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

function formatWorkbenchRate(rate: WorkbenchRate) {
  if (rate.value === null) return '暂无数据';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate.value);
}

function formatWorkbenchDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

export {
  attentionPresentations,
  formatWorkbenchDateTime,
  formatWorkbenchRate,
  geoRateLabels,
  healthDomainLabels,
  healthStatusPresentations,
  resolveWorkbenchCounts,
  workbenchCountLabels,
};
