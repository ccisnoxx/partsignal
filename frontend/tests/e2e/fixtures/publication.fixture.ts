/** Publication Work List 的 production-artifact API fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type SurfaceMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode = 'success' | 'conflict' | 'pending';
type CommandMode = 'success' | 'conflict' | 'pending';
type WorkspaceErrorStatus = 401 | 403 | 404 | 409 | 422;
type ArticleListMode = 'success' | 'empty' | 'error';
type CreateRequest = {
  body: components['schemas']['PublicationWorkCreate'];
  csrfToken: string | null;
  idempotencyKey: string | null;
};
type PublicationApiController = {
  commandRequests: Array<{ method: string; path: string; body: unknown; csrfToken: string | null }>;
  articleListRequests: URL[];
  articleRequests: URL[];
  createRequests: CreateRequest[];
  issueListRequests: URL[];
  issueRepairRequests: URL[];
  issueWorkspaceRequests: URL[];
  listRequests: URL[];
  packageRequests: URL[];
  readyRequests: URL[];
  summaryRequests: URL[];
  uploadRequests: Array<{ method: string; path: string }>;
  workspaceRequests: URL[];
  releaseCommand: () => void;
  releaseCreate: () => void;
  releaseLoading: () => void;
  setCreateMode: (mode: CreateMode) => void;
  setCommandMode: (mode: CommandMode) => void;
  setArticleDetailError: (status?: WorkspaceErrorStatus) => void;
  setArticleListMode: (mode: ArticleListMode) => void;
  seedIssue: () => void;
  setReadyMode: (mode: SurfaceMode) => void;
  setSummaryMode: (mode: SurfaceMode) => void;
  setSwitchCandidate: () => void;
  setWorkMode: (mode: SurfaceMode) => void;
  setWorkspaceError: (status?: WorkspaceErrorStatus) => void;
};
type PublicationFixtures = { publicationApi: PublicationApiController };
type PublicationWorkspaceContext = components['schemas']['PublicationWorkspaceContext'];
type FileRecord = components['schemas']['FileRecord'];

const publicationIds = {
  account: '10000000-0000-4000-8000-000000000001',
  contentVersion: '20000000-0000-4000-8000-000000000001',
  contentVersionNoAccount: '20000000-0000-4000-8000-000000000002',
  replacementContentVersion: '20000000-0000-4000-8000-000000000003',
  event: '30000000-0000-4000-8000-000000000001',
  factVersion: '40000000-0000-4000-8000-000000000001',
  platform: '50000000-0000-4000-8000-000000000001',
  product: '60000000-0000-4000-8000-000000000001',
  task: '70000000-0000-4000-8000-000000000001',
  taskNoAccount: '70000000-0000-4000-8000-000000000002',
  user: '80000000-0000-4000-8000-000000000001',
  work: '90000000-0000-4000-8000-000000000001',
  issue: 'b0000000-0000-4000-8000-000000000001',
  repairTask: 'c0000000-0000-4000-8000-000000000001',
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
  product: { id: publicationIds.product, brand: 'PartSignal', part_number: 'PS-LNA-01' },
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

const workspaceContext = {
  work: createdWork,
  content: {
    id: contentVersion.id,
    task_id: contentVersion.task_id,
    version: contentVersion.version,
    status: contentVersion.status,
    title: contentVersion.title,
    summary: contentVersion.summary,
    body_markdown: contentVersion.body_markdown,
    tags: contentVersion.tags,
    content_hash: contentVersion.content_hash,
  },
  platform: {
    id: publicationIds.platform,
    name: readyItem.platform_profile_name,
    website_url: 'https://community.example.com/',
  },
  eligible_accounts: [{
    id: account.id,
    label: account.label,
    account_identifier: account.account_identifier,
  }],
  switch_candidate: null,
} satisfies components['schemas']['PublicationWorkspaceContext'];

const publishedArticle = {
  id: publicationIds.work,
  task_id: publicationIds.task,
  product_id: publicationIds.product,
  content_version_id: publicationIds.contentVersion,
  content_title: contentVersion.title,
  content_version: contentVersion.version,
  platform_profile_id: publicationIds.platform,
  platform_profile_name: readyItem.platform_profile_name,
  platform_account_id: publicationIds.account,
  platform_account_label: account.label,
  account_identifier: account.account_identifier,
  actual_title: '公开发布：如何选择低噪声放大器',
  final_url: 'https://community.example.com/articles/lna-selection',
  published_at: '2026-08-11T04:00:00Z',
  verified_at: '2026-08-11T05:00:00Z',
  has_open_issue: false,
  open_issue_id: null,
  retired: false,
  revision: 3,
  workflow_stage: 'HEALTHY',
  primary_task: 'START_PRODUCT_OBSERVATION',
  available_actions: ['OPEN_ISSUE'],
  deletion: null,
  content_hash: contentVersion.content_hash,
  verification: {
    id: 'a1000000-0000-4000-8000-000000000001',
    content_version_id: publicationIds.contentVersion,
    outcome: 'PASSED',
    actual_title_snapshot: '公开发布：如何选择低噪声放大器',
    final_url_snapshot: 'https://community.example.com/articles/lna-selection',
    published_at_snapshot: '2026-08-11T04:00:00Z',
    comment: '公开页面与批准内容一致',
    actor_id: publicationIds.user,
    created_at: '2026-08-11T05:00:00Z',
  },
  source_content: {
    content: {
      id: publicationIds.contentVersion,
      task_id: publicationIds.task,
      fact_version_id: publicationIds.factVersion,
      source_job_id: null,
      based_on_id: null,
      version: contentVersion.version,
      source_type: 'HUMAN',
      status: 'SUPERSEDED',
      is_current: false,
      title: contentVersion.title,
      summary: '首次核验时使用的冻结内容摘要。',
      body_markdown: '# 已批准内容\n\n<script>不得执行</script>\n\n公开发布快照正文。',
      tags: contentVersion.tags,
      content_hash: contentVersion.content_hash,
      change_summary: '完成平台适配',
      creator: {
        id: publicationIds.user,
        username: 'admin',
        display_name: '系统管理员',
      },
      created_at: '2026-08-10T01:00:00Z',
      updated_at: '2026-08-10T02:00:00Z',
    },
    fact_version: {
      id: publicationIds.factVersion,
      product_id: publicationIds.product,
      version: 2,
      status: 'APPROVED',
      classification: 'PUBLIC',
    },
    generation_lineage: null,
    review_result: null,
    review_timeline: [],
  },
  events: [
    latestEvent,
    {
      id: 'a2000000-0000-4000-8000-000000000002',
      action: 'COMPLETED',
      from_status: 'AWAITING_VERIFICATION',
      to_status: 'COMPLETED',
      to_content_version_id: publicationIds.contentVersion,
      from_content_version_id: publicationIds.contentVersion,
      comment: '首次核验通过',
      actor_id: publicationIds.user,
      created_at: '2026-08-11T05:00:00Z',
    },
  ],
  issues: [],
} satisfies components['schemas']['PublishedArticle'];

function createIssue(
  article: components['schemas']['PublishedArticle'],
  kind: components['schemas']['PublishedContentIssueKind'] = 'CONTENT_CHANGED',
  description = '公开页面正文与首次核验快照不一致。',
) {
  return {
    id: publicationIds.issue,
    kind,
    description,
    status: 'OPEN',
    opened_at: '2026-08-12T01:00:00Z',
    resolved_at: null,
    resolution_outcome: null,
    resolution_comment: null,
    published_article_id: article.id,
    content_title: article.content_title,
    platform_profile_name: article.platform_profile_name,
    actual_title: article.actual_title,
    final_url: article.final_url,
    revision: 0,
    repair_task_id: null,
    workflow_stage: 'OPEN',
    primary_task: 'HANDLE_CONTENT_ISSUE',
    available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'],
    opened_by: publicationIds.user,
    resolved_by: null,
    article,
  } satisfies components['schemas']['PublishedContentIssue'];
}

const repairTask = {
  product_id: publicationIds.product,
  fact_version_id: publicationIds.factVersion,
  platform_profile_id: publicationIds.platform,
  id: publicationIds.repairTask,
  query_topic_id: null,
  source_published_content_issue_id: publicationIds.issue,
  current_content_version_id: null,
  workflow_stage: 'NO_DRAFT',
  primary_task: 'CREATE_FIRST_DRAFT',
  available_actions: ['CANCEL'],
  deletion: null,
  status: 'OPEN',
  revision: 0,
  created_by: publicationIds.user,
  created_at: '2026-08-12T02:00:00Z',
  archived_at: null,
} satisfies components['schemas']['ContentTask'];

const repairFactVersion = {
  id: publicationIds.factVersion,
  product_id: publicationIds.product,
  version: 2,
  status: 'APPROVED',
  body_markdown: '# 已批准事实\n\n最新事实内容。',
  classification: 'PUBLIC',
  change_summary: '批准修复依据',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_by: publicationIds.user,
  approved_by: publicationIds.user,
  created_at: '2026-08-09T00:00:00Z',
  approved_at: '2026-08-09T01:00:00Z',
} satisfies components['schemas']['FactVersion'];

function createRepairContext(
  issue: components['schemas']['PublishedContentIssue'],
  article: components['schemas']['PublishedArticle'],
) {
  return {
    issue,
    article,
    original_task: {
      ...repairTask,
      id: publicationIds.task,
      source_published_content_issue_id: null,
    },
    product: {
      id: publicationIds.product,
      part_number: 'PS-LNA-01',
      brand: 'PartSignal',
      category: '放大器',
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
    platform_profile_id: publicationIds.platform,
    platform_profile_name: article.platform_profile_name,
    original_fact_version: repairFactVersion,
    fact_candidates: [{
      version: repairFactVersion,
      difference: {
        from_id: repairFactVersion.id,
        to_id: repairFactVersion.id,
        changes: [],
      },
    }],
  } satisfies components['schemas']['PublishedContentRepairContext'];
}

const switchCandidate = {
  id: publicationIds.replacementContentVersion,
  version: 4,
  title: '如何选择低噪声放大器（修订）',
  summary: '失败核验后的批准修订摘要',
  content_hash: 'replacement-approved-hash',
} satisfies components['schemas']['PublicationWorkspaceVersionCandidate'];

const evidenceFile = {
  id: 'a0000000-0000-4000-8000-000000000001',
  category: 'OPERATION_SCREENSHOT',
  original_filename: 'publication-proof.png',
  object_key: 'evidence/publication-proof.png',
  content_type: 'image/png',
  size: 8,
  sha256: 'fixture-sha256',
  access_level: 'INTERNAL',
  status: 'PENDING',
  created_at: '2026-08-11T03:00:00Z',
} satisfies components['schemas']['FileRecord'];

const user = {
  id: publicationIds.user,
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
} satisfies components['schemas']['User'];

function createWorkItems() {
  return Array.from({ length: 25 }, (_, index): components['schemas']['PublicationWorkListItem'] => ({
    ...workListItem,
    id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    content_title: `${workListItem.content_title} ${String(index + 1).padStart(2, '0')}`,
    updated_at: `2026-08-11T${String(index % 10).padStart(2, '0')}:00:00Z`,
  }));
}

function createArticleItems() {
  return Array.from({ length: 25 }, (_, index): components['schemas']['PublishedArticleListItem'] => ({
    ...publishedArticle,
    id: index === 0
      ? publicationIds.work
      : `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    actual_title: index === 0
      ? publishedArticle.actual_title
      : `发布成果 ${String(index + 1).padStart(2, '0')}`,
    published_at: `2026-08-${String(10 - (index % 5)).padStart(2, '0')}T08:00:00Z`,
  }));
}

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<PublicationFixtures>({
  publicationApi: [async ({ page }, use) => {
    let summaryMode: SurfaceMode = 'success';
    let readyMode: SurfaceMode = 'success';
    let workMode: SurfaceMode = 'success';
    let createMode: CreateMode = 'success';
    let commandMode: CommandMode = 'success';
    let workspaceErrorStatus: WorkspaceErrorStatus | undefined;
    let articleDetailErrorStatus: WorkspaceErrorStatus | undefined;
    let articleListMode: ArticleListMode = 'success';
    let releaseCreate: (() => void) | undefined;
    let releaseCommand: (() => void) | undefined;
    let releaseSummary: (() => void) | undefined;
    let releaseReady: (() => void) | undefined;
    let releaseWorks: (() => void) | undefined;
    let readyItems = [readyItem, noAccountReadyItem];
    let workItems = createWorkItems();
    const articleItems = createArticleItems();
    let currentArticle: components['schemas']['PublishedArticle'] = structuredClone(publishedArticle);
    let currentIssue: components['schemas']['PublishedContentIssue'] | undefined;
    let currentRepairTask: components['schemas']['ContentTask'] | null = null;
    let currentWorkspace: PublicationWorkspaceContext = structuredClone(workspaceContext);
    let currentEvidence: FileRecord = evidenceFile;
    const commandRequests: Array<{ method: string; path: string; body: unknown; csrfToken: string | null }> = [];
    const articleListRequests: URL[] = [];
    const articleRequests: URL[] = [];
    const createRequests: CreateRequest[] = [];
    const issueListRequests: URL[] = [];
    const issueRepairRequests: URL[] = [];
    const issueWorkspaceRequests: URL[] = [];
    const listRequests: URL[] = [];
    const packageRequests: URL[] = [];
    const readyRequests: URL[] = [];
    const summaryRequests: URL[] = [];
    const uploadRequests: Array<{ method: string; path: string }> = [];
    const workspaceRequests: URL[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    function seedCurrentIssue(
      kind: components['schemas']['PublishedContentIssueKind'] = 'CONTENT_CHANGED',
      description?: string,
    ) {
      const opened = createIssue(currentArticle, kind, description);
      currentArticle = {
        ...currentArticle,
        has_open_issue: true,
        open_issue_id: opened.id,
        workflow_stage: 'OPEN_ISSUE',
        primary_task: 'HANDLE_CONTENT_ISSUE',
        available_actions: [],
        issues: [{
          id: opened.id,
          kind: opened.kind,
          description: opened.description,
          status: opened.status,
          opened_at: opened.opened_at,
          resolved_at: opened.resolved_at,
          resolution_outcome: opened.resolution_outcome,
          resolution_comment: opened.resolution_comment,
        }],
      };
      currentIssue = { ...opened, article: currentArticle };
      currentRepairTask = null;
      return currentIssue;
    }

    page.on('console', (message) => {
      if (['401 (Unauthorized)', '403 (Forbidden)', '404 (Not Found)', '409 (Conflict)', '422 (Unprocessable Content)', '422 (Unprocessable Entity)', '503 (Service Unavailable)']
        .some((status) => message.text().includes(status))) return;
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/e2e-storage/**', async (route) => {
      uploadRequests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
      await route.fulfill({ status: 200, body: 'stored' });
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: user });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({
          status: 200,
          json: { csrf_token: 'publication-e2e-csrf' } satisfies components['schemas']['CsrfToken'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/publication-workbench-summary') {
        summaryRequests.push(url);
        if (summaryMode === 'loading') await new Promise<void>((resolve) => { releaseSummary = resolve; });
        if (summaryMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('SUMMARY_UNAVAILABLE', '发布摘要暂不可用', 'req-summary') });
          return;
        }
        await route.fulfill({
          status: 200,
          json: summaryMode === 'empty'
            ? { ...publicationSummary, ready_count: 0, active_count: 0, awaiting_verification_count: 0, action_required_count: 0 }
            : publicationSummary,
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/publication-ready-items') {
        readyRequests.push(url);
        if (readyMode === 'loading') await new Promise<void>((resolve) => { releaseReady = resolve; });
        if (readyMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('READY_UNAVAILABLE', 'Ready Queue 暂不可用', 'req-ready') });
          return;
        }
        await route.fulfill({ status: 200, json: { items: readyMode === 'empty' ? [] : readyItems } });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/published-articles') {
        articleListRequests.push(url);
        if (articleListMode === 'error') {
          await route.fulfill({ status: 409, json: errorEnvelope('PUBLICATION_CONTEXT_INCOMPLETE', '发布成果上下文不完整', 'req-articles') });
          return;
        }
        const search = url.searchParams.get('search')?.toLocaleLowerCase();
        const filtered = articleListMode === 'empty'
          ? []
          : articleItems.filter((item) => !search || [
            item.actual_title,
            item.content_title,
            item.final_url,
            item.platform_profile_name,
            item.platform_account_label,
            item.account_identifier,
          ].some((value) => value.toLocaleLowerCase().includes(search)));
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        await route.fulfill({
          status: 200,
          json: {
            items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: filtered.length,
          } satisfies components['schemas']['PublishedArticleList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/published-articles/${publicationIds.work}`) {
        articleRequests.push(url);
        if (articleDetailErrorStatus) {
          await route.fulfill({
            status: articleDetailErrorStatus,
            json: errorEnvelope(`ARTICLE_${articleDetailErrorStatus}`, '发布成果不可用', `req-article-${articleDetailErrorStatus}`),
          });
          return;
        }
        await route.fulfill({ status: 200, json: currentArticle });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/published-articles/${publicationIds.work}/issues`) {
        const body = request.postDataJSON() as components['schemas']['PublishedContentIssueCreate'];
        commandRequests.push({
          method,
          path: url.pathname,
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        const opened = seedCurrentIssue(body.kind, body.description);
        await route.fulfill({ status: 201, json: opened });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/published-content-issues') {
        issueListRequests.push(url);
        const status = url.searchParams.get('status');
        const items = currentIssue && (!status || currentIssue.status === status)
          ? [currentIssue]
          : [];
        await route.fulfill({
          status: 200,
          json: {
            items,
            page: Number(url.searchParams.get('page') ?? 1),
            page_size: Number(url.searchParams.get('page_size') ?? 20),
            total: items.length,
          } satisfies components['schemas']['PublishedContentIssueList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/published-content-issues/${publicationIds.issue}/workspace-context`) {
        issueWorkspaceRequests.push(url);
        if (!currentIssue) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '内容问题不存在', 'req-issue-404') });
          return;
        }
        await route.fulfill({
          status: 200,
          json: {
            issue: currentIssue,
            article: currentArticle,
            repair_task: currentRepairTask,
          } satisfies components['schemas']['PublishedContentIssueWorkspaceContext'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/published-content-issues/${publicationIds.issue}/repair-context`) {
        issueRepairRequests.push(url);
        if (!currentIssue) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '内容问题不存在', 'req-issue-repair-404') });
          return;
        }
        await route.fulfill({ status: 200, json: createRepairContext(currentIssue, currentArticle) });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/published-content-issues/${publicationIds.issue}/repair-task`) {
        const body = request.postDataJSON() as components['schemas']['PublishedContentRepairTaskCreate'];
        commandRequests.push({
          method,
          path: url.pathname,
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (!currentIssue) throw new Error('创建修复任务前缺少内容问题');
        currentRepairTask = repairTask;
        currentIssue = {
          ...currentIssue,
          repair_task_id: repairTask.id,
          workflow_stage: 'REPAIRING',
          primary_task: 'CONTINUE_REPAIR',
          available_actions: ['RESOLVE'],
        };
        await route.fulfill({ status: 201, json: repairTask });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/published-content-issues/${publicationIds.issue}/resolve`) {
        const body = request.postDataJSON() as components['schemas']['PublishedContentIssueResolveRequest'];
        commandRequests.push({
          method,
          path: url.pathname,
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (!currentIssue) throw new Error('解决前缺少内容问题');
        currentArticle = {
          ...currentArticle,
          has_open_issue: false,
          open_issue_id: null,
          retired: body.outcome === 'RETIRED',
          workflow_stage: body.outcome === 'RETIRED' ? 'RETIRED' : 'HEALTHY',
          primary_task: body.outcome === 'RETIRED' ? 'VIEW_HISTORY' : 'START_PRODUCT_OBSERVATION',
          available_actions: body.outcome === 'RETIRED' ? [] : ['OPEN_ISSUE'],
        };
        currentIssue = {
          ...currentIssue,
          status: 'RESOLVED',
          resolved_at: '2026-08-12T03:00:00Z',
          resolution_outcome: body.outcome,
          resolution_comment: body.comment,
          revision: currentIssue.revision + 1,
          workflow_stage: 'RESOLVED',
          primary_task: 'VIEW_RESOLUTION',
          available_actions: [],
          resolved_by: publicationIds.user,
          article: currentArticle,
        };
        await route.fulfill({ status: 200, json: currentIssue });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/publication-works') {
        listRequests.push(url);
        if (workMode === 'loading') await new Promise<void>((resolve) => { releaseWorks = resolve; });
        if (workMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('WORKS_UNAVAILABLE', '发布工作列表暂不可用', 'req-works') });
          return;
        }
        const status = url.searchParams.get('status');
        const filtered = workMode === 'empty'
          ? []
          : workItems.filter((item) => !status || item.status === status);
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        await route.fulfill({
          status: 200,
          json: {
            items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: filtered.length,
          } satisfies components['schemas']['PublicationWorkList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/publication-works/${publicationIds.work}/workspace-context`) {
        workspaceRequests.push(url);
        if (workspaceErrorStatus) {
          await route.fulfill({
            status: workspaceErrorStatus,
            json: errorEnvelope(`WORKSPACE_${workspaceErrorStatus}`, '发布工作台不可用', `req-workspace-${workspaceErrorStatus}`),
          });
          return;
        }
        await route.fulfill({ status: 200, json: currentWorkspace });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/content-versions/${publicationIds.contentVersion}/publication-package`) {
        packageRequests.push(url);
        await route.fulfill({
          status: 200,
          json: {
            content_version_id: contentVersion.id,
            fact_version_id: publicationIds.factVersion,
            title: contentVersion.title,
            body_markdown: contentVersion.body_markdown,
            body_html: '<h1>已批准内容</h1>',
            body_text: '已批准内容',
            tags: contentVersion.tags,
            content_hash: contentVersion.content_hash,
          } satisfies components['schemas']['PublicationPackage'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/files/upload-intents') {
        uploadRequests.push({ method, path: url.pathname });
        currentEvidence = {
          ...evidenceFile,
          original_filename: (request.postDataJSON() as components['schemas']['UploadIntentCreate']).original_filename,
        };
        await route.fulfill({
          status: 201,
          json: {
            file: currentEvidence,
            upload: {
              method: 'PUT',
              url: `http://127.0.0.1:4174/e2e-storage/${currentEvidence.id}`,
              headers: { 'x-e2e-upload': 'publication' },
              fields: {},
              expires_at: '2026-08-11T03:05:00Z',
            },
          } satisfies components['schemas']['UploadIntent'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/files/${evidenceFile.id}/complete`) {
        uploadRequests.push({ method, path: url.pathname });
        currentEvidence = { ...currentEvidence, status: 'VERIFIED', verified_at: '2026-08-11T03:01:00Z' };
        await route.fulfill({ status: 200, json: currentEvidence });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/files/${evidenceFile.id}/abort`) {
        uploadRequests.push({ method, path: url.pathname });
        currentEvidence = { ...currentEvidence, status: 'ABORTED' };
        await route.fulfill({ status: 200, json: currentEvidence });
        return;
      }
      if (method === 'GET' && url.pathname === `/api/v1/files/${evidenceFile.id}/download-url`) {
        await route.fulfill({
          status: 200,
          json: { url: `http://127.0.0.1:4174/e2e-storage/${evidenceFile.id}`, expires_at: '2026-08-11T03:05:00Z' },
        });
        return;
      }
      const commandPaths = [
        `/api/v1/publication-works/${publicationIds.work}/preparation`,
        `/api/v1/publication-works/${publicationIds.work}/platform-review`,
        `/api/v1/publication-works/${publicationIds.work}/result`,
        `/api/v1/publication-works/${publicationIds.work}/verifications`,
        `/api/v1/publication-works/${publicationIds.work}/content-version`,
        `/api/v1/publication-works/${publicationIds.work}/close`,
      ];
      if (commandPaths.includes(url.pathname)) {
        commandRequests.push({
          method,
          path: url.pathname,
          body: request.postDataJSON(),
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (commandMode === 'pending') await new Promise<void>((resolve) => { releaseCommand = resolve; });
        if (commandMode === 'conflict') {
          await route.fulfill({ status: 409, json: errorEnvelope('PUBLICATION_REVISION_CONFLICT', '发布工作已变化', 'req-workspace-conflict') });
          return;
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        const revision = currentWorkspace.work.revision + 1;
        if (url.pathname.endsWith('/preparation')) {
          currentWorkspace = { ...currentWorkspace, work: { ...currentWorkspace.work, revision, platform_account_id: String(body.platform_account_id) } };
        } else if (url.pathname.endsWith('/platform-review')) {
          currentWorkspace = {
            ...currentWorkspace,
            eligible_accounts: [],
            work: {
              ...currentWorkspace.work,
              revision,
              status: 'PLATFORM_REVIEW',
              workflow_stage: 'PLATFORM_REVIEW',
              primary_task: 'REGISTER_RESULT',
              available_actions: ['REGISTER_RESULT', 'CLOSE'],
            },
          };
        } else if (url.pathname.endsWith('/result')) {
          currentWorkspace = {
            ...currentWorkspace,
            work: {
              ...currentWorkspace.work,
              actual_title: String(body.actual_title),
              final_url: String(body.final_url),
              published_at: String(body.published_at),
              revision,
              status: 'AWAITING_VERIFICATION',
              workflow_stage: 'AWAITING_VERIFICATION',
              primary_task: 'RUN_FIRST_VERIFICATION',
              available_actions: ['VERIFY', 'REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
              attachments: [currentEvidence],
            },
          };
        } else if (url.pathname.endsWith('/verifications')) {
          const passed = body.outcome === 'PASSED';
          const verification = {
            id: `a0000000-0000-4000-8000-${String(currentWorkspace.work.verifications.length + 1).padStart(12, '0')}`,
            content_version_id: currentWorkspace.content.id,
            outcome: passed ? 'PASSED' : 'FAILED',
            actual_title_snapshot: currentWorkspace.work.actual_title ?? '',
            final_url_snapshot: currentWorkspace.work.final_url ?? '',
            published_at_snapshot: currentWorkspace.work.published_at ?? '',
            comment: String(body.comment),
            actor_id: publicationIds.user,
            created_at: `2026-08-11T0${5 + currentWorkspace.work.verifications.length}:00:00Z`,
          } satisfies components['schemas']['PublicationVerification'];
          currentWorkspace = {
            ...currentWorkspace,
            work: {
              ...currentWorkspace.work,
              revision,
              status: passed ? 'COMPLETED' : 'ACTION_REQUIRED',
              workflow_stage: passed ? 'COMPLETED' : 'ACTION_REQUIRED',
              primary_task: passed ? 'VIEW_COMPLETION' : 'FIX_AND_REVERIFY',
              available_actions: passed
                ? []
                : ['VERIFY', 'REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
              verifications: [...currentWorkspace.work.verifications, verification],
              latest_verification_outcome: verification.outcome,
              latest_verification_at: verification.created_at,
            },
          };
        } else if (url.pathname.endsWith('/content-version')) {
          if (!currentWorkspace.switch_candidate) throw new Error('Switch 命令缺少服务端候选');
          const previousId = currentWorkspace.content.id;
          const candidate = currentWorkspace.switch_candidate;
          currentWorkspace = {
            ...currentWorkspace,
            content: {
              ...currentWorkspace.content,
              ...candidate,
              body_markdown: '# 修订批准内容\n\n失败证据已修正。',
              status: 'APPROVED',
              task_id: currentWorkspace.content.task_id,
              tags: ['LNA', '修订'],
            },
            switch_candidate: null,
            work: {
              ...currentWorkspace.work,
              content_version_id: candidate.id,
              content_title: candidate.title,
              content_version: candidate.version,
              content_hash: candidate.content_hash,
              revision,
              primary_task: 'REGISTER_RESULT',
              available_actions: ['REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
              events: [...currentWorkspace.work.events, {
                id: `30000000-0000-4000-8000-${String(currentWorkspace.work.events.length + 1).padStart(12, '0')}`,
                action: 'CONTENT_VERSION_CHANGED',
                from_status: 'ACTION_REQUIRED',
                to_status: 'ACTION_REQUIRED',
                from_content_version_id: previousId,
                to_content_version_id: candidate.id,
                comment: String(body.comment),
                actor_id: publicationIds.user,
                created_at: '2026-08-11T06:00:00Z',
              }],
            },
          };
        } else {
          currentWorkspace = {
            ...currentWorkspace,
            work: {
              ...currentWorkspace.work,
              revision,
              status: 'CLOSED',
              workflow_stage: 'CLOSED',
              primary_task: 'VIEW_CLOSURE',
              available_actions: [],
              close_reason: String(body.reason) as components['schemas']['PublicationCloseReason'],
              close_comment: String(body.comment),
            },
          };
        }
        await route.fulfill({ status: 200, json: currentWorkspace.work });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/publication-works') {
        createRequests.push({
          body: request.postDataJSON() as components['schemas']['PublicationWorkCreate'],
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
        });
        if (createMode === 'pending') await new Promise<void>((resolve) => { releaseCreate = resolve; });
        if (createMode === 'conflict') {
          await route.fulfill({ status: 409, json: errorEnvelope('PUBLICATION_ALREADY_EXISTS', '发布工作已存在', 'req-publication-conflict') });
          return;
        }
        readyItems = readyItems.filter((item) => item.content_version.id !== readyItem.content_version.id);
        workItems = [{ ...workListItem, id: createdWork.id }, ...workItems];
        await route.fulfill({ status: 201, json: createdWork });
        return;
      }
      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorEnvelope('PUBLICATION_FIXTURE_UNEXPECTED_API', 'Publication fixture 收到未声明请求', 'req-unexpected') });
    });

    await use({
      articleListRequests,
      articleRequests,
      commandRequests,
      createRequests,
      issueListRequests,
      issueRepairRequests,
      issueWorkspaceRequests,
      listRequests,
      packageRequests,
      readyRequests,
      summaryRequests,
      uploadRequests,
      workspaceRequests,
      releaseCommand: () => {
        if (!releaseCommand) throw new Error('Publication command pending 请求尚未开始');
        commandMode = 'success';
        releaseCommand();
      },
      releaseCreate: () => {
        if (!releaseCreate) throw new Error('Publication create pending 请求尚未开始');
        createMode = 'success';
        releaseCreate();
      },
      releaseLoading: () => {
        if (!releaseSummary || !releaseReady || !releaseWorks) {
          throw new Error('Publication loading 请求尚未全部开始');
        }
        summaryMode = 'success';
        readyMode = 'success';
        workMode = 'success';
        releaseSummary();
        releaseReady();
        releaseWorks();
      },
      setCreateMode: (mode) => { createMode = mode; },
      setCommandMode: (mode) => { commandMode = mode; },
      setArticleDetailError: (status) => { articleDetailErrorStatus = status; },
      setArticleListMode: (mode) => { articleListMode = mode; },
      seedIssue: () => { seedCurrentIssue(); },
      setReadyMode: (mode) => { readyMode = mode; },
      setSummaryMode: (mode) => { summaryMode = mode; },
      setSwitchCandidate: () => {
        currentWorkspace = { ...currentWorkspace, switch_candidate: switchCandidate };
      },
      setWorkMode: (mode) => { workMode = mode; },
      setWorkspaceError: (status) => { workspaceErrorStatus = status; },
    });

    expect(unexpectedRequests, 'Publication Work 页面不得依赖未声明 API').toEqual([]);
    expect(runtimeErrors, 'Publication Work 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { expect, publicationIds, publishedArticle, test };
