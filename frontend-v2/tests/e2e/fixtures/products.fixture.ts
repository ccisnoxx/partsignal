/** Products 页面/路由测试 fixture；显式隔离真实后端，不代表完整业务 E2E。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ProductListItem = components['schemas']['ProductListItem'];
type ProductList = components['schemas']['ProductList'];
type Product = components['schemas']['Product'];
type ProductDetail = components['schemas']['ProductDetail'];
type ProductCreate = components['schemas']['ProductCreate'];
type ProductUpdate = components['schemas']['ProductUpdate'];
type ProductFactsDraft = components['schemas']['ProductFactsDraft'];
type ProductFactsDraftUpdate = components['schemas']['ProductFactsDraftUpdate'];
type FactReviewSubmissionRequest = components['schemas']['FactReviewSubmissionRequest'];
type FactVersion = components['schemas']['FactVersion'];
type ProductFactReviewWorkspace = components['schemas']['ProductFactReviewWorkspace'];
type CommandRequest = components['schemas']['CommandRequest'];
type RequestChangesCommand = components['schemas']['RequestChangesCommand'];
type ProductsListMode = 'success' | 'empty' | 'error' | 'loading';
type ProductCreateMode = 'success' | 'duplicate' | 'validation' | 'forbidden' | 'pending';
type ProductDetailMode = 'success' | 'not-found' | 'forbidden' | 'error';
type ProductMutationMode = 'success' | 'revision-conflict';
type ProductFactsMode = 'success' | 'not-found' | 'forbidden' | 'error' | 'loading';
type FactReviewMode = 'success' | 'empty' | 'not-found' | 'forbidden' | 'error' | 'loading';
type FactVersionMode = 'success' | 'not-found' | 'forbidden' | 'error' | 'loading';

type ProductCreateRequest = {
  body: ProductCreate;
  csrfToken: string | null;
};

type ProductUpdateRequest = { body: ProductUpdate; csrfToken: string | null; productId: string };
type ProductDeleteRequest = { csrfToken: string | null; expectedRevision: number | null; productId: string };
type ProductFactsSaveRequest = { body: ProductFactsDraftUpdate; csrfToken: string | null; productId: string };
type ProductFactsSubmitRequest = { body: FactReviewSubmissionRequest; csrfToken: string | null; productId: string };
type FactApproveRequest = { body: CommandRequest; csrfToken: string | null; factVersionId: string };
type FactRequestChangesRequest = { body: RequestChangesCommand; csrfToken: string | null; factVersionId: string };

type ProductsApiController = {
  productRequests: URL[];
  detailRequests: URL[];
  createRequests: ProductCreateRequest[];
  updateRequests: ProductUpdateRequest[];
  deleteRequests: ProductDeleteRequest[];
  factRequests: URL[];
  factSaveRequests: ProductFactsSaveRequest[];
  factSubmitRequests: ProductFactsSubmitRequest[];
  factReviewRequests: URL[];
  factVersionRequests: URL[];
  factApproveRequests: FactApproveRequest[];
  factRequestChangesRequests: FactRequestChangesRequest[];
  releaseCreate: () => void;
  releaseLoading: () => void;
  releaseFactsLoading: () => void;
  releaseFactReviewLoading: () => void;
  releaseFactVersionLoading: () => void;
  setCreateMode: (mode: ProductCreateMode) => void;
  setDeleteMode: (mode: ProductMutationMode) => void;
  setDetail: (detail: ProductDetail) => void;
  setDetailMode: (mode: ProductDetailMode) => void;
  setItems: (items: ProductListItem[]) => void;
  setMode: (mode: ProductsListMode) => void;
  setUpdateMode: (mode: ProductMutationMode) => void;
  setFactWorkspace: (workspace: ProductFactsDraft) => void;
  setFactsMode: (mode: ProductFactsMode) => void;
  setFactSaveMode: (mode: ProductMutationMode) => void;
  setFactSubmitMode: (mode: ProductMutationMode) => void;
  setFactReviewWorkspace: (workspace: ProductFactReviewWorkspace) => void;
  setFactReviewMode: (mode: FactReviewMode) => void;
  setFactApproveMode: (mode: ProductMutationMode) => void;
  setFactRequestChangesMode: (mode: ProductMutationMode) => void;
  setFactVersion: (version: FactVersion) => void;
  setFactVersionMode: (mode: FactVersionMode) => void;
};

type ProductsFixtures = {
  productsApi: ProductsApiController;
};

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

const primaryTasks = [
  'ENTER_FACTS',
  'SUBMIT_FACT_REVIEW',
  'REVIEW_FACT',
  'REVISE_FACT',
  'CREATE_CONTENT_TASK',
  'VIEW_FACT_HISTORY',
] as const;
const factStatuses = ['NOT_ENTERED', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'RETIRED'] as const;
const workflowStages = ['FACTS_EMPTY', 'FACTS_EDITING', 'FACT_REVIEW_PENDING', 'FACT_CHANGES_REQUESTED', 'FACT_APPROVED', 'RETIRED'] as const;

function createProducts(count = 65): ProductListItem[] {
  return Array.from({ length: count }, (_, index) => {
    const factStatus = factStatuses[index % factStatuses.length];
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      part_number: index === 0 ? 'PS-0001-VERY-LONG-MODEL-NUMBER' : `PS-${String(index + 1).padStart(4, '0')}`,
      brand: index === 0 ? 'PartSignal Extremely Long Browser Fixture Brand Name' : `Brand ${index % 7}`,
      category: index === 0 ? 'High Reliability Microcontroller and Embedded Control Category' : `Category ${index % 5}`,
      status: factStatus === 'RETIRED' ? 'RETIRED' : 'ACTIVE',
      workflow_stage: workflowStages[index % workflowStages.length],
      primary_task: primaryTasks[index % primaryTasks.length],
      available_actions: index === 1 ? ['UPDATE'] : ['UPDATE', 'DELETE'],
      deletion: index === 1 ? { blockers: [{ type: 'CONTENT_TASK', count: 2 }] } : { blockers: [] },
      revision: index + 1,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: new Date(Date.UTC(2026, 7, 9, 8, 0, 0) - index * 60_000).toISOString(),
      fact_status: factStatus,
      current_fact: factStatus === 'NOT_ENTERED' ? null : {
        version: index + 1,
        status: factStatus,
      },
    };
  });
}

function listProducts(items: ProductListItem[], url: URL): ProductList {
  const search = url.searchParams.get('search')?.toLocaleLowerCase('zh-CN');
  const factStatus = url.searchParams.get('fact_status');
  const workflowStage = url.searchParams.get('workflow_stage');
  const sort = url.searchParams.get('sort') ?? 'UPDATED_DESC';
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('page_size') ?? 20);
  const filtered = items.filter((item) => {
    const matchesSearch = !search || `${item.part_number} ${item.brand}`.toLocaleLowerCase('zh-CN').includes(search);
    return matchesSearch
      && (!factStatus || item.fact_status === factStatus)
      && (!workflowStage || item.workflow_stage === workflowStage);
  });
  filtered.sort((left, right) => {
    if (sort === 'MODEL_ASC') return left.part_number.localeCompare(right.part_number);
    if (sort === 'MODEL_DESC') return right.part_number.localeCompare(left.part_number);
    const direction = sort === 'UPDATED_ASC' ? 1 : -1;
    return left.updated_at.localeCompare(right.updated_at) * direction;
  });
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    page_size: pageSize,
    total: filtered.length,
  };
}

function createProductDetail(item: ProductListItem): ProductDetail {
  return {
    product: {
      id: item.id,
      part_number: item.part_number,
      brand: item.brand,
      category: item.category,
      status: item.status,
      workflow_stage: item.status === 'RETIRED' ? 'RETIRED' : 'FACTS_EDITING',
      primary_task: item.primary_task,
      available_actions: item.available_actions,
      deletion: item.deletion,
      revision: item.revision,
      created_at: item.created_at,
      updated_at: item.updated_at,
    },
    approved_fact: null,
    pending_fact: null,
    content: { task_count: 0, latest_task: null },
    publishing: { published_article_count: 0, latest: null },
    geo: { observation_count: 0, article_result_count: 0, discovery_rate: null, mention_rate: null, accuracy_rate: null },
    activity: [],
  };
}

function createProductFacts(item: ProductListItem): ProductFactsDraft {
  return {
    product_id: item.id,
    product: {
      id: item.id,
      part_number: item.part_number,
      brand: item.brand,
      category: item.category,
      status: item.status,
      workflow_stage: item.status === 'RETIRED' ? 'RETIRED' : 'FACTS_EDITING',
    },
    body_markdown: '## 产品事实\n\n- 工作电压：3.3V',
    classification: 'INTERNAL',
    approved_fact: null,
    pending_fact: null,
    available_actions: item.status === 'RETIRED' ? [] : ['SAVE', 'SUBMIT_REVIEW'],
    revision: 3,
  };
}

function createFactReviewWorkspace(item: ProductListItem): ProductFactReviewWorkspace {
  const factVersionId = '10000000-0000-4000-8000-000000000002';
  return {
    product: {
      id: item.id,
      part_number: item.part_number,
      brand: item.brand,
      category: item.category,
      status: item.status,
      workflow_stage: 'FACT_REVIEW_PENDING',
    },
    review: {
      fact_version: {
        id: factVersionId,
        product_id: item.id,
        version: 2,
        status: 'PENDING_REVIEW',
        body_markdown: '# 不可变事实\n\n- 工作电压：5V',
        classification: 'INTERNAL',
        change_summary: '补充参数来源',
        primary_task: 'REVIEW_FACT',
        available_actions: ['APPROVE', 'REQUEST_CHANGES'],
        deletion: null,
        revision: 0,
        created_by: user.id,
        approved_by: null,
        created_at: '2026-08-09T11:00:00Z',
        approved_at: null,
      },
      diff: {
        left_id: '10000000-0000-4000-8000-000000000001',
        right_id: factVersionId,
        lines: [
          { kind: 'EQUAL', old_line: 1, new_line: 1, text: '# 不可变事实' },
          { kind: 'DELETE', old_line: 3, new_line: null, text: '- 工作电压：3.3V' },
          { kind: 'ADD', old_line: null, new_line: 3, text: '- 工作电压：5V' },
        ],
      },
      available_actions: ['APPROVE', 'REQUEST_CHANGES'],
      review_history: [{
        id: '50000000-0000-4000-8000-000000000001',
        target_id: factVersionId,
        target_version: 2,
        action: 'submit-review',
        comment: '补充参数来源',
        actor: { id: user.id, username: user.username, display_name: user.display_name },
        created_at: '2026-08-09T11:00:00Z',
      }],
    },
  };
}

function createFactVersion(item: ProductListItem): FactVersion {
  return {
    id: '10000000-0000-4000-8000-000000000002',
    product_id: item.id,
    version: 2,
    status: 'APPROVED',
    body_markdown: '# 不可变事实\n\n- 工作电压：5V\n\n<script>不得执行</script>',
    classification: 'INTERNAL',
    change_summary: '补充参数来源',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['RETIRE'],
    deletion: null,
    revision: 1,
    created_by: user.id,
    approved_by: user.id,
    created_at: '2026-08-09T11:00:00Z',
    approved_at: '2026-08-09T12:00:00Z',
  };
}

const test = base.extend<ProductsFixtures>({
  productsApi: [async ({ page }, use) => {
    let items = createProducts();
    let mode: ProductsListMode = 'success';
    let createMode: ProductCreateMode = 'success';
    let detailMode: ProductDetailMode = 'success';
    let updateMode: ProductMutationMode = 'success';
    let deleteMode: ProductMutationMode = 'success';
    let factsMode: ProductFactsMode = 'success';
    let factSaveMode: ProductMutationMode = 'success';
    let factSubmitMode: ProductMutationMode = 'success';
    let factReviewMode: FactReviewMode = 'success';
    let factVersionMode: FactVersionMode = 'success';
    let factApproveMode: ProductMutationMode = 'success';
    let factRequestChangesMode: ProductMutationMode = 'success';
    let detailOverride: ProductDetail | undefined;
    let factsOverride: ProductFactsDraft | undefined;
    let factReviewOverride: ProductFactReviewWorkspace | undefined;
    let factVersionOverride: FactVersion | undefined;
    let releaseLoading: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    let releaseFactsLoading: (() => void) | undefined;
    let releaseFactReviewLoading: (() => void) | undefined;
    let releaseFactVersionLoading: (() => void) | undefined;
    const productRequests: URL[] = [];
    const detailRequests: URL[] = [];
    const createRequests: ProductCreateRequest[] = [];
    const updateRequests: ProductUpdateRequest[] = [];
    const deleteRequests: ProductDeleteRequest[] = [];
    const factRequests: URL[] = [];
    const factSaveRequests: ProductFactsSaveRequest[] = [];
    const factSubmitRequests: ProductFactsSubmitRequest[] = [];
    const factReviewRequests: URL[] = [];
    const factVersionRequests: URL[] = [];
    const factApproveRequests: FactApproveRequest[] = [];
    const factRequestChangesRequests: FactRequestChangesRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      // fixture 明确返回且页面已处理的非 2xx 仍会被 Chromium 记录为资源错误。
      if ([
        '503 (Service Unavailable)',
        '409 (Conflict)',
        '404 (Not Found)',
        '422 (Unprocessable Entity)',
        '403 (Forbidden)',
      ].some((status) => message.text().includes(status))) return;
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      // refresh/Back/成功删除后的导航会取消上一文档尚未收尾的请求，不属于页面运行错误。
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: user });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({ status: 200, json: { csrf_token: 'products-e2e-csrf' } satisfies components['schemas']['CsrfToken'] });
        return;
      }
      const factVersionMatch = url.pathname.match(/^\/api\/v1\/fact-versions\/([^/]+)$/);
      if (factVersionMatch && request.method() === 'GET') {
        factVersionRequests.push(url);
        if (factVersionMode === 'loading') {
          await new Promise<void>((resolve) => { releaseFactVersionLoading = resolve; });
        }
        if (factVersionMode !== 'success' && factVersionMode !== 'loading') {
          const response = factVersionMode === 'not-found'
            ? { status: 404, code: 'NOT_FOUND', message: '事实版本不存在' }
            : factVersionMode === 'forbidden'
              ? { status: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: '必须先修改临时密码' }
              : { status: 503, code: 'FACT_VERSION_UNAVAILABLE', message: '事实版本服务暂不可用' };
          await route.fulfill({
            status: response.status,
            json: { error: { code: response.code, message: response.message, details: {}, request_id: `req-fact-version-${factVersionMode}` } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        if (!factVersionOverride || factVersionOverride.id !== factVersionMatch[1]) {
          await route.fulfill({
            status: 404,
            json: { error: { code: 'NOT_FOUND', message: '事实版本不存在', details: {}, request_id: 'req-fact-version-missing' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        await route.fulfill({ status: 200, json: factVersionOverride });
        return;
      }
      const factReviewMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/fact-review-context$/);
      if (factReviewMatch && request.method() === 'GET') {
        factReviewRequests.push(url);
        if (factReviewMode === 'loading') {
          await new Promise<void>((resolve) => { releaseFactReviewLoading = resolve; });
        }
        if (!['success', 'empty', 'loading'].includes(factReviewMode)) {
          const response = factReviewMode === 'not-found'
            ? { status: 404, code: 'PRODUCT_NOT_FOUND', message: '产品不存在' }
            : factReviewMode === 'forbidden'
              ? { status: 403, code: 'PERMISSION_DENIED', message: '没有查看事实审核工作台的权限' }
              : { status: 503, code: 'FACT_REVIEW_UNAVAILABLE', message: '事实审核服务暂不可用' };
          await route.fulfill({
            status: response.status,
            json: { error: { code: response.code, message: response.message, details: {}, request_id: `req-fact-review-${factReviewMode}` } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === factReviewMatch[1]);
        const workspace = factReviewOverride?.product.id === factReviewMatch[1]
          ? factReviewOverride
          : item ? createFactReviewWorkspace(item) : undefined;
        if (!workspace) {
          await route.fulfill({
            status: 404,
            json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-fact-review-missing' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        await route.fulfill({
          status: 200,
          json: factReviewMode === 'empty' ? { ...workspace, review: null } : workspace,
        });
        return;
      }
      const factDecisionMatch = url.pathname.match(/^\/api\/v1\/fact-versions\/([^/]+)\/(approve|request-changes)$/);
      if (factDecisionMatch && request.method() === 'POST') {
        const body = request.postDataJSON() as CommandRequest;
        const requestRecord = {
          body,
          factVersionId: factDecisionMatch[1],
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        };
        const approving = factDecisionMatch[2] === 'approve';
        if (approving) factApproveRequests.push(requestRecord);
        else factRequestChangesRequests.push(requestRecord);
        const mutationMode = approving ? factApproveMode : factRequestChangesMode;
        if (mutationMode === 'revision-conflict') {
          await route.fulfill({
            status: 409,
            json: { error: { code: 'REVISION_CONFLICT', message: '事实版本已被其他请求修改', details: {}, request_id: 'req-fact-review-conflict' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const current = factReviewOverride ?? createFactReviewWorkspace(items[0]);
        if (!current.review || current.review.fact_version.id !== factDecisionMatch[1]) {
          await route.fulfill({ status: 404, json: { error: { code: 'FACT_VERSION_NOT_FOUND', message: '事实版本不存在', details: {}, request_id: 'req-fact-review-version-missing' } } });
          return;
        }
        const canonical = {
          ...current.review.fact_version,
          status: approving ? 'APPROVED' : 'CHANGES_REQUESTED',
          primary_task: approving ? 'CREATE_CONTENT_TASK' : 'REVISE_FACT',
          available_actions: approving ? ['RETIRE'] : [],
          revision: current.review.fact_version.revision + 1,
          approved_by: approving ? user.id : null,
          approved_at: approving ? '2026-08-09T12:00:00Z' : null,
        } satisfies FactVersion;
        factReviewOverride = {
          ...current,
          product: { ...current.product, workflow_stage: approving ? 'FACT_APPROVED' : 'FACT_CHANGES_REQUESTED' },
          review: {
            ...current.review,
            fact_version: canonical,
            available_actions: [],
            review_history: [...current.review.review_history, {
              id: approving ? '50000000-0000-4000-8000-000000000002' : '50000000-0000-4000-8000-000000000003',
              target_id: canonical.id,
              target_version: canonical.version,
              action: approving ? 'approve' : 'request-changes',
              comment: body.comment,
              actor: { id: user.id, username: user.username, display_name: user.display_name },
              created_at: '2026-08-09T12:00:00Z',
            }],
          },
        };
        await route.fulfill({ status: 200, json: canonical });
        return;
      }
      const factsMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/facts$/);
      if (factsMatch && request.method() === 'GET') {
        factRequests.push(url);
        if (factsMode === 'loading') {
          await new Promise<void>((resolve) => { releaseFactsLoading = resolve; });
        }
        if (factsMode !== 'success' && factsMode !== 'loading') {
          const response = factsMode === 'not-found'
            ? { status: 404, code: 'PRODUCT_NOT_FOUND', message: '产品不存在' }
            : factsMode === 'forbidden'
              ? { status: 403, code: 'PERMISSION_DENIED', message: '没有查看事实工作台的权限' }
              : { status: 503, code: 'PRODUCT_FACTS_UNAVAILABLE', message: '事实工作台服务暂不可用' };
          await route.fulfill({
            status: response.status,
            json: { error: { code: response.code, message: response.message, details: {}, request_id: `req-facts-${factsMode}` } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === factsMatch[1]);
        const workspace = factsOverride?.product_id === factsMatch[1]
          ? factsOverride
          : item ? createProductFacts(item) : undefined;
        if (!workspace) {
          await route.fulfill({
            status: 404,
            json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-facts-missing' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        await route.fulfill({ status: 200, json: workspace });
        return;
      }
      if (factsMatch && request.method() === 'PUT') {
        const body = request.postDataJSON() as ProductFactsDraftUpdate;
        factSaveRequests.push({ body, productId: factsMatch[1], csrfToken: request.headers()['x-csrf-token'] ?? null });
        if (factSaveMode === 'revision-conflict') {
          await route.fulfill({
            status: 409,
            json: { error: { code: 'REVISION_CONFLICT', message: '事实工作区已被其他请求修改', details: {}, request_id: 'req-facts-conflict' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === factsMatch[1]);
        const current = factsOverride?.product_id === factsMatch[1]
          ? factsOverride
          : item ? createProductFacts(item) : undefined;
        if (!current) {
          await route.fulfill({ status: 404, json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-facts-save-missing' } } });
          return;
        }
        factsOverride = {
          ...current,
          body_markdown: body.body_markdown,
          classification: body.classification,
          revision: current.revision + 1,
        };
        await route.fulfill({ status: 200, json: factsOverride });
        return;
      }
      const factSubmissionMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/fact-review-submissions$/);
      if (factSubmissionMatch && request.method() === 'POST') {
        const body = request.postDataJSON() as FactReviewSubmissionRequest;
        factSubmitRequests.push({ body, productId: factSubmissionMatch[1], csrfToken: request.headers()['x-csrf-token'] ?? null });
        if (factSubmitMode === 'revision-conflict') {
          await route.fulfill({
            status: 409,
            json: { error: { code: 'REVISION_CONFLICT', message: '事实工作区已被其他请求修改', details: {}, request_id: 'req-facts-submit-conflict' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === factSubmissionMatch[1]);
        const current = factsOverride?.product_id === factSubmissionMatch[1]
          ? factsOverride
          : item ? createProductFacts(item) : undefined;
        if (!current) {
          await route.fulfill({ status: 404, json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-facts-submit-missing' } } });
          return;
        }
        const version = {
          id: '10000000-0000-4000-8000-000000000003',
          product_id: current.product_id,
          version: 3,
          status: 'PENDING_REVIEW',
          body_markdown: current.body_markdown,
          classification: current.classification,
          change_summary: body.change_summary,
          primary_task: 'REVIEW_FACT',
          available_actions: ['APPROVE', 'REQUEST_CHANGES'],
          deletion: null,
          revision: 0,
          created_by: user.id,
          approved_by: null,
          created_at: '2026-08-09T11:00:00Z',
          approved_at: null,
        } satisfies FactVersion;
        factsOverride = {
          ...current,
          product: { ...current.product, workflow_stage: 'FACT_REVIEW_PENDING' },
          pending_fact: { version: version.version, status: version.status },
          available_actions: ['SAVE'],
        };
        await route.fulfill({ status: 201, json: version });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/products') {
        productRequests.push(url);
        if (mode === 'loading') {
          await new Promise<void>((resolve) => { releaseLoading = resolve; });
        }
        if (mode === 'error') {
          await route.fulfill({
            status: 503,
            json: { error: { code: 'PRODUCTS_UNAVAILABLE', message: '产品服务暂不可用', details: {}, request_id: 'req-products-e2e' } },
          });
          return;
        }
        const data = listProducts(mode === 'empty' ? [] : items, url);
        await route.fulfill({ status: 200, json: data });
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/detail$/);
      if (request.method() === 'GET' && detailMatch) {
        detailRequests.push(url);
        if (detailMode !== 'success') {
          const response = detailMode === 'not-found'
            ? { status: 404, code: 'PRODUCT_NOT_FOUND', message: '产品不存在' }
            : detailMode === 'forbidden'
              ? { status: 403, code: 'PERMISSION_DENIED', message: '没有查看该产品的权限' }
              : { status: 503, code: 'PRODUCT_DETAIL_UNAVAILABLE', message: '产品详情服务暂不可用' };
          await route.fulfill({
            status: response.status,
            json: { error: { code: response.code, message: response.message, details: {}, request_id: `req-detail-${detailMode}` } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const item = items.find((candidate) => candidate.id === detailMatch[1]);
        if (!item && detailOverride?.product.id !== detailMatch[1]) {
          await route.fulfill({
            status: 404,
            json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-detail-missing' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        await route.fulfill({ status: 200, json: detailOverride?.product.id === detailMatch[1] ? detailOverride : createProductDetail(item!) });
        return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/products') {
        const body = request.postDataJSON() as ProductCreate;
        createRequests.push({ body, csrfToken: request.headers()['x-csrf-token'] ?? null });
        if (createMode === 'pending') {
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
        }
        if (createMode === 'duplicate') {
          await route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'PRODUCT_ALREADY_EXISTS',
                message: '品牌与产品型号组合已存在',
                details: {
                  errors: [
                    { loc: ['body', 'part_number'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
                    { loc: ['body', 'brand'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
                  ],
                },
                request_id: 'req-product-duplicate',
              },
            } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        if (createMode === 'validation') {
          await route.fulfill({
            status: 422,
            json: {
              error: {
                code: 'VALIDATION_ERROR',
                message: '请求数据不符合接口契约',
                details: { errors: [{ loc: ['body', 'category'], msg: '类别不受支持', type: 'value_error' }] },
                request_id: 'req-product-validation',
              },
            } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        if (createMode === 'forbidden') {
          await route.fulfill({
            status: 403,
            json: {
              error: {
                code: 'PERMISSION_DENIED',
                message: '没有创建产品的权限',
                details: {},
                request_id: 'req-product-forbidden',
              },
            } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const product = {
          id: '00000000-0000-4000-8000-999999999999',
          ...body,
          status: 'ACTIVE',
          workflow_stage: 'FACTS_EMPTY',
          primary_task: 'ENTER_FACTS',
          available_actions: ['UPDATE', 'DELETE'],
          deletion: { blockers: [] },
          revision: 0,
          created_at: '2026-08-09T08:00:00Z',
          updated_at: '2026-08-09T08:00:00Z',
        } satisfies Product;
        items = [{ ...product, fact_status: 'NOT_ENTERED', current_fact: null }, ...items];
        await route.fulfill({ status: 201, json: product });
        return;
      }

      const productMatch = url.pathname.match(/^\/api\/v1\/products\/([^/]+)$/);
      if (request.method() === 'PATCH' && productMatch) {
        const body = request.postDataJSON() as ProductUpdate;
        updateRequests.push({ body, productId: productMatch[1], csrfToken: request.headers()['x-csrf-token'] ?? null });
        if (updateMode === 'revision-conflict') {
          await route.fulfill({
            status: 409,
            json: { error: { code: 'REVISION_CONFLICT', message: '产品已被其他请求更新', details: {}, request_id: 'req-update-conflict' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        const itemIndex = items.findIndex((item) => item.id === productMatch[1]);
        const current = detailOverride?.product.id === productMatch[1]
          ? detailOverride.product
          : itemIndex >= 0 ? createProductDetail(items[itemIndex]).product : undefined;
        if (!current) {
          await route.fulfill({ status: 404, json: { error: { code: 'PRODUCT_NOT_FOUND', message: '产品不存在', details: {}, request_id: 'req-update-missing' } } });
          return;
        }
        const product: Product = { ...current, ...body, revision: current.revision + 1, updated_at: '2026-08-09T10:00:00Z' };
        if (itemIndex >= 0) items[itemIndex] = { ...items[itemIndex], ...product };
        detailOverride = { ...(detailOverride ?? createProductDetail(items[itemIndex])), product };
        await route.fulfill({ status: 200, json: product });
        return;
      }
      if (request.method() === 'DELETE' && productMatch) {
        deleteRequests.push({
          productId: productMatch[1],
          expectedRevision: Number(url.searchParams.get('expected_revision')) || null,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (deleteMode === 'revision-conflict') {
          await route.fulfill({
            status: 409,
            json: { error: { code: 'REVISION_CONFLICT', message: '产品已被其他请求更新', details: {}, request_id: 'req-delete-conflict' } } satisfies components['schemas']['ErrorEnvelope'],
          });
          return;
        }
        items = items.filter((item) => item.id !== productMatch[1]);
        detailOverride = undefined;
        await route.fulfill({ status: 204 });
        return;
      }

      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 501, json: { error: { code: 'PRODUCTS_FIXTURE_UNEXPECTED_API', message: 'Products 页面发起了未声明的 API 请求' } } });
    });

    await use({
      createRequests,
      deleteRequests,
      detailRequests,
      factRequests,
      factSaveRequests,
      factSubmitRequests,
      factReviewRequests,
      factVersionRequests,
      factApproveRequests,
      factRequestChangesRequests,
      productRequests,
      updateRequests,
      releaseCreate: () => {
        if (!releaseCreate) throw new Error('Product create pending 请求尚未开始');
        createMode = 'success';
        releaseCreate();
      },
      releaseLoading: () => {
        if (!releaseLoading) throw new Error('Products loading 请求尚未开始');
        mode = 'success';
        releaseLoading();
      },
      releaseFactsLoading: () => {
        if (!releaseFactsLoading) throw new Error('Fact Workspace loading 请求尚未开始');
        factsMode = 'success';
        releaseFactsLoading();
      },
      releaseFactReviewLoading: () => {
        if (!releaseFactReviewLoading) throw new Error('Fact Review loading 请求尚未开始');
        factReviewMode = 'success';
        releaseFactReviewLoading();
      },
      releaseFactVersionLoading: () => {
        if (!releaseFactVersionLoading) throw new Error('Fact Version loading 请求尚未开始');
        factVersionMode = 'success';
        releaseFactVersionLoading();
      },
      setCreateMode: (nextMode) => { createMode = nextMode; },
      setDeleteMode: (nextMode) => { deleteMode = nextMode; },
      setDetail: (detail) => { detailOverride = detail; },
      setDetailMode: (nextMode) => { detailMode = nextMode; },
      setItems: (nextItems) => { items = nextItems; },
      setMode: (nextMode) => { mode = nextMode; },
      setUpdateMode: (nextMode) => { updateMode = nextMode; },
      setFactWorkspace: (workspace) => { factsOverride = workspace; },
      setFactsMode: (nextMode) => { factsMode = nextMode; },
      setFactSaveMode: (nextMode) => { factSaveMode = nextMode; },
      setFactSubmitMode: (nextMode) => { factSubmitMode = nextMode; },
      setFactReviewWorkspace: (workspace) => { factReviewOverride = workspace; },
      setFactReviewMode: (nextMode) => { factReviewMode = nextMode; },
      setFactApproveMode: (nextMode) => { factApproveMode = nextMode; },
      setFactRequestChangesMode: (nextMode) => { factRequestChangesMode = nextMode; },
      setFactVersion: (version) => { factVersionOverride = version; },
      setFactVersionMode: (nextMode) => { factVersionMode = nextMode; },
    });

    expect(unexpectedRequests, 'Products 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Products 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { createFactReviewWorkspace, createFactVersion, createProductDetail, createProductFacts, createProducts, expect, test };
export type {
  Product,
  ProductCreate,
  ProductDetail,
  ProductFactsDraft,
  ProductFactReviewWorkspace,
  FactVersion,
  ProductListItem,
  ProductsApiController,
};
