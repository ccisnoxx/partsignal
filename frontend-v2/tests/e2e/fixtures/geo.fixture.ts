/** GEO Observation List 的 production-artifact 严格 API fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ListMode = 'success' | 'empty' | 'error' | 'loading';
type DeleteMode = 'success' | 'conflict';
type DeleteRequest = { path: string; csrfToken: string | null };
type GeoApiController = {
  deleteRequests: DeleteRequest[];
  listRequests: URL[];
  releaseLoading: () => void;
  setDeleteMode: (mode: DeleteMode) => void;
  setListMode: (mode: ListMode) => void;
};
type GeoFixtures = { geoApi: GeoApiController };
type GeoObservationListItem = components['schemas']['GeoObservationListItem'];

const geoIds = {
  admin: '10000000-0000-4000-8000-000000000001',
  product: '20000000-0000-4000-8000-000000000001',
  manual: '30000000-0000-4000-8000-000000000001',
  engineer: '30000000-0000-4000-8000-000000000002',
  legacy: '30000000-0000-4000-8000-000000000003',
} as const;

const user = {
  id: geoIds.admin,
  username: 'geo-admin',
  display_name: 'GEO 系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-12T00:00:00Z',
} satisfies components['schemas']['User'];

const manualObservation = {
  id: geoIds.manual,
  observation_kind: 'MANUAL_ARTICLE_SEARCH',
  query_text: '如何判断一款低噪声放大器是否适合高可靠性射频前端？',
  product: { id: geoIds.product, label: 'PartSignal PS-LNA-VERY-LONG-001' },
  geo_platform: 'DeepSeek Web Search',
  outcomes: {
    discovered: { positive_count: 2, assessed_count: 3, total_count: 3 },
    mentioned: { positive_count: 1, assessed_count: 3, total_count: 3 },
    accuracy: { positive_count: 1, assessed_count: 1, total_count: 3 },
  },
  related_achievement_count: 3,
  evidence_count: 2,
  recorder: {
    id: geoIds.admin,
    username: 'geo-admin',
    display_name: '一位名字很长的 GEO 观测记录人',
  },
  observed_at: '2026-08-12T08:00:00Z',
  available_actions: ['CORRECT', 'DELETE'],
} satisfies GeoObservationListItem;

const observations = [
  manualObservation,
  {
    ...manualObservation,
    id: geoIds.engineer,
    query_text: '怎样比较不同厂商的射频器件？',
    evidence_count: 0,
    available_actions: ['CORRECT'],
  },
  {
    ...manualObservation,
    id: geoIds.legacy,
    observation_kind: 'LEGACY_MODEL_RESULT',
    query_text: '旧模型是否提及目标产品？',
    geo_platform: 'ChatGPT',
    outcomes: {
      discovered: null,
      mentioned: { positive_count: 1, assessed_count: 1, total_count: 1 },
      accuracy: { positive_count: 0, assessed_count: 0, total_count: 1 },
    },
    related_achievement_count: 0,
    evidence_count: 0,
    available_actions: [],
  },
] satisfies GeoObservationListItem[];

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<GeoFixtures>({
  geoApi: [async ({ page }, use) => {
    let listMode: ListMode = 'success';
    let deleteMode: DeleteMode = 'success';
    let releaseList: (() => void) | undefined;
    let currentItems = [...observations];
    const listRequests: URL[] = [];
    const deleteRequests: DeleteRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) {
        runtimeErrors.push(`console.error: ${message.text()}`);
      }
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
          json: { csrf_token: 'geo-e2e-csrf' } satisfies components['schemas']['CsrfToken'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/geo-observations/list-items') {
        listRequests.push(url);
        if (listMode === 'loading') {
          await new Promise<void>((resolve) => { releaseList = resolve; });
        }
        if (listMode === 'error') {
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'GEO_OBSERVATION_CONTEXT_INCOMPLETE',
              'GEO 观测上下文不完整',
              'req-geo-list',
            ),
          });
          return;
        }
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20) as 10 | 20 | 50;
        const available = listMode === 'empty' ? [] : currentItems;
        await route.fulfill({
          status: 200,
          json: {
            items: available.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: available.length,
          } satisfies components['schemas']['GeoObservationListPage'],
        });
        return;
      }
      const match = url.pathname.match(/^\/api\/v1\/geo-observations\/([^/]+)$/);
      if (method === 'DELETE' && match) {
        deleteRequests.push({
          path: url.pathname,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (deleteMode === 'conflict') {
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'GEO_OBSERVATION_HAS_SUCCESSOR',
              '该观测已有后继更正',
              'req-geo-delete',
            ),
          });
          return;
        }
        currentItems = currentItems.filter((item) => item.id !== match[1]);
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({
        status: 501,
        json: errorEnvelope(
          'GEO_FIXTURE_UNEXPECTED_API',
          'GEO fixture 收到未声明的 API 请求',
          'req-geo-unexpected',
        ),
      });
    });

    await use({
      deleteRequests,
      listRequests,
      releaseLoading: () => releaseList?.(),
      setDeleteMode: (mode) => { deleteMode = mode; },
      setListMode: (mode) => { listMode = mode; },
    });

    expect(unexpectedRequests, 'GEO 列表不得依赖未声明 API 或客户端 join').toEqual([]);
    expect(runtimeErrors, 'GEO 页面不得产生未声明运行时错误').toEqual([]);
  }, { auto: true }],
});

export { expect, geoIds, manualObservation, test };
