/** Publication Work List 的 production-artifact API fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type SurfaceMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode = 'success' | 'conflict' | 'pending';
type CreateRequest = {
  body: components['schemas']['PublicationWorkCreate'];
  csrfToken: string | null;
  idempotencyKey: string | null;
};
type PublicationApiController = {
  createRequests: CreateRequest[];
  listRequests: URL[];
  readyRequests: URL[];
  summaryRequests: URL[];
  releaseCreate: () => void;
  releaseLoading: () => void;
  setCreateMode: (mode: CreateMode) => void;
  setReadyMode: (mode: SurfaceMode) => void;
  setSummaryMode: (mode: SurfaceMode) => void;
  setWorkMode: (mode: SurfaceMode) => void;
};
type PublicationFixtures = { publicationApi: PublicationApiController };

const publicationIds = {
  account: '10000000-0000-4000-8000-000000000001',
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
    let releaseCreate: (() => void) | undefined;
    let releaseSummary: (() => void) | undefined;
    let releaseReady: (() => void) | undefined;
    let releaseWorks: (() => void) | undefined;
    let readyItems = [readyItem, noAccountReadyItem];
    let workItems = createWorkItems();
    const createRequests: CreateRequest[] = [];
    const listRequests: URL[] = [];
    const readyRequests: URL[] = [];
    const summaryRequests: URL[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if (['503 (Service Unavailable)', '409 (Conflict)']
        .some((status) => message.text().includes(status))) return;
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
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
      createRequests,
      listRequests,
      readyRequests,
      summaryRequests,
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
      setReadyMode: (mode) => { readyMode = mode; },
      setSummaryMode: (mode) => { summaryMode = mode; },
      setWorkMode: (mode) => { workMode = mode; },
    });

    expect(unexpectedRequests, 'Publication Work 页面不得依赖未声明 API').toEqual([]);
    expect(runtimeErrors, 'Publication Work 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { expect, publicationIds, test };
