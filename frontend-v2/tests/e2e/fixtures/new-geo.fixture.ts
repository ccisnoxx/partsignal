/** 新建 GEO Observation 的 generated-type 严格 fixture。 */
import { expect } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';
import { geoIds, test as base } from './geo.fixture';

type CandidateMode = 'success' | 'empty' | 'loading';
type CreateMode = 'success' | 'conflict' | 'pending';
type GeoObservationCreate = components['schemas']['GeoObservationCreate'];
type GeoPublicationCandidate = components['schemas']['GeoPublicationCandidate'];

type CreateRequest = {
  body: GeoObservationCreate;
  csrfToken: string | null;
  idempotencyKey: string | null;
};

type NewGeoApiController = {
  candidateRequests: URL[];
  createRequests: CreateRequest[];
  detailRequests: URL[];
  uploadRequests: string[];
  releaseCandidates: () => void;
  releaseCreate: () => void;
  setCandidateMode: (mode: CandidateMode) => void;
  setCreateMode: (mode: CreateMode) => void;
};

type NewGeoFixtures = { newGeoApi: NewGeoApiController };

const product = {
  id: geoIds.product,
  part_number: 'PS-LNA-001',
  brand: 'PartSignal',
  category: 'RF',
  status: 'ACTIVE',
  workflow_stage: 'FACT_APPROVED',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: ['UPDATE'],
  deletion: { blockers: [] },
  revision: 3,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-12T00:00:00Z',
  fact_status: 'APPROVED',
  current_fact: { version: 3, status: 'APPROVED' },
} satisfies components['schemas']['ProductListItem'];

const topic = {
  id: '40000000-0000-4000-8000-000000000001',
  canonical_question: '如何选择低噪声放大器？',
  intent_type: 'PRODUCT',
  variants: ['低噪声放大器选型'],
  available_actions: ['UPDATE'],
  deletion: { blockers: [] },
  primary_task: 'USE_FOR_OBSERVATION',
  revision: 1,
  created_at: '2026-08-01T00:00:00Z',
} satisfies components['schemas']['QueryTopic'];

const candidates = [{
  published_article_id: '50000000-0000-4000-8000-000000000001',
  title: 'PS-LNA-001 选型指南',
  platform_name: '官网',
  final_url: 'https://example.test/articles/ps-lna-001',
  status: 'COMPLETED',
}, {
  published_article_id: '50000000-0000-4000-8000-000000000002',
  title: 'PS-LNA-001 应用说明',
  platform_name: '行业媒体',
  final_url: 'https://example.test/articles/ps-lna-001-application',
  status: 'COMPLETED',
}] satisfies GeoPublicationCandidate[];

const fileRecord = {
  id: '60000000-0000-4000-8000-000000000001',
  category: 'OPERATION_SCREENSHOT',
  original_filename: 'geo-proof.png',
  object_key: 'evidence/geo-proof.png',
  content_type: 'image/png',
  size: 8,
  sha256: 'fixture-sha256',
  access_level: 'INTERNAL',
  status: 'PENDING',
  created_at: '2026-08-12T00:00:00Z',
} satisfies components['schemas']['FileRecord'];

