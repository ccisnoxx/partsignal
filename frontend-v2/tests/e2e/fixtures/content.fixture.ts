/** Content Tasks 页面 fixture；只声明本页面真实使用的 API。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type ContentTaskListItem = components['schemas']['ContentTaskListItem'];
type ContentTaskListMode = 'success' | 'empty' | 'error' | 'loading';
type MutationMode = 'success' | 'revision-conflict';

type LifecycleRequest = {
  body: unknown;
  csrfToken: string | null;
  expectedRevision: number | null;
  method: string;
  pathname: string;
};

type ContentApiController = {
  listRequests: URL[];
  lifecycleRequests: LifecycleRequest[];
  releaseLoading: () => void;
  setListMode: (mode: ContentTaskListMode) => void;
  setMutationMode: (mode: MutationMode) => void;
};

type ContentFixtures = { contentApi: ContentApiController };

const platformId = '00000000-0000-4000-8000-000000000201';

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

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<ContentFixtures>({
  contentApi: [async ({ page }, use) => {
    const items = createContentTasks();
    let listMode: ContentTaskListMode = 'success';
    let mutationMode: MutationMode = 'success';
    let releaseLoading: (() => void) | undefined;
    const listRequests: URL[] = [];
    const lifecycleRequests: LifecycleRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('console', (message) => {
      if (['503 (Service Unavailable)', '409 (Conflict)'].some((status) => message.text().includes(status))) return;
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
      if (lifecycleMatch && (method === 'POST' || method === 'DELETE')) {
        const body = request.postDataJSON() as unknown;
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
        if (method === 'DELETE' || lifecycleMatch[2] === 'permanent-delete') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        await route.fulfill({ status: 200, json: items.find((item) => item.id === lifecycleMatch[1]) ?? items[0] });
        return;
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorEnvelope('CONTENT_FIXTURE_UNEXPECTED_API', 'Content fixture 收到未声明的 API 请求', 'req-content-unexpected') });
    });

    await use({
      listRequests,
      lifecycleRequests,
      releaseLoading: () => {
        if (!releaseLoading) throw new Error('Content loading 请求尚未开始');
        listMode = 'success';
        releaseLoading();
      },
      setListMode: (mode) => { listMode = mode; },
      setMutationMode: (mode) => { mutationMode = mode; },
    });

    expect(unexpectedRequests, 'Content Tasks 页面不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'Content Tasks 页面不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { expect, platformId, test };
