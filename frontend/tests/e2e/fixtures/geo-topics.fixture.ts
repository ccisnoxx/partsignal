/** GEO Query Topics 页面的 generated-type 严格 fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ListMode = 'success' | 'empty' | 'error' | 'loading';
type MutationMode = 'success' | 'conflict' | 'in-use';
type QueryTopicCreate = components['schemas']['QueryTopicCreate'];
type QueryTopicUpdate = components['schemas']['QueryTopicUpdate'];
type QueryTopicListItem = components['schemas']['QueryTopicListItem'];

type MutationRequest = {
  body: QueryTopicCreate | QueryTopicUpdate | null;
  csrfToken: string | null;
  expectedRevision: number | null;
  method: string;
  pathname: string;
};

type GeoTopicsController = {
  listRequests: URL[];
  mutationRequests: MutationRequest[];
  releaseLoading: () => void;
  setListMode: (mode: ListMode) => void;
  setMutationMode: (mode: MutationMode) => void;
};

type GeoTopicsFixtures = { geoTopicsApi: GeoTopicsController };

const topicIds = {
  blocked: '40000000-0000-4000-8000-000000000001',
  deletable: '40000000-0000-4000-8000-000000000002',
} as const;

const user = {
  id: '10000000-0000-4000-8000-000000000001',
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
  created_at: '2026-08-13T00:00:00Z',
} satisfies components['schemas']['User'];

const blockedTopic = {
  id: topicIds.blocked,
  canonical_question: '如何选择低噪声放大器？',
  intent_type: 'PRODUCT',
  variants: ['低噪声放大器选型', 'LNA 选型', '射频前端低噪声器件'],
  references: {
    content_task_count: 2,
    geo_optimization_count: 1,
    observation_count: 3,
  },
  available_actions: ['UPDATE'],
  deletion: {
    blockers: [
      { type: 'CONTENT_TASK', count: 2 },
      { type: 'GEO_OPTIMIZATION_SOURCE', count: 1 },
      { type: 'GEO_OBSERVATION', count: 3 },
    ],
  },
  primary_task: 'USE_FOR_OBSERVATION',
  revision: 4,
  created_at: '2026-08-01T00:00:00Z',
} satisfies QueryTopicListItem;

const deletableTopic = {
  ...blockedTopic,
  id: topicIds.deletable,
  canonical_question: '如何比较不同厂商的射频器件？',
  intent_type: 'COMPARISON',
  variants: ['射频器件横向比较'],
  references: { content_task_count: 0, geo_optimization_count: 0, observation_count: 0 },
  available_actions: ['UPDATE', 'DELETE'],
  deletion: { blockers: [] },
  revision: 1,
} satisfies QueryTopicListItem;

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

function queryTopicOut(item: QueryTopicListItem): components['schemas']['QueryTopic'] {
  const { references: _references, ...topic } = item;
  void _references;
  return topic;
}

const test = base.extend<GeoTopicsFixtures>({
  geoTopicsApi: [async ({ page }, use) => {
    let listMode: ListMode = 'success';
    let mutationMode: MutationMode = 'success';
    let releaseList: (() => void) | undefined;
    let currentItems: QueryTopicListItem[] = [
      blockedTopic,
      deletableTopic,
      ...Array.from({ length: 9 }, (_, index) => ({
        ...deletableTopic,
        id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        canonical_question: `分页测试问题 ${String(index + 1).padStart(2, '0')}`,
        variants: [`分页变体 ${index + 1}`],
      } satisfies QueryTopicListItem)),
    ];
    const listRequests: URL[] = [];
    const mutationRequests: MutationRequest[] = [];
    const conflicted = new Set<string>();
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) {
        runtimeErrors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));

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
          json: { csrf_token: 'geo-topics-csrf' } satisfies components['schemas']['CsrfToken'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/query-topics/list-items') {
        listRequests.push(url);
        if (listMode === 'loading') {
          await new Promise<void>((resolve) => { releaseList = resolve; });
        }
        if (listMode === 'error') {
          await route.fulfill({
            status: 409,
            json: errorEnvelope('QUERY_TOPIC_LIST_FAILED', 'Query Topic 列表读取失败', 'req-topic-list'),
          });
          return;
        }
        const q = url.searchParams.get('q')?.toLocaleLowerCase('zh-CN');
        const sort = url.searchParams.get('sort') ?? 'QUESTION_ASC';
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20) as 10 | 20 | 50;
        const filtered = listMode === 'empty' ? [] : currentItems.filter((item) => (
          !q
          || item.canonical_question.toLocaleLowerCase('zh-CN').includes(q)
          || item.variants.some((variant) => variant.toLocaleLowerCase('zh-CN').includes(q))
        ));
        const sorted = [...filtered].sort((left, right) => {
          const leftValue = sort.startsWith('INTENT') ? left.intent_type : left.canonical_question;
          const rightValue = sort.startsWith('INTENT') ? right.intent_type : right.canonical_question;
          const order = leftValue.localeCompare(rightValue, 'zh-CN') || left.id.localeCompare(right.id);
          return sort.endsWith('DESC') ? -order : order;
        });
        await route.fulfill({
          status: 200,
          json: {
            items: sorted.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
            page: pageNumber,
            page_size: pageSize,
            total: sorted.length,
          } satisfies components['schemas']['QueryTopicListPage'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/query-topics') {
        await route.fulfill({
          status: 200,
          json: { items: currentItems.map(queryTopicOut) } satisfies components['schemas']['QueryTopicList'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/query-topics') {
        const body = request.postDataJSON() as QueryTopicCreate;
        mutationRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision: null,
          method,
          pathname: url.pathname,
        });
        const created = {
          ...deletableTopic,
          id: '60000000-0000-4000-8000-000000000001',
          canonical_question: body.canonical_question.trim(),
          intent_type: body.intent_type,
          variants: body.variants.map((item) => item.trim()),
          revision: 0,
        } satisfies QueryTopicListItem;
        currentItems = [...currentItems, created];
        await route.fulfill({ status: 201, json: queryTopicOut(created) });
        return;
      }

      const topicMatch = url.pathname.match(/^\/api\/v1\/query-topics\/([^/]+)$/);
      if (topicMatch && (method === 'PATCH' || method === 'DELETE')) {
        const id = topicMatch[1]!;
        const body = method === 'PATCH' ? request.postDataJSON() as QueryTopicUpdate : null;
        mutationRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision: method === 'DELETE'
            ? Number(url.searchParams.get('expected_revision'))
            : body?.expected_revision ?? null,
          method,
          pathname: url.pathname,
        });
        const index = currentItems.findIndex((item) => item.id === id);
        if (index < 0) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '目标问题不存在', 'req-topic-missing') });
          return;
        }
        if (mutationMode === 'conflict') {
          if (!conflicted.has(id)) {
            currentItems[index] = {
              ...currentItems[index]!,
              canonical_question: `${currentItems[index]!.canonical_question}（外部更新）`,
              revision: currentItems[index]!.revision + 1,
            };
            conflicted.add(id);
          }
          await route.fulfill({ status: 409, json: errorEnvelope('REVISION_CONFLICT', '目标问题已被其他请求修改', 'req-topic-conflict') });
          return;
        }
        if (mutationMode === 'in-use' && method === 'DELETE') {
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'QUERY_TOPIC_IN_USE',
              '目标问题仍被以下对象引用：内容任务（2）、GEO 观测（3）',
              'req-topic-in-use',
              { references: [
                { type: 'CONTENT_TASK', count: 2 },
                { type: 'GEO_OBSERVATION', count: 3 },
              ] },
            ),
          });
          return;
        }
        if (method === 'PATCH' && body) {
          currentItems[index] = {
            ...currentItems[index]!,
            canonical_question: body.canonical_question.trim(),
            intent_type: body.intent_type,
            variants: body.variants.map((item) => item.trim()),
            revision: currentItems[index]!.revision + 1,
          };
          await route.fulfill({ status: 200, json: queryTopicOut(currentItems[index]!) });
          return;
        }
        currentItems = currentItems.filter((item) => item.id !== id);
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({
        status: 501,
        json: errorEnvelope('GEO_TOPICS_FIXTURE_UNEXPECTED_API', 'Topics fixture 收到未声明 API', 'req-topics-unexpected'),
      });
    });

    await use({
      listRequests,
      mutationRequests,
      releaseLoading: () => releaseList?.(),
      setListMode: (mode) => { listMode = mode; },
      setMutationMode: (mode) => { mutationMode = mode; },
    });

    expect(unexpectedRequests, 'Topics 页面不得依赖未声明 API 或浏览器逐行 join').toEqual([]);
    expect(runtimeErrors, 'Topics 页面不得产生未声明运行时错误').toEqual([]);
  }, { auto: true }],
});

export { blockedTopic, deletableTopic, expect, test, topicIds };
