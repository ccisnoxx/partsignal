import type { components } from '@/shared/api/generated/schema';

const publicationIds = {
  account: '10000000-0000-4000-8000-000000000001',
  accountNoStart: '10000000-0000-4000-8000-000000000002',
  contentVersion: '20000000-0000-4000-8000-000000000001',
  contentVersionNoAccount: '20000000-0000-4000-8000-000000000002',
  event: '30000000-0000-4000-8000-000000000001',
  factVersion: '40000000-0000-4000-8000-000000000001',
  platform: '50000000-0000-4000-8000-000000000001',
  product: '60000000-0000-4000-8000-000000000001',
  task: '70000000-0000-4000-8000-000000000001',
  taskNoAccount: '70000000-0000-4000-8000-000000000002',
  user: '80000000-0000-4000-8000-000000000001',
  work: '90000000-0000-4000-8000-000000000001',
} as const;

const contentVersion = {
  id: publicationIds.contentVersion,
  task_id: publicationIds.task,
  fact_version_id: publicationIds.factVersion,
  source_job_id: null,
  based_on_id: null,
  version: 3,
  source_type: 'HUMAN',
  title: '如何选择低噪声放大器',
  summary: '批准内容摘要',
  body_markdown: '# 已批准内容',
  tags: ['LNA'],
  content_hash: 'approved-hash',
  status: 'APPROVED',
  workflow_stage: 'CURRENT_APPROVED',
  primary_task: 'START_PUBLICATION',
  available_actions: ['CREATE_REVISION'],
  revision: 4,
  quality_issues: [],
  created_by: publicationIds.user,
  created_at: '2026-08-10T01:00:00Z',
} satisfies components['schemas']['ContentVersion'];

const account = {
  platform_profile_id: publicationIds.platform,
  label: '工程师社区主账号',
  account_identifier: '@partsignal',
  id: publicationIds.account,
  is_active: true,
  workflow_stage: 'OPERATIONAL',
  primary_task: 'MANAGE_ACCOUNT',
  available_actions: ['UPDATE', 'DISABLE'],
  deletion: null,
  revision: 2,
} satisfies components['schemas']['PlatformAccount'];

const readyItem = {
  content_version: contentVersion,
  task_id: publicationIds.task,
  platform_profile_id: publicationIds.platform,
  platform_profile_name: '工程师社区',
  matching_accounts: [account],
  available_actions: ['START'],
  primary_task: 'START_PUBLICATION',
} satisfies components['schemas']['PublicationReadyItem'];

const noAccountReadyItem = {
  ...readyItem,
  content_version: {
    ...contentVersion,
    id: publicationIds.contentVersionNoAccount,
    task_id: publicationIds.taskNoAccount,
    title: '没有发布账号的批准内容',
  },
  task_id: publicationIds.taskNoAccount,
  matching_accounts: [],
  available_actions: [],
} satisfies components['schemas']['PublicationReadyItem'];

const latestEvent = {
  id: publicationIds.event,
  action: 'CREATED',
  from_status: null,
  to_status: 'PREPARING',
  from_content_version_id: null,
  to_content_version_id: publicationIds.contentVersion,
  comment: '从批准内容开始发布',
  actor_id: publicationIds.user,
  created_at: '2026-08-11T02:00:00Z',
} satisfies components['schemas']['PublicationWorkEvent'];

const workListItem = {
  id: publicationIds.work,
  task_id: publicationIds.task,
  content_version_id: publicationIds.contentVersion,
  content_title: contentVersion.title,
  content_version: contentVersion.version,
  product: {
    id: publicationIds.product,
    brand: 'PartSignal',
    part_number: 'PS-LNA-01',
  },
  platform_profile_id: publicationIds.platform,
  platform_profile_name: '工程师社区',
  platform_account_id: publicationIds.account,
  platform_account_label: account.label,
  account_identifier: account.account_identifier,
  actual_title: null,
  final_url: null,
  published_at: null,
  status: 'PREPARING',
  revision: 0,
  close_reason: null,
  close_comment: null,
  created_at: '2026-08-11T02:00:00Z',
  updated_at: '2026-08-11T02:00:00Z',
  latest_event: latestEvent,
  latest_verification_outcome: null,
  latest_verification_at: null,
  workflow_stage: 'PREPARING',
  primary_task: 'CONTINUE_PREPARATION',
  available_actions: ['UPDATE_PREPARATION', 'MARK_PLATFORM_REVIEW', 'CLOSE'],
} satisfies components['schemas']['PublicationWorkListItem'];

const createdWork = {
  ...workListItem,
  content_hash: contentVersion.content_hash,
  closed_by: null,
  closed_at: null,
  created_by: publicationIds.user,
  events: [latestEvent],
  verifications: [],
  attachments: [],
} satisfies components['schemas']['PublicationWork'];

const publicationSummary = {
  ready_count: 2,
  active_count: 7,
  awaiting_verification_count: 3,
  action_required_count: 1,
  open_issue_count: 99,
} satisfies components['schemas']['PublicationWorkbenchSummary'];

export {
  account,
  createdWork,
  noAccountReadyItem,
  publicationIds,
  publicationSummary,
  readyItem,
  workListItem,
};
