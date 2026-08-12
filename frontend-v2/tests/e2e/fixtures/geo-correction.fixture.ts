/** GEO Observation Correction Workspace 的 generated-type 严格 fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';
import { detailIds, manualDetail } from './geo-detail.fixture';
import { geoIds } from './geo.fixture';

type ContextMode = 'success' | 'loading' | 'not-found' | 'forbidden';
type CreateMode = 'success' | 'pending' | 'publication-conflict' | 'revision-conflict' | 'forbidden';
type UploadMode = 'success' | 'complete-failure';
type GeoObservationCreate = components['schemas']['GeoObservationCreate'];
type ManualDetail = components['schemas']['ManualGeoObservationDetail'];

type CreateRequest = {
  body: GeoObservationCreate;
  csrfToken: string | null;
  idempotencyKey: string | null;
};

type GeoCorrectionApiController = {
  contextRequests: URL[];
  createRequests: CreateRequest[];
  detailRequests: URL[];
  uploadRequests: string[];
  releaseContext: () => void;
  releaseCreate: () => void;
  setContextMode: (mode: ContextMode) => void;
  setCreateMode: (mode: CreateMode) => void;
  setUploadMode: (mode: UploadMode) => void;
};

type GeoCorrectionFixtures = { geoCorrectionApi: GeoCorrectionApiController };

const correctionIds = {
  conflictTail: '31000000-0000-4000-8000-000000000004',
  created: '31000000-0000-4000-8000-000000000005',
  articleTwo: '51000000-0000-4000-8000-000000000002',
  articleThree: '51000000-0000-4000-8000-000000000003',
  file: '61000000-0000-4000-8000-000000000004',
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

const articleTwo = {
  published_article_id: correctionIds.articleTwo,
  discovered: null,
  mentioned: null,
  accuracy: null,
  title: 'PS-LNA 新增应用说明',
  platform_name: '行业媒体',
  final_url: 'https://example.test/articles/lna-application',
} satisfies components['schemas']['GeoArticleResult'];

const articleThree = {
  published_article_id: correctionIds.articleThree,
  discovered: null,
  mentioned: null,
  accuracy: null,
  title: 'PS-LNA 冲突后新增文章',
  platform_name: '技术社区',
  final_url: 'https://example.test/articles/lna-community',
} satisfies components['schemas']['GeoArticleResult'];

const pendingFile = {
  id: correctionIds.file,
  category: 'OPERATION_SCREENSHOT',
  original_filename: 'correction-proof.png',
  object_key: 'geo/correction-proof.png',
  content_type: 'image/png',
  size: 8,
  sha256: 'fixture-correction-sha256',
  access_level: 'INTERNAL',
  status: 'PENDING',
  created_at: '2026-08-12T09:00:00Z',
} satisfies components['schemas']['FileRecord'];

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

function detailFor(selectedId: string, refreshed: boolean): ManualDetail {
  const tailId = refreshed ? correctionIds.conflictTail : detailIds.tail;
  const history: ManualDetail['correction_history'] = manualDetail.correction_history.map((item) => ({
    ...item,
    observation: {
      ...item.observation,
      is_current: item.observation.id === tailId,
      workflow_stage: item.observation.id === tailId ? 'READY' as const : 'SUPERSEDED' as const,
      primary_task: item.observation.id === tailId
        ? 'VIEW_ANALYSIS' as const
        : 'VIEW_CORRECTION_HISTORY' as const,
      available_actions: item.observation.id === tailId ? ['CORRECT', 'DELETE'] : [],
    },
    is_selected: item.observation.id === selectedId,
    is_chain_tail: item.observation.id === tailId,
  }));
  if (refreshed) {
    const previous = history.at(-1)!;
    history.push({
      ...previous,
      observation: {
        ...previous.observation,
        id: correctionIds.conflictTail,
        article_results: [{ ...articleTwo, discovered: false, mentioned: true }],
        attachment_file_ids: [],
        notes: '其他用户追加的新尾节点',
        supersedes_id: detailIds.tail,
        is_current: true,
        workflow_stage: 'READY',
        primary_task: 'VIEW_ANALYSIS',
        available_actions: ['CORRECT', 'DELETE'],
        created_at: '2026-08-12T09:10:00Z',
      },
      evidence: [],
      is_original: false,
      is_selected: selectedId === correctionIds.conflictTail,
      is_chain_tail: true,
    });
  }
  return {
    ...manualDetail,
    selected_observation_id: selectedId,
    chain_tail_id: tailId,
    correction_history: history,
  };
}

function correctionContext(
  selectedId: string,
  refreshed: boolean,
): components['schemas']['GeoObservationCorrectionContext'] {
  const detail = detailFor(selectedId, refreshed);
  const tail = detail.correction_history.at(-1)!.observation;
  const originalCandidate = tail.article_results[0]!;
  return {
    detail,
    correction_article_results: refreshed
      ? [{ ...articleTwo, discovered: false, mentioned: true }, articleThree]
      : [originalCandidate, articleTwo],
    query_topic_options: [],
  };
}

function createdObservation(body: GeoObservationCreate) {
  const metadata = [
    ...manualDetail.correction_history.at(-1)!.observation.article_results,
    articleTwo,
    articleThree,
  ];
  return {
    observation_kind: 'MANUAL_ARTICLE_SEARCH',
    id: correctionIds.created,
    query_topic_id: body.query_topic_id,
    product_id: body.product_id,
    product_label: manualDetail.product.label,
    search_platform: body.search_platform,
    search_query: body.search_query,
    tested_at: body.tested_at,
    article_results: body.article_results.map((item) => {
      const article = metadata.find(
        (candidate) => candidate.published_article_id === item.published_article_id,
      );
      if (!article) throw new Error(`Correction fixture 收到未知文章：${item.published_article_id}`);
      return {
        ...item,
        title: article.title,
        platform_name: article.platform_name,
        final_url: article.final_url,
      };
    }),
    attachment_file_ids: body.attachment_file_ids ?? [],
    notes: body.notes,
    supersedes_id: body.supersedes_id ?? null,
    tested_by: geoIds.admin,
    recorder: { id: geoIds.admin, username: 'geo-admin', display_name: 'GEO 系统管理员' },
    is_current: true,
    workflow_stage: 'READY',
    primary_task: 'VIEW_ANALYSIS',
    available_actions: ['CORRECT', 'DELETE'],
    created_at: '2026-08-12T09:30:00Z',
  } satisfies components['schemas']['ManualGeoObservation'];
}

function createdDetail(body: GeoObservationCreate): ManualDetail {
  const refreshed = body.supersedes_id === correctionIds.conflictTail;
  const previous = detailFor(body.supersedes_id!, refreshed);
  const observation = createdObservation(body);
  return {
    ...previous,
    selected_observation_id: correctionIds.created,
    chain_tail_id: correctionIds.created,
    correction_history: [
      ...previous.correction_history.map((item) => ({
        ...item,
        observation: {
          ...item.observation,
          is_current: false,
          workflow_stage: 'SUPERSEDED' as const,
          primary_task: 'VIEW_CORRECTION_HISTORY' as const,
          available_actions: [],
        },
        is_selected: false,
        is_chain_tail: false,
      })),
      {
        observation,
        query_topic: previous.correction_history.at(-1)!.query_topic,
        evidence: body.attachment_file_ids?.includes(correctionIds.file) ? [{
          file: { ...pendingFile, status: 'VERIFIED' },
          download: {
            url: 'https://files.example.test/correction-proof.png',
            expires_at: '2026-08-12T10:00:00Z',
          },
        }] : [],
        is_original: false,
        is_selected: true,
        is_chain_tail: true,
      },
    ],
  };
}

const test = base.extend<GeoCorrectionFixtures>({
  geoCorrectionApi: [async ({ page }, use) => {
    let contextMode: ContextMode = 'success';
    let createMode: CreateMode = 'success';
    let uploadMode: UploadMode = 'success';
    let refreshed = false;
    let releaseContext: (() => void) | undefined;
    let releaseCreate: (() => void) | undefined;
    const contextRequests: URL[] = [];
    const createRequests: CreateRequest[] = [];
    const detailRequests: URL[] = [];
    const uploadRequests: string[] = [];
    const unexpectedRequests: string[] = [];

    await page.route('https://storage.example.test/correction-proof', async (route) => {
      uploadRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 200, body: '' });
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
          json: { csrf_token: 'geo-correction-csrf' } satisfies components['schemas']['CsrfToken'],
        });
        return;
      }

      const contextMatch = url.pathname.match(
        /^\/api\/v1\/geo-observations\/([^/]+)\/correction-context$/,
      );
      if (method === 'GET' && contextMatch) {
        contextRequests.push(url);
        if (contextMode === 'loading') {
          await new Promise<void>((resolve) => { releaseContext = resolve; });
        }
        if (contextMode === 'not-found') {
          await route.fulfill({
            status: 404,
            json: errorEnvelope('NOT_FOUND', 'GEO 观测不存在', 'req-correction-not-found'),
          });
          return;
        }
        if (contextMode === 'forbidden') {
          await route.fulfill({
            status: 403,
            json: errorEnvelope('PERMISSION_DENIED', '当前账号不可更正', 'req-correction-forbidden'),
          });
          return;
        }
        const selectedId = contextMatch[1]!;
        if (selectedId === geoIds.legacy) {
          await route.fulfill({
            status: 409,
            json: errorEnvelope('INVALID_STATE_TRANSITION', 'Legacy 观测不可更正', 'req-correction-legacy'),
          });
          return;
        }
        await route.fulfill({ status: 200, json: correctionContext(selectedId, refreshed) });
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
        if (createMode === 'publication-conflict' || createMode === 'revision-conflict') {
          refreshed = true;
          const code = createMode === 'publication-conflict'
            ? 'GEO_PUBLICATIONS_CHANGED'
            : 'REVISION_CONFLICT';
          await route.fulfill({
            status: 409,
            json: errorEnvelope(code, '更正上下文已经变化', `req-${code.toLowerCase()}`),
          });
          return;
        }
        if (createMode === 'forbidden') {
          await route.fulfill({
            status: 403,
            json: errorEnvelope('PERMISSION_DENIED', '提交时权限已变化', 'req-correction-submit'),
          });
          return;
        }
        const body = createRequests.at(-1)!.body;
        const observation = createdObservation(body);
        await route.fulfill({ status: 201, json: observation });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/v1/files/upload-intents') {
        uploadRequests.push(url.pathname);
        await route.fulfill({
          status: 201,
          json: {
            file: pendingFile,
            upload: {
              method: 'PUT',
              url: 'https://storage.example.test/correction-proof',
              headers: {},
              fields: {},
              expires_at: '2026-08-12T09:05:00Z',
            },
          } satisfies components['schemas']['UploadIntent'],
        });
        return;
      }

      if (method === 'POST' && url.pathname === `/api/v1/files/${correctionIds.file}/complete`) {
        uploadRequests.push(url.pathname);
        if (uploadMode === 'complete-failure') {
          await route.fulfill({
            status: 422,
            json: errorEnvelope('FILE_MISMATCH', '文件校验失败', 'req-correction-file'),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          json: { ...pendingFile, status: 'VERIFIED' } satisfies components['schemas']['FileRecord'],
        });
        return;
      }

      const detailMatch = url.pathname.match(/^\/api\/v1\/geo-observations\/([^/]+)\/detail$/);
      if (method === 'GET' && detailMatch) {
        detailRequests.push(url);
        const selectedId = detailMatch[1]!;
        if (selectedId === correctionIds.created) {
          const body = createRequests.at(-1)?.body;
          if (!body) {
            await route.fulfill({
              status: 409,
              json: errorEnvelope('DETAIL_BEFORE_CREATE', '更正尚未创建', 'req-detail-before-create'),
            });
            return;
          }
          await route.fulfill({ status: 200, json: createdDetail(body) });
          return;
        }
        if (manualDetail.correction_history.some((item) => item.observation.id === selectedId)) {
          await route.fulfill({ status: 200, json: detailFor(selectedId, false) });
          return;
        }
      }

      unexpectedRequests.push(`${method} ${url.pathname}`);
      await route.fulfill({
        status: 501,
        json: errorEnvelope(
          'GEO_CORRECTION_FIXTURE_UNEXPECTED_API',
          'Correction fixture 收到未声明请求',
          'req-correction-unexpected',
        ),
      });
    });

    await use({
      contextRequests,
      createRequests,
      detailRequests,
      uploadRequests,
      releaseContext: () => releaseContext?.(),
      releaseCreate: () => releaseCreate?.(),
      setContextMode: (mode) => { contextMode = mode; },
      setCreateMode: (mode) => { createMode = mode; },
      setUploadMode: (mode) => { uploadMode = mode; },
    });

    expect(unexpectedRequests, 'GEO Correction 页面不得依赖未声明 API').toEqual([]);
  }, { auto: true }],
});

export {
  articleThree,
  articleTwo,
  correctionIds,
  expect,
  manualDetail,
  pendingFile,
  test,
};
