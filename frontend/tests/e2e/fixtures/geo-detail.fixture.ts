/** GEO Observation Detail 的 generated-type 单请求严格 fixture。 */
import { expect } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';
import { geoIds, test as base } from './geo.fixture';

type DetailMode = 'success' | 'not-found' | 'forbidden' | 'conflict' | 'error' | 'loading';
type GeoDetailApiController = {
  detailRequests: URL[];
  releaseLoading: () => void;
  setDetailMode: (mode: DetailMode) => void;
};
type GeoDetailFixtures = { geoDetailApi: GeoDetailApiController };

const detailIds = {
  root: '31000000-0000-4000-8000-000000000001',
  selected: geoIds.manual,
  tail: '31000000-0000-4000-8000-000000000003',
  topic: '41000000-0000-4000-8000-000000000001',
  article: '51000000-0000-4000-8000-000000000001',
  rootFile: '61000000-0000-4000-8000-000000000001',
  selectedFile: '61000000-0000-4000-8000-000000000002',
  tailFile: '61000000-0000-4000-8000-000000000003',
} as const;

const recorder = {
  id: geoIds.admin,
  username: 'geo-admin',
  display_name: 'GEO 系统管理员',
} satisfies components['schemas']['ActorSummary'];

function manualNode(
  id: string,
  supersedesId: string | null,
  index: number,
): components['schemas']['GeoObservationCorrectionHistoryItem'] {
  const selected = id === detailIds.selected;
  const tail = id === detailIds.tail;
  const fileId = [detailIds.rootFile, detailIds.selectedFile, detailIds.tailFile][index]!;
  return {
    observation: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      id,
      query_topic_id: detailIds.topic,
      product_id: geoIds.product,
      product_label: 'PartSignal PS-LNA-VERY-LONG-001',
      search_platform: 'DeepSeek Web Search',
      search_query: '如何判断一款低噪声放大器是否适合高可靠性射频前端？',
      tested_at: `2026-08-${10 + index}T08:00:00Z`,
      article_results: [{
        published_article_id: detailIds.article,
        discovered: index > 0,
        mentioned: tail,
        accuracy: index === 0 ? null : tail ? 'ACCURATE' : 'PARTIAL',
        title: 'PS-LNA 高可靠性射频前端选型指南',
        platform_name: '官网快照',
        final_url: 'https://example.test/articles/lna-guide',
      }],
      attachment_file_ids: [
        detailIds.rootFile,
        ...(index > 0 ? [detailIds.selectedFile] : []),
        ...(tail ? [detailIds.tailFile] : []),
      ],
      notes: `第 ${index + 1} 次只读记录`,
      supersedes_id: supersedesId,
      tested_by: geoIds.admin,
      recorder,
      is_current: tail,
      workflow_stage: tail ? 'READY' : 'SUPERSEDED',
      primary_task: tail ? 'VIEW_ANALYSIS' : 'VIEW_CORRECTION_HISTORY',
      available_actions: tail ? ['CORRECT', 'DELETE'] : [],
      created_at: `2026-08-${10 + index}T08:01:00Z`,
    },
    query_topic: {
      id: detailIds.topic,
      canonical_question: '如何选择高可靠性低噪声放大器？',
    },
    evidence: [{
      file: {
        id: fileId,
        category: 'OPERATION_SCREENSHOT',
        original_filename: `geo-detail-${index + 1}.png`,
        object_key: `geo/detail-${index + 1}.png`,
        content_type: 'image/png',
        size: 1024 + index,
        sha256: String(index + 1).repeat(64),
        access_level: 'INTERNAL',
        status: 'VERIFIED',
        created_at: `2026-08-${10 + index}T08:00:00Z`,
        verified_at: `2026-08-${10 + index}T08:00:00Z`,
      },
      download: {
        url: `https://files.example.test/geo-detail-${index + 1}.png`,
        expires_at: '2026-08-12T09:00:00Z',
      },
    }],
    is_original: index === 0,
    is_selected: selected,
    is_chain_tail: tail,
  };
}

