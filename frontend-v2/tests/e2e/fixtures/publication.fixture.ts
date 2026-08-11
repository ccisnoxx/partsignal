/** Publication Work List 的 production-artifact API fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type SurfaceMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode = 'success' | 'conflict' | 'pending';
type CommandMode = 'success' | 'conflict' | 'pending';
type WorkspaceErrorStatus = 401 | 403 | 404 | 409 | 422;
type CreateRequest = {
  body: components['schemas']['PublicationWorkCreate'];
  csrfToken: string | null;
  idempotencyKey: string | null;
};
type PublicationApiController = {
  commandRequests: Array<{ method: string; path: string; body: unknown; csrfToken: string | null }>;
  createRequests: CreateRequest[];
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
    let releaseCreate: (() => void) | undefined;
    let releaseCommand: (() => void) | undefined;
    let releaseSummary: (() => void) | undefined;
    let releaseReady: (() => void) | undefined;
    let releaseWorks: (() => void) | undefined;
    let readyItems = [readyItem, noAccountReadyItem];
    let workItems = createWorkItems();
    let currentWorkspace: PublicationWorkspaceContext = structuredClone(workspaceContext);
    let currentEvidence: FileRecord = evidenceFile;
    const commandRequests: Array<{ method: string; path: string; body: unknown; csrfToken: string | null }> = [];
    const createRequests: CreateRequest[] = [];
    const listRequests: URL[] = [];
    const packageRequests: URL[] = [];
    const readyRequests: URL[] = [];
    const summaryRequests: URL[] = [];
    const uploadRequests: Array<{ method: string; path: string }> = [];
    const workspaceRequests: URL[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

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
      commandRequests,
      createRequests,
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

export { expect, publicationIds, test };