const createdObservationId = '70000000-0000-4000-8000-000000000001';

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<NewGeoFixtures>({
  newGeoApi: [async ({ page }, use) => {
    let candidateMode: CandidateMode = 'success';
    let createMode: CreateMode = 'success';
    let releaseCandidates: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    const candidateRequests: URL[] = [];
    const createRequests: CreateRequest[] = [];
    const detailRequests: URL[] = [];
    const uploadRequests: string[] = [];
    const unexpectedRequests: string[] = [];

    await page.route('https://storage.example.test/geo-proof', async (route) => {
      uploadRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 200, body: '' });
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();

      if (method === 'GET' && url.pathname === '/api/v1/products') {
        await route.fulfill({
          status: 200,
          json: { items: [product], page: 1, page_size: 20, total: 1 } satisfies components['schemas']['ProductList'],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/query-topics') {
        await route.fulfill({ status: 200, json: { items: [topic] } satisfies components['schemas']['QueryTopicList'] });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/geo-observation-publications') {
        candidateRequests.push(url);
        if (candidateMode === 'loading') {
          await new Promise<void>((resolve) => { releaseCandidates = resolve; });
        }
        await route.fulfill({
          status: 200,
          json: { items: candidateMode === 'empty' ? [] : candidates } satisfies components['schemas']['GeoPublicationCandidateList'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/geo-observations') {
        createRequests.push({
          body: request.postDataJSON() as GeoObservationCreate,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
        });
        if (createMode === 'pending') {
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
        }
        if (createMode === 'conflict') {
          await route.fulfill({
            status: 409,
            json: errorEnvelope('GEO_PUBLICATIONS_CHANGED', 'Published Article 候选已经变化', 'req-geo-create'),
          });
          return;
        }
        const body = createRequests.at(-1)!.body;
        await route.fulfill({
          status: 201,
          json: {
            observation_kind: 'MANUAL_ARTICLE_SEARCH',
            id: createdObservationId,
            query_topic_id: body.query_topic_id,
            product_id: body.product_id,
            product_label: `${product.brand} ${product.part_number}`,
            search_platform: body.search_platform,
            search_query: body.search_query,
            tested_at: body.tested_at,
            article_results: body.article_results.map((item, index) => ({
              ...item,
              title: candidates[index]?.title ?? 'Published Article',
              platform_name: candidates[index]?.platform_name ?? '未知平台',
              final_url: candidates[index]?.final_url ?? 'https://example.test/articles/unknown',
            })),
            attachment_file_ids: body.attachment_file_ids ?? [],
            notes: body.notes,
            supersedes_id: null,
            tested_by: geoIds.admin,
            recorder: { id: geoIds.admin, username: 'geo-admin', display_name: 'GEO 系统管理员' },
            is_current: true,
            workflow_stage: 'READY',
            primary_task: 'VIEW_ANALYSIS',
            available_actions: ['CORRECT', 'DELETE'],
            created_at: '2026-08-12T09:00:00Z',
          } satisfies components['schemas']['ManualGeoObservation'],
        });
        return;
      }
      if (
        method === 'GET'
        && url.pathname === `/api/v1/geo-observations/${createdObservationId}/detail`
      ) {
        detailRequests.push(url);
        const body = createRequests.at(-1)?.body;
        if (!body) {
          await route.fulfill({
            status: 409,
            json: errorEnvelope(
              'NEW_GEO_DETAIL_BEFORE_CREATE',
              '尚未创建 canonical observation',
              'req-new-geo-detail',
            ),
          });
          return;
        }
        const observation = {
          observation_kind: 'MANUAL_ARTICLE_SEARCH',
          id: createdObservationId,
          query_topic_id: body.query_topic_id,
          product_id: body.product_id,
          product_label: `${product.brand} ${product.part_number}`,
          search_platform: body.search_platform,
          search_query: body.search_query,
          tested_at: body.tested_at,
          article_results: body.article_results.map((item) => {
            const candidate = candidates.find(
              (value) => value.published_article_id === item.published_article_id,
            );
            if (!candidate) throw new Error(`创建响应包含未知成果：${item.published_article_id}`);
            return {
              ...item,
              title: candidate.title,
              platform_name: candidate.platform_name,
              final_url: candidate.final_url,
            };
          }),
          attachment_file_ids: body.attachment_file_ids ?? [],
          notes: body.notes,
          supersedes_id: null,
          tested_by: geoIds.admin,
          recorder: {
            id: geoIds.admin,
            username: 'geo-admin',
            display_name: 'GEO 系统管理员',
          },
          is_current: true,
          workflow_stage: 'READY',
          primary_task: 'VIEW_ANALYSIS',
          available_actions: ['CORRECT', 'DELETE'],
          created_at: '2026-08-12T09:00:00Z',
        } satisfies components['schemas']['ManualGeoObservation'];
        await route.fulfill({
          status: 200,
          json: {
            observation_kind: 'MANUAL_ARTICLE_SEARCH',
            selected_observation_id: createdObservationId,
            chain_root_id: createdObservationId,
            chain_tail_id: createdObservationId,
            product: { id: product.id, label: `${product.brand} ${product.part_number}` },
            correction_history: [{
              observation,
              query_topic: { id: topic.id, canonical_question: topic.canonical_question },
              evidence: body.attachment_file_ids?.length ? [{
                file: { ...fileRecord, status: 'VERIFIED' },
                download: {
                  url: 'https://files.example.test/geo-proof.png',
                  expires_at: '2026-08-12T10:00:00Z',
                },
              }] : [],
              is_original: true,
              is_selected: true,
              is_chain_tail: true,
            }],
          } satisfies components['schemas']['ManualGeoObservationDetail'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/files/upload-intents') {
        uploadRequests.push(url.pathname);
        await route.fulfill({
          status: 201,
          json: {
            file: fileRecord,
            upload: {
              method: 'PUT',
              url: 'https://storage.example.test/geo-proof',
              headers: {},
              fields: {},
              expires_at: '2026-08-12T00:05:00Z',
            },
          } satisfies components['schemas']['UploadIntent'],
        });
        return;
      }
      if (method === 'POST' && url.pathname === `/api/v1/files/${fileRecord.id}/complete`) {
        uploadRequests.push(url.pathname);
        await route.fulfill({ status: 200, json: { ...fileRecord, status: 'VERIFIED' } satisfies components['schemas']['FileRecord'] });
        return;
      }

      if (['/api/v1/auth/me', '/api/v1/auth/csrf', '/api/v1/geo-observations/list-items'].includes(url.pathname)) {
        await route.fallback();
        return;
      }
      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 501, json: errorEnvelope('NEW_GEO_FIXTURE_UNEXPECTED_API', '新建 GEO fixture 收到未声明请求', 'req-new-geo-unexpected') });
    });

    await use({
      candidateRequests,
      createRequests,
      detailRequests,
      uploadRequests,
      releaseCandidates: () => releaseCandidates?.(),
      releaseCreate: () => releaseCreate?.(),
      setCandidateMode: (mode) => { candidateMode = mode; },
      setCreateMode: (mode) => { createMode = mode; },
    });

    expect(unexpectedRequests, '新建 GEO 页面不得依赖未声明 API 或浏览器 join').toEqual([]);
  }, { auto: true }],
});

export {
  candidates,
  createdObservationId,
  expect,
  fileRecord,
  product,
  test,
  topic,
};
