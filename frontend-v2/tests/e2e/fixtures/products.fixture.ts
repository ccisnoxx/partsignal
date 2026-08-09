/** Products 页面/路由测试 fixture；显式隔离真实后端，不代表完整业务 E2E。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ProductListItem = components['schemas']['ProductListItem'];
type ProductList = components['schemas']['ProductList'];
type ProductMode = 'success' | 'empty' | 'error' | 'loading';

type ProductsApiController = {
  productRequests: URL[];
  releaseLoading: () => void;
  setItems: (items: ProductListItem[]) => void;
  setMode: (mode: ProductMode) => void;
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

const test = base.extend<ProductsFixtures>({
  productsApi: [async ({ page }, use) => {
    let items = createProducts();
    let mode: ProductMode = 'success';
    let releaseLoading: (() => void) | undefined;
    const productRequests: URL[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      // 预期且已由页面处理的 503 仍会被 Chromium 记录为资源错误，不属于未处理异常。
      if (mode === 'error' && message.text().includes('503 (Service Unavailable)')) return;
      if (message.type() === 'error') runtimeErrors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`));

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

      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 501, json: { error: { code: 'PRODUCTS_FIXTURE_UNEXPECTED_API', message: 'Products 页面发起了未声明的 API 请求' } } });
    });

    await use({
      productRequests,
      releaseLoading: () => {
        if (!releaseLoading) throw new Error('Products loading 请求尚未开始');
        mode = 'success';
        releaseLoading();
      },
      setItems: (nextItems) => { items = nextItems; },
      setMode: (nextMode) => { mode = nextMode; },
    });

    expect(unexpectedRequests, 'Products 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Products 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { createProducts, expect, test };
export type { ProductListItem, ProductsApiController };