const manualDetail = {
  observation_kind: 'MANUAL_ARTICLE_SEARCH',
  selected_observation_id: detailIds.selected,
  chain_root_id: detailIds.root,
  chain_tail_id: detailIds.tail,
  product: { id: geoIds.product, label: 'PartSignal PS-LNA-VERY-LONG-001' },
  correction_history: [
    manualNode(detailIds.root, null, 0),
    manualNode(detailIds.selected, detailIds.root, 1),
    manualNode(detailIds.tail, detailIds.selected, 2),
  ],
} satisfies components['schemas']['ManualGeoObservationDetail'];

const legacyDetail = {
  observation_kind: 'LEGACY_MODEL_RESULT',
  observation: {
    observation_kind: 'LEGACY_MODEL_RESULT',
    id: geoIds.legacy,
    query_topic_id: detailIds.topic,
    product_id: geoIds.product,
    product_label: 'PartSignal PS-LNA-VERY-LONG-001',
    actual_prompt: '旧模型是否完整提及目标产品并给出推荐？',
    model_name: 'ChatGPT',
    model_version: '4o',
    tested_at: '2026-08-09T08:00:00Z',
    web_search_enabled: true,
    answer_summary: '旧模型回答摘要保留完整事实。',
    mentioned: true,
    recommendation: 'RECOMMENDED',
    accuracy: 'ACCURATE',
    citations: [{
      url: 'https://example.test/source',
      source_type: 'OFFICIAL',
      published_article_id: detailIds.article,
    }],
    published_article_ids: [detailIds.article],
    attachment_file_ids: [],
    notes: 'Legacy 只读备注',
    supersedes_id: null,
    tested_by: geoIds.admin,
    recorder,
    is_current: true,
    workflow_stage: 'LEGACY',
    primary_task: 'VIEW_HISTORICAL_RECORD',
    available_actions: [],
    created_at: '2026-08-09T08:01:00Z',
  },
  query_topic: { id: detailIds.topic, canonical_question: '旧模型标准问题' },
  product: { id: geoIds.product, label: 'PartSignal PS-LNA-VERY-LONG-001' },
  published_articles: [{
    id: detailIds.article,
    title: '旧模型关联成果',
    platform_name: '官网快照',
    final_url: 'https://example.test/articles/lna-guide',
  }],
  evidence: [],
} satisfies components['schemas']['LegacyGeoObservationDetail'];

function errorEnvelope(code: string, message: string, requestId: string) {
  return {
    error: { code, message, details: {}, request_id: requestId },
  } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<GeoDetailFixtures>({
  geoDetailApi: [async ({ page }, use) => {
    let mode: DetailMode = 'success';
    let releaseDetail: (() => void) | undefined;
    const detailRequests: URL[] = [];
    const unexpectedRequests: string[] = [];

    await page.route('**/api/v1/geo-observations/*/detail', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 501, json: errorEnvelope('DETAIL_FIXTURE_UNEXPECTED_API', 'Detail fixture 收到未声明请求', 'req-detail-unexpected') });
        return;
      }
      detailRequests.push(url);
      if (mode === 'loading') {
        await new Promise<void>((resolve) => { releaseDetail = resolve; });
      }
      if (mode !== 'success') {
        const response = {
          'not-found': [404, 'NOT_FOUND', 'GEO 观测不存在'],
          forbidden: [403, 'FORBIDDEN', '无权访问 GEO 观测'],
          conflict: [409, 'REVISION_CONFLICT', 'GEO 观测更正链不完整'],
          error: [500, 'INTERNAL_ERROR', '读取 GEO 观测失败'],
          loading: [500, 'INTERNAL_ERROR', 'loading 已释放但未切换模式'],
        }[mode] as [number, string, string];
        await route.fulfill({
          status: response[0],
          json: errorEnvelope(response[1], response[2], `req-detail-${mode}`),
        });
        return;
      }
      const id = url.pathname.split('/').at(-2);
      const data = id === geoIds.legacy ? legacyDetail : id === detailIds.selected ? manualDetail : null;
      if (!data) {
        await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', 'GEO 观测不存在', 'req-detail-not-found') });
        return;
      }
      await route.fulfill({ status: 200, json: data });
    });

    await use({
      detailRequests,
      releaseLoading: () => releaseDetail?.(),
      setDetailMode: (next) => { mode = next; },
    });

    expect(unexpectedRequests, 'GEO Detail 只允许单个聚合 GET').toEqual([]);
  }, { auto: true }],
});

export { detailIds, expect, legacyDetail, manualDetail, test };
