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
type ProductsListMode = 'success' | 'empty' | 'error' | 'loading';
type ProductCreateMode = 'success' | 'duplicate' | 'validation' | 'forbidden' | 'pending';
type ProductDetailMode = 'success' | 'not-found' | 'forbidden' | 'error';
type ProductMutationMode = 'success' | 'revision-conflict';

type ProductCreateRequest = {
  body: ProductCreate;
  csrfToken: string | null;
};

type ProductUpdateRequest = { body: ProductUpdate; csrfToken: string | null; productId: string };
type ProductDeleteRequest = { csrfToken: string | null; expectedRevision: number | null; productId: string };

type ProductsApiController = {
  productRequests: URL[];
  detailRequests: URL[];
  createRequests: ProductCreateRequest[];
  updateRequests: ProductUpdateRequest[];
  deleteRequests: ProductDeleteRequest[];
  releaseCreate: () => void;
  releaseLoading: () => void;
  setCreateMode: (mode: ProductCreateMode) => void;
  setDeleteMode: (mode: ProductMutationMode) => void;
  setDetail: (detail: ProductDetail) => void;
  setDetailMode: (mode: ProductDetailMode) => void;
  setItems: (items: ProductListItem[]) => void;
  setMode: (mode: ProductsListMode) => void;
  setUpdateMode: (mode: ProductMutationMode) => void;
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
      workflow_stage: item.workflow_stage,
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

const test = base.extend<ProductsFixtures>({
  productsApi: [async ({ page }, use) => {
    let items = createProducts();
    let mode: ProductsListMode = 'success';
    let createMode: ProductCreateMode = 'success';
    let detailMode: ProductDetailMode = 'success';
    let updateMode: ProductMutationMode = 'success';
    let deleteMode: ProductMutationMode = 'success';
    let detailOverride: ProductDetail | undefined;
    let releaseLoading: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    const productRequests: URL[] = [];
    const detailRequests: URL[] = [];
    const createRequests: ProductCreateRequest[] = [];
    const updateRequests: ProductUpdateRequest[] = [];
    const deleteRequests: ProductDeleteRequest[] = [];
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
      setCreateMode: (nextMode) => { createMode = nextMode; },
      setDeleteMode: (nextMode) => { deleteMode = nextMode; },
      setDetail: (detail) => { detailOverride = detail; },
      setDetailMode: (nextMode) => { detailMode = nextMode; },
      setItems: (nextItems) => { items = nextItems; },
      setMode: (nextMode) => { mode = nextMode; },
      setUpdateMode: (nextMode) => { updateMode = nextMode; },
    });

    expect(unexpectedRequests, 'Products 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Products 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { createProductDetail, createProducts, expect, test };
export type { Product, ProductCreate, ProductDetail, ProductListItem, ProductsApiController };
