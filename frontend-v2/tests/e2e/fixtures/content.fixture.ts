/** Content Tasks 页面 fixture；只声明本页面真实使用的 API。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ContentTaskListItem = components['schemas']['ContentTaskListItem'];
type ContentTask = components['schemas']['ContentTask'];
type ContentTaskDetail = components['schemas']['ContentTaskDetail'];
type ContentTaskCreate = components['schemas']['ContentTaskCreate'];
type CreationOptions = components['schemas']['ContentTaskCreationOptions'];
type ProductDetail = components['schemas']['ProductDetail'];
type ContentTaskListMode = 'success' | 'empty' | 'error' | 'loading';
type MutationMode = 'success' | 'revision-conflict';
type CreationOptionsMode = 'success' | 'empty' | 'error' | 'loading';
type CreateMode =
  | 'success'
  | 'pending'
  | 'validation'
  | 'fact-not-approved'
  | 'platform-disabled'
  | 'not-found'
  | 'idempotency-conflict'
  | 'forbidden';
type DetailMode = 'success' | 'empty' | 'cancelled' | 'error' | 'loading' | 'not-found' | 'forbidden';
type LifecycleBody =
  | components['schemas']['CommandRequest']
  | components['schemas']['RevisionRequest']
  | components['schemas']['ContentTaskPermanentDeleteRequest']
  | null;

type LifecycleRequest = {
  body: LifecycleBody;
  csrfToken: string | null;
  expectedRevision: number | null;
  method: string;
  pathname: string;
};

type CreateRequest = {
  body: ContentTaskCreate;
  csrfToken: string | null;
  idempotencyKey: string | null;
};

type ContentApiController = {
  createRequests: CreateRequest[];
  creationOptionsRequests: URL[];
  detailRequests: URL[];
  listRequests: URL[];
  lifecycleRequests: LifecycleRequest[];
  releaseCreate: () => void;
  releaseDetailLoading: () => void;
  releaseLoading: () => void;
  releaseOptionsLoading: () => void;
  setCreateMode: (mode: CreateMode) => void;
  setCreationOptionsMode: (mode: CreationOptionsMode) => void;
  setDetailMode: (mode: DetailMode) => void;
  setListMode: (mode: ContentTaskListMode) => void;
  setMutationMode: (mode: MutationMode) => void;
};

type ContentFixtures = { contentApi: ContentApiController };

const platformId = '00000000-0000-4000-8000-000000000201';
const secondPlatformId = '00000000-0000-4000-8000-000000000202';
const creationProductId = '10000000-0000-4000-8000-000000000201';
const secondCreationProductId = '10000000-0000-4000-8000-000000000202';
const inactiveProductId = '10000000-0000-4000-8000-000000000203';
const noFactsProductId = '10000000-0000-4000-8000-000000000204';
const creationFactId = '20000000-0000-4000-8000-000000000201';
const secondCreationFactId = '20000000-0000-4000-8000-000000000202';
const createdTaskId = '00000000-0000-4000-8000-999999999998';

const user = {
  id: '00000000-0000-4000-8000-000000000099',
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

const platform = {
  id: platformId,
  name: '工程师社区',
  slug: 'engineering-community',
  allowed_domains: ['example.com'],
  platform_type_id: null,
  platform_type: null,
  website_url: 'https://example.com',
  logo: null,
  revision: 1,
  is_active: true,
  platform_prompt: null,
  configuration_complete: true,
  platform_account_count: 1,
  workflow_stage: 'OPERATIONAL',
  primary_task: 'VIEW_PLATFORM_OPERATION',
  available_actions: ['UPDATE', 'DISABLE'],
  deletion: null,
  updated_at: '2026-08-09T00:00:00Z',
} satisfies components['schemas']['PlatformProfile'];

const creationOptions = {
  products: [
    {
      id: creationProductId,
      brand: 'PartSignal',
      part_number: 'PS-CREATE-001',
      approved_fact_versions: [
        { id: creationFactId, version: 3, classification: 'PUBLIC' },
        {
          id: '20000000-0000-4000-8000-000000000211',
          version: 2,
          classification: 'INTERNAL',
        },
      ],
    },
    {
      id: secondCreationProductId,
      brand: 'PartSignal',
      part_number: 'PS-CREATE-002',
      approved_fact_versions: [
        { id: secondCreationFactId, version: 1, classification: 'RESTRICTED' },
      ],
    },
  ],
  platforms: [
    { id: platformId, name: platform.name },
    { id: secondPlatformId, name: '开发者问答' },
  ],
  requested_product: null,
} satisfies CreationOptions;

const productDetail = {
  product: {
    id: creationProductId,
    part_number: 'PS-CREATE-001',
    brand: 'PartSignal',
    category: 'MCU',
    status: 'ACTIVE',
    workflow_stage: 'FACT_APPROVED',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['UPDATE'],
    deletion: null,
    revision: 3,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
  },
  approved_fact: {
    id: creationFactId,
    version: 3,
    status: 'APPROVED',
    classification: 'PUBLIC',
    approved_at: '2026-08-10T00:00:00Z',
  },
  pending_fact: null,
  content: { task_count: 0, latest_task: null },
  publishing: { published_article_count: 0, latest: null },
  geo: {
    observation_count: 0,
    article_result_count: 0,
    discovery_rate: null,
    mention_rate: null,
    accuracy_rate: null,
  },
  activity: [],
} satisfies ProductDetail;

function createContentTasks(count = 45): ContentTaskListItem[] {
  const items = Array.from({ length: count }, (_, index): ContentTaskListItem => {
    const ordinal = index + 1;
    const suffix = String(ordinal).padStart(12, '0');
    return {
      id: `00000000-0000-4000-8000-${suffix}`,
      identifier: `CT-${String(ordinal).padStart(8, '0')}`,
      product_id: `10000000-0000-4000-8000-${suffix}`,
      fact_version_id: `20000000-0000-4000-8000-${suffix}`,
      platform_profile_id: platformId,
      query_topic_id: null,
      source_published_content_issue_id: null,
      current_content_version_id: `30000000-0000-4000-8000-${suffix}`,
      workflow_stage: ordinal === 1 ? 'GENERATION_FAILED' : 'DRAFT',
      primary_task: ordinal === 1 ? 'REVIEW_CONTENT' : 'EDIT_AND_SUBMIT_REVIEW',
      available_actions: ordinal === 1
        ? ['CANCEL', 'DELETE', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION']
        : ['CANCEL'],
      deletion: ordinal === 1 ? { blockers: [] } : null,
      status: 'OPEN',
      revision: ordinal,
      created_by: user.id,
      created_at: '2026-08-01T00:00:00Z',
      archived_at: null,
      product: {
        id: `10000000-0000-4000-8000-${suffix}`,
        brand: ordinal === 1 ? 'PartSignal Fixture' : `Brand ${ordinal % 5}`,
        part_number: `PS-${String(ordinal).padStart(4, '0')}`,
      },
      platform: {
        id: platformId,
        name: platform.name,
        website_url: platform.website_url,
        logo: null,
      },
      current_content: { id: `30000000-0000-4000-8000-${suffix}`, version: ordinal, source_type: ordinal % 2 ? 'AI' : 'HUMAN' },
      latest_generation_status: ordinal === 1 ? 'FAILED' : null,
      updated_at: new Date(Date.UTC(2026, 7, 10, 8, 0) - index * 60_000).toISOString(),
    };
  });
  items.push({
    ...items[0],
    id: '00000000-0000-4000-8000-000000000999',
    identifier: 'CT-ARCHIVED',
    product_id: '10000000-0000-4000-8000-000000000999',
    fact_version_id: '20000000-0000-4000-8000-000000000999',
    current_content_version_id: '30000000-0000-4000-8000-000000000999',
    status: 'COMPLETED',
    workflow_stage: 'VERIFIED',
    primary_task: 'VIEW_FULL_LINEAGE',
    available_actions: ['RESTORE', 'PERMANENT_DELETE'],
    deletion: null,
    revision: 99,
    archived_at: '2026-08-10T09:00:00Z',
    product: { ...items[0].product, id: '10000000-0000-4000-8000-000000000999', part_number: 'PS-ARCHIVED' },
    current_content: { id: '30000000-0000-4000-8000-000000000999', version: 9, source_type: 'HUMAN' },
    updated_at: '2026-08-10T09:00:00Z',
  });
  return items;
}

function createdTask(body: ContentTaskCreate): ContentTask {
  return {
    ...body,
    id: createdTaskId,
    query_topic_id: null,
    source_published_content_issue_id: null,
    current_content_version_id: null,
    workflow_stage: 'NO_DRAFT',
    primary_task: 'CREATE_FIRST_DRAFT',
    available_actions: ['CANCEL', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
    deletion: null,
    status: 'OPEN',
    revision: 0,
    created_by: user.id,
    created_at: '2026-08-10T12:00:00Z',
    archived_at: null,
  };
}

function createdListItem(body: ContentTaskCreate): ContentTaskListItem {
  const task = createdTask(body);
  const product = creationOptions.products.find((item) => item.id === body.product_id)
    ?? creationOptions.products[0];
  const targetPlatform = creationOptions.platforms.find(
    (item) => item.id === body.platform_profile_id,
  ) ?? creationOptions.platforms[0];
  return {
    ...task,
    identifier: 'CT-00000000',
    product: {
      id: product.id,
      brand: product.brand,
      part_number: product.part_number,
    },
    platform: {
      id: targetPlatform.id,
      name: targetPlatform.name,
      website_url: null,
      logo: null,
    },
    current_content: null,
    latest_generation_status: null,
    updated_at: task.created_at,
  };
}

function commandResponse(item: ContentTaskListItem): ContentTask {
  return {
    id: item.id,
    product_id: item.product_id,
    fact_version_id: item.fact_version_id,
    platform_profile_id: item.platform_profile_id,
    query_topic_id: item.query_topic_id,
    source_published_content_issue_id: item.source_published_content_issue_id,
    current_content_version_id: item.current_content_version_id,
    workflow_stage: item.workflow_stage,
    primary_task: item.primary_task,
    available_actions: item.available_actions,
    deletion: item.deletion,
    status: item.status,
    revision: item.revision,
    created_by: item.created_by,
    created_at: item.created_at,
    archived_at: item.archived_at,
  };
}

function contentTaskDetail(item: ContentTaskListItem, empty = false): ContentTaskDetail {
  return {
    task: {
      id: item.id,
      identifier: item.identifier,
      status: item.status,
      workflow_stage: item.workflow_stage,
      primary_task: item.primary_task,
      available_actions: item.available_actions,
      deletion: item.deletion,
      revision: item.revision,
      created_by: item.created_by,
      created_at: item.created_at,
      archived_at: item.archived_at,
    },
    product: { ...item.product, status: 'ACTIVE' },
    platform: item.platform,
    fact: {
      id: item.fact_version_id,
      version: 3,
      status: 'APPROVED',
      classification: 'PUBLIC',
    },
    current_content: empty || !item.current_content ? null : {
      ...item.current_content,
      status: 'CHANGES_REQUESTED',
      title: `${item.product.part_number} 选型指南`,
      summary: '基于已批准事实的当前内容摘要',
    },
    generation: empty ? null : {
      id: '40000000-0000-4000-8000-000000000001',
      job_type: 'GENERATE',
      status: 'FAILED',
      attempt_count: 2,
      error_code: 'MODEL_TIMEOUT',
      error_summary: '模型响应超时',
      created_at: '2026-08-10T08:00:00Z',
      started_at: '2026-08-10T08:01:00Z',
      finished_at: '2026-08-10T08:02:00Z',
    },
    review: empty || !item.current_content ? null : {
      content_version_id: item.current_content.id,
      status: 'CHANGES_REQUESTED',
      latest_result: {
        action: 'request-changes',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        created_at: '2026-08-10T09:00:00Z',
      },
    },
    publishing: empty ? null : {
      work: {
        id: '50000000-0000-4000-8000-000000000001',
        status: 'ACTION_REQUIRED',
        updated_at: '2026-08-10T10:00:00Z',
      },
      result: null,
    },
    source: empty ? null : {
      query_topic: {
        id: '60000000-0000-4000-8000-000000000001',
        canonical_question: `如何选择 ${item.product.part_number}？`,
      },
      geo_optimization: null,
      published_content_issue: null,
    },
    activity: empty ? [] : [
      {
        id: '70000000-0000-4000-8000-000000000001',
        kind: 'TASK',
        timestamp: '2026-08-10T11:00:00Z',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        summary: '任务进入当前阶段',
        target: { kind: 'CONTENT_TASK', id: item.id, label: item.identifier },
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        kind: 'GENERATION',
        timestamp: '2026-08-10T10:00:00Z',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        summary: '生成作业失败',
        target: {
          kind: 'GENERATION_JOB',
          id: '40000000-0000-4000-8000-000000000001',
          label: '原始生成',
        },
      },
    ],
  };
}

function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> = {},
) {
  return {
    error: { code, message, details, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<ContentFixtures>({
  contentApi: [async ({ page }, use) => {
    const items = createContentTasks();
    let listMode: ContentTaskListMode = 'success';
    let mutationMode: MutationMode = 'success';
    let creationOptionsMode: CreationOptionsMode = 'success';
    let createMode: CreateMode = 'success';
    let detailMode: DetailMode = 'success';
    let releaseLoading: (() => void) | undefined;
    let releaseOptionsLoading: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    let releaseDetailLoading: (() => void) | undefined;
    const creationOptionsRequests: URL[] = [];
    const createRequests: CreateRequest[] = [];
    const detailRequests: URL[] = [];
    const listRequests: URL[] = [];
    const lifecycleRequests: LifecycleRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if ([
        '503 (Service Unavailable)',
        '422 (Unprocessable Entity)',
        '409 (Conflict)',
        '404 (Not Found)',
        '403 (Forbidden)',
      ].some((status) => message.text().includes(status))) return;
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
        await route.fulfill({ status: 200, json: { csrf_token: 'content-e2e-csrf' } satisfies components['schemas']['CsrfToken'] });
        return;
      }
      const productDetailMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/detail$/);
      if (
        method === 'GET'
        && productDetailMatch
        && productDetailMatch[1] === creationProductId
      ) {
        await route.fulfill({ status: 200, json: productDetail });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/platform-profiles') {
        await route.fulfill({
          status: 200,
          json: {
            items: [platform],
            page: 1,
            page_size: 1,
            total: 1,
            summary: { platform_total: 1, enabled_total: 1, missing_prompt_total: 0, configuration_complete_total: 1 },
          } satisfies components['schemas']['PlatformProfileList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/content-tasks/creation-options') {
        creationOptionsRequests.push(url);
        if (creationOptionsMode === 'loading') {
          await new Promise<void>((resolve) => { releaseOptionsLoading = resolve; });
        }
        if (creationOptionsMode === 'error') {
          await route.fulfill({
            status: 503,
            json: errorEnvelope(
              'CONTENT_TASK_OPTIONS_UNAVAILABLE',
              '创建选项暂不可用',
              'req-content-options',
            ),
          });
          return;
        }
        if (creationOptionsMode === 'empty') {
          await route.fulfill({
            status: 200,
            json: {
              products: [],
              platforms: [],
              requested_product: null,
            } satisfies CreationOptions,
          });
          return;
        }
        const requestedProductId = url.searchParams.get('requested_product_id');
        const eligible = creationOptions.products.find(
          (item) => item.id === requestedProductId,
        );
        const requestedProduct = !requestedProductId
          ? null
          : eligible
            ? {
                product_id: eligible.id,
                brand: eligible.brand,
                part_number: eligible.part_number,
                eligibility: 'ELIGIBLE' as const,
              }
            : requestedProductId === inactiveProductId
              ? {
                  product_id: inactiveProductId,
                  brand: 'PartSignal',
                  part_number: 'PS-INACTIVE',
                  eligibility: 'PRODUCT_INACTIVE' as const,
                }
              : requestedProductId === noFactsProductId
                ? {
                    product_id: noFactsProductId,
                    brand: 'PartSignal',
                    part_number: 'PS-NO-FACTS',
                    eligibility: 'NO_APPROVED_FACTS' as const,
                  }
                : {
                    product_id: requestedProductId,
                    brand: null,
                    part_number: null,
                    eligibility: 'NOT_FOUND' as const,
                  };
        await route.fulfill({
          status: 200,
          json: { ...creationOptions, requested_product: requestedProduct } satisfies CreationOptions,
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/content-tasks') {
        listRequests.push(url);
        if (listMode === 'loading') {
          await new Promise<void>((resolve) => { releaseLoading = resolve; });
        }
        if (listMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('CONTENT_TASKS_UNAVAILABLE', '内容任务服务暂不可用', 'req-content-list') });
          return;
        }
        const archiveStatus = url.searchParams.get('archive_status') ?? 'ACTIVE';
        const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase('zh-CN');
        const workflowStage = url.searchParams.get('workflow_stage');
        const requestedPlatform = url.searchParams.get('platform_profile_id');
        const filtered = listMode === 'empty' ? [] : items.filter((item) => {
          const archived = item.archived_at !== null;
          return (archiveStatus === 'ALL' || (archiveStatus === 'ARCHIVED' ? archived : !archived))
            && (!query || `${item.identifier} ${item.product.brand} ${item.product.part_number} ${item.platform.name}`.toLocaleLowerCase('zh-CN').includes(query))
            && (!workflowStage || item.workflow_stage === workflowStage)
            && (!requestedPlatform || item.platform_profile_id === requestedPlatform);
        });
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        await route.fulfill({
          status: 200,
          json: {
            items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: filtered.length,
          } satisfies components['schemas']['ContentTaskList'],
        });
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/detail$/);
      if (method === 'GET' && detailMatch) {
        detailRequests.push(url);
        if (detailMode === 'loading') {
          await new Promise<void>((resolve) => { releaseDetailLoading = resolve; });
        }
        if (detailMode === 'error') {
          await route.fulfill({ status: 503, json: errorEnvelope('CONTENT_TASK_DETAIL_UNAVAILABLE', '内容任务详情暂不可用', 'req-content-detail') });
          return;
        }
        if (detailMode === 'not-found' || detailMode === 'forbidden') {
          const forbidden = detailMode === 'forbidden';
          await route.fulfill({
            status: forbidden ? 403 : 404,
            json: errorEnvelope(
              forbidden ? 'PERMISSION_DENIED' : 'NOT_FOUND',
              forbidden ? '没有读取内容任务详情的权限' : '内容任务不存在',
              forbidden ? 'req-content-detail-forbidden' : 'req-content-detail-not-found',
            ),
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === detailMatch[1]);
        if (!item) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '内容任务不存在', 'req-content-detail-not-found') });
          return;
        }
        const response = contentTaskDetail(item, detailMode === 'empty');
        if (detailMode === 'cancelled') {
          response.task = {
            ...response.task,
            status: 'CANCELLED',
            workflow_stage: 'CANCELLED',
            primary_task: 'VIEW_CANCELLATION',
            available_actions: ['DELETE'],
            deletion: { blockers: [] },
          };
        }
        await route.fulfill({ status: 200, json: response });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/content-tasks') {
        const body = request.postDataJSON() as ContentTaskCreate;
        createRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
        });
        if (createMode === 'pending') {
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
        }
        const failures = {
          validation: {
            status: 422,
            code: 'VALIDATION_ERROR',
            message: '请求数据不符合接口契约',
            requestId: 'req-content-validation',
            details: {
              errors: [{
                loc: ['body', 'fact_version_id'],
                msg: '事实版本不属于所选产品',
                type: 'value_error',
              }],
            },
          },
          'fact-not-approved': {
            status: 409,
            code: 'FACT_NOT_APPROVED',
            message: '内容任务只能绑定非空的已批准事实版本',
            requestId: 'req-content-fact',
          },
          'platform-disabled': {
            status: 409,
            code: 'PLATFORM_DISABLED',
            message: '所选平台已停用',
            requestId: 'req-content-platform',
          },
          'not-found': {
            status: 404,
            code: 'NOT_FOUND',
            message: '平台配置不存在',
            requestId: 'req-content-not-found',
          },
          'idempotency-conflict': {
            status: 409,
            code: 'IDEMPOTENCY_CONFLICT',
            message: '幂等键已用于另一创建请求',
            requestId: 'req-content-idempotency',
          },
          forbidden: {
            status: 403,
            code: 'PERMISSION_DENIED',
            message: '没有创建内容任务的权限',
            requestId: 'req-content-forbidden',
          },
        } as const;
        if (createMode in failures) {
          const failure = failures[createMode as keyof typeof failures];
          await route.fulfill({
            status: failure.status,
            json: errorEnvelope(
              failure.code,
              failure.message,
              failure.requestId,
              'details' in failure ? failure.details : {},
            ),
          });
          return;
        }
        const response = createdTask(body);
        if (!items.some((item) => item.id === response.id)) items.unshift(createdListItem(body));
        await route.fulfill({ status: 201, json: response });
        return;
      }

      const previewMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/permanent-deletion-preview$/);
      if (method === 'GET' && previewMatch) {
        await route.fulfill({
          status: 200,
          json: {
            task_id: previewMatch[1],
            revision: 100,
            counts: {
              content_versions: 9,
              content_review_records: 2,
              generation_jobs: 1,
              publication_works: 1,
              publication_events: 2,
              publication_verifications: 1,
              published_articles: 1,
              published_content_issues: 0,
              geo_article_relations: 0,
              exclusive_geo_observation_chains: 0,
              attachment_relations: 0,
            },
            external_urls: ['https://example.com/published/1'],
            confirmation_text: '永久删除',
          } satisfies components['schemas']['ContentTaskPermanentDeletionPreview'],
        });
        return;
      }

      const lifecycleMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)(?:\/(cancel|archive|restore|permanent-delete))?$/);
      const command = lifecycleMatch?.[2];
      const lifecycleMethodAllowed = lifecycleMatch && (
        (method === 'DELETE' && command === undefined)
        || (method === 'POST' && command !== undefined)
      );
      if (lifecycleMethodAllowed && lifecycleMatch) {
        const body = request.postData() ? request.postDataJSON() as LifecycleBody : null;
        lifecycleRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision: Number(url.searchParams.get('expected_revision')) || null,
          method,
          pathname: url.pathname,
        });
        if (mutationMode === 'revision-conflict') {
          await route.fulfill({ status: 409, json: errorEnvelope('REVISION_CONFLICT', '内容任务已被其他请求修改', 'req-content-conflict') });
          return;
        }
        if (method === 'DELETE' || command === 'permanent-delete') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        const item = items.find((candidate) => candidate.id === lifecycleMatch[1]) ?? items[0];
        await route.fulfill({ status: 200, json: commandResponse(item) });
        return;
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorEnvelope('CONTENT_FIXTURE_UNEXPECTED_API', 'Content fixture 收到未声明的 API 请求', 'req-content-unexpected') });
    });

    await use({
      createRequests,
      creationOptionsRequests,
      detailRequests,
      listRequests,
      lifecycleRequests,
      releaseCreate: () => {
        if (!releaseCreate) throw new Error('Content create 请求尚未开始');
        createMode = 'success';
        releaseCreate();
      },
      releaseDetailLoading: () => {
        if (!releaseDetailLoading) throw new Error('Content Detail loading 请求尚未开始');
        detailMode = 'success';
        releaseDetailLoading();
      },
      releaseLoading: () => {
        if (!releaseLoading) throw new Error('Content loading 请求尚未开始');
        listMode = 'success';
        releaseLoading();
      },
      releaseOptionsLoading: () => {
        if (!releaseOptionsLoading) throw new Error('Content options loading 请求尚未开始');
        creationOptionsMode = 'success';
        releaseOptionsLoading();
      },
      setCreateMode: (mode) => { createMode = mode; },
      setCreationOptionsMode: (mode) => { creationOptionsMode = mode; },
      setDetailMode: (mode) => { detailMode = mode; },
      setListMode: (mode) => { listMode = mode; },
      setMutationMode: (mode) => { mutationMode = mode; },
    });

    expect(unexpectedRequests, 'Content Tasks 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Content Tasks 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export {
  createdTaskId,
  creationFactId,
  creationProductId,
  expect,
  inactiveProductId,
  noFactsProductId,
  platformId,
  secondCreationProductId,
  test,
};
