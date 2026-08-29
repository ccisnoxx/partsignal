import type { components } from '@/shared/api/generated/schema';
import { articleIds, publishedArticle } from './published-article.test-fixtures';

const issueIds = {
  issue: 'b0000000-0000-4000-8000-00000000000b',
  repairTask: 'c0000000-0000-4000-8000-00000000000c',
} as const;

const issueListItem = {
  id: issueIds.issue,
  kind: 'CONTENT_CHANGED',
  description: '公开页面正文与首次核验快照不一致。',
  status: 'OPEN',
  opened_at: '2026-08-12T01:00:00Z',
  resolved_at: null,
  resolution_outcome: null,
  resolution_comment: null,
  published_article_id: articleIds.article,
  content_title: publishedArticle.content_title,
  platform_profile_name: publishedArticle.platform_profile_name,
  actual_title: publishedArticle.actual_title,
  final_url: publishedArticle.final_url,
  revision: 0,
  repair_task_id: null,
  workflow_stage: 'OPEN',
  primary_task: 'HANDLE_CONTENT_ISSUE',
  available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'],
} satisfies components['schemas']['PublishedContentIssueListItem'];

const issue = {
  ...issueListItem,
  opened_by: articleIds.actor,
  resolved_by: null,
  article: publishedArticle,
} satisfies components['schemas']['PublishedContentIssue'];

const issueWorkspace = {
  issue,
  article: publishedArticle,
  repair_task: null,
} satisfies components['schemas']['PublishedContentIssueWorkspaceContext'];

const repairTask = {
  product_id: articleIds.product,
  fact_version_id: articleIds.fact,
  platform_profile_id: 'd0000000-0000-4000-8000-00000000000d',
  id: issueIds.repairTask,
  query_topic_id: null,
  source_published_content_issue_id: issueIds.issue,
  current_content_version_id: null,
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  available_actions: ['CANCEL'],
  deletion: null,
  status: 'OPEN',
  revision: 0,
  created_by: articleIds.actor,
  created_at: '2026-08-12T02:00:00Z',
  archived_at: null,
} satisfies components['schemas']['ContentTask'];

const factVersion = {
  id: articleIds.fact,
  product_id: articleIds.product,
  version: 2,
  status: 'APPROVED',
  body_markdown: '# 已批准事实\n\n典型工作电压为 3.3 V。',
  classification: 'PUBLIC',
  change_summary: '批准修复依据',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_by: articleIds.actor,
  approved_by: articleIds.actor,
  created_at: '2026-08-09T00:00:00Z',
  approved_at: '2026-08-09T01:00:00Z',
} satisfies components['schemas']['FactVersion'];

const repairContext = {
  issue,
  article: publishedArticle,
  original_task: { ...repairTask, id: articleIds.task, source_published_content_issue_id: null },
  product: {
    id: articleIds.product,
    part_number: 'PS-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_APPROVED',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['UPDATE'],
    deletion: null,
    revision: 1,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  },
  query_topic: null,
  platform_profile_id: 'd0000000-0000-4000-8000-00000000000d',
  platform_profile_name: publishedArticle.platform_profile_name,
  original_fact_version: factVersion,
  fact_candidates: [{
    version: factVersion,
    difference: { from_id: factVersion.id, to_id: factVersion.id, changes: [] },
  }],
} satisfies components['schemas']['PublishedContentRepairContext'];

export {
  issue,
  issueIds,
  issueListItem,
  issueWorkspace,
  repairContext,
  repairTask,
};
