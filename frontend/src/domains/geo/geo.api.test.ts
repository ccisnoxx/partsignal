import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  createGeoOptimizationContentTask,
  createGeoObservation,
  createQueryTopic,
  deleteQueryTopic,
  deleteGeoObservation,
  GeoRequestError,
  geoInsightsQueryOptions,
  geoObservationCorrectionContextQueryOptions,
  geoObservationDetailQueryOptions,
  geoObservationListQueryOptions,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
  queryTopicListQueryOptions,
  updateQueryTopic,
} from './geo.api';
import { geoInsightSearchSchema } from './geo-insights.model';
import { geoObservationSearchSchema } from './geo-observation-list.model';
import { queryTopicSearchSchema } from './query-topic-list.model';

afterEach(() => vi.restoreAllMocks());

describe('GEO API', () => {
  it('更正上下文只请求 generated 聚合 endpoint 并校验 CORRECT 尾节点', async () => {
    const observationId = '10000000-0000-4000-8000-000000000001';
    const data = {
      detail: {
        observation_kind: 'MANUAL_ARTICLE_SEARCH',
        selected_observation_id: observationId,
        chain_root_id: observationId,
        chain_tail_id: observationId,
        product: { id: '20000000-0000-4000-8000-000000000001', label: 'PartSignal PS-1' },
        correction_history: [{
          observation: {
            observation_kind: 'MANUAL_ARTICLE_SEARCH',
            id: observationId,
            query_topic_id: '30000000-0000-4000-8000-000000000001',
            product_id: '20000000-0000-4000-8000-000000000001',
            product_label: 'PartSignal PS-1',
            search_platform: 'DeepSeek',
            search_query: '真实搜索词',
            tested_at: '2026-08-12T08:00:00Z',
            article_results: [],
            attachment_file_ids: [],
            notes: '',
            supersedes_id: null,
            tested_by: '40000000-0000-4000-8000-000000000001',
            recorder: {
              id: '40000000-0000-4000-8000-000000000001',
              username: 'engineer',
              display_name: '内容工程师',
            },
            is_current: true,
            workflow_stage: 'READY',
            primary_task: 'VIEW_ANALYSIS',
            available_actions: ['CORRECT'],
            created_at: '2026-08-12T08:01:00Z',
          },
          query_topic: {
            id: '30000000-0000-4000-8000-000000000001',
            canonical_question: '标准问题',
          },
          evidence: [],
          is_original: true,
          is_selected: true,
          is_chain_tail: true,
        }],
      },
      correction_article_results: [],
      query_topic_options: [],
    } as const;
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    const queryClient = new QueryClient();

    await expect(queryClient.fetchQuery(
      geoObservationCorrectionContextQueryOptions(observationId),
    )).resolves.toEqual(data);
    expect(get).toHaveBeenCalledWith(
      '/api/v1/geo-observations/{observation_id}/correction-context',
      { params: { path: { observation_id: observationId } } },
    );
  });

  it('详情只请求 generated 聚合 endpoint 并校验请求身份', async () => {
    const observationId = '10000000-0000-4000-8000-000000000001';
    const data = {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      selected_observation_id: observationId,
      chain_root_id: observationId,
      chain_tail_id: observationId,
      product: { id: '20000000-0000-4000-8000-000000000001', label: 'PartSignal PS-1' },
      correction_history: [{
        observation: {
          observation_kind: 'MANUAL_ARTICLE_SEARCH',
          id: observationId,
          query_topic_id: '30000000-0000-4000-8000-000000000001',
          product_id: '20000000-0000-4000-8000-000000000001',
          product_label: 'PartSignal PS-1',
          search_platform: 'DeepSeek',
          search_query: '真实搜索词',
          tested_at: '2026-08-12T08:00:00Z',
          article_results: [],
          attachment_file_ids: [],
          notes: '',
          supersedes_id: null,
          tested_by: '40000000-0000-4000-8000-000000000001',
          recorder: {
            id: '40000000-0000-4000-8000-000000000001',
            username: 'engineer',
            display_name: '内容工程师',
          },
          is_current: true,
          workflow_stage: 'READY',
          primary_task: 'VIEW_ANALYSIS',
          available_actions: ['CORRECT'],
          created_at: '2026-08-12T08:01:00Z',
        },
        query_topic: {
          id: '30000000-0000-4000-8000-000000000001',
          canonical_question: '标准问题',
        },
        evidence: [],
        is_original: true,
        is_selected: true,
        is_chain_tail: true,
      }],
    } as const;
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    const queryClient = new QueryClient();

    await expect(queryClient.fetchQuery(
      geoObservationDetailQueryOptions(observationId),
    )).resolves.toEqual(data);
    expect(get).toHaveBeenCalledWith(
      '/api/v1/geo-observations/{observation_id}/detail',
      { params: { path: { observation_id: observationId } } },
    );
  });

  it('列表只请求 generated compact endpoint', async () => {
    const data = { items: [], page: 1, page_size: 20, total: 0 } as const;
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    const queryClient = new QueryClient();
    const search = geoObservationSearchSchema.parse({ q: '测试', page: 1, pageSize: 20 });

    await queryClient.fetchQuery(geoObservationListQueryOptions(search));

    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/geo-observations/list-items', {
      params: {
        query: {
          search: '测试',
          product_id: undefined,
          query_topic_id: undefined,
          geo_platform: undefined,
          accuracy: undefined,
          date_from: undefined,
          date_to: undefined,
          sort: undefined,
          page: 1,
          page_size: 20,
        },
      },
    });
  });

  it('Query Topic list-items 与三个命令只使用 generated contract', async () => {
    const list = { items: [], page: 1, page_size: 20, total: 0 } as const;
    const topic = {
      id: '40000000-0000-4000-8000-000000000001',
      canonical_question: '标准问题',
      intent_type: 'PRODUCT',
      variants: ['变体'],
      available_actions: ['UPDATE', 'DELETE'],
      deletion: { blockers: [] },
      primary_task: 'USE_FOR_OBSERVATION',
      revision: 1,
      created_at: '2026-08-13T00:00:00Z',
    } as const;
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: list, response: Response.json(list) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: topic, response: Response.json(topic) } as never);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({ data: topic, response: Response.json(topic) } as never);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const client = new QueryClient();
    const body: Parameters<typeof createQueryTopic>[0] = {
      canonical_question: '标准问题', intent_type: 'PRODUCT', variants: ['变体'],
    };

    await client.fetchQuery(queryTopicListQueryOptions(queryTopicSearchSchema.parse({})));
    await createQueryTopic(body, 'csrf');
    await updateQueryTopic(topic.id, { ...body, expected_revision: 1 }, 'csrf');
    await deleteQueryTopic(topic.id, 1, 'csrf');

    expect(get).toHaveBeenCalledWith('/api/v1/query-topics/list-items', {
      params: { query: { q: undefined, sort: 'QUESTION_ASC', page: 1, page_size: 20 } },
    });
    expect(post).toHaveBeenCalledWith('/api/v1/query-topics', {
      body,
      params: { header: { 'X-CSRF-Token': 'csrf' } },
    });
    expect(patch).toHaveBeenCalledWith('/api/v1/query-topics/{query_topic_id}', {
      body: { ...body, expected_revision: 1 },
      params: { path: { query_topic_id: topic.id }, header: { 'X-CSRF-Token': 'csrf' } },
    });
    expect(remove).toHaveBeenCalledWith('/api/v1/query-topics/{query_topic_id}', {
      params: {
        path: { query_topic_id: topic.id },
        query: { expected_revision: 1 },
        header: { 'X-CSRF-Token': 'csrf' },
      },
    });
  });

  it('创建选项分别读取现有权威接口', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: { items: [] }, response: Response.json({ items: [] }) } as never)
      .mockResolvedValueOnce({ data: { items: [] }, response: Response.json({ items: [] }) } as never);
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(queryTopicsQueryOptions());
    await queryClient.fetchQuery(geoPublicationCandidatesQueryOptions('product-1'));

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/query-topics');
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/geo-observation-publications', {
      params: { query: { product_id: 'product-1' } },
    });
  });

  it('候选结构化错误保留 request ID，显式重试后可恢复', async () => {
    const data = { items: [] };
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({
        error: {
          error: {
            code: 'GEO_OBSERVATION_CONTEXT_INCOMPLETE',
            message: '候选读取失败',
            details: {},
            request_id: 'req-geo-candidates',
          },
        },
        response: Response.json({}, { status: 409 }),
      } as never)
      .mockResolvedValueOnce({ data, response: Response.json(data) } as never);
    const queryClient = new QueryClient();
    const options = geoPublicationCandidatesQueryOptions('product-1');

    await expect(queryClient.fetchQuery(options)).rejects.toMatchObject({
      message: '候选读取失败（请求 ID：req-geo-candidates）',
      status: 409,
    });
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(data);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('创建命令只携带 CSRF 与批准合同，不添加 Idempotency-Key', async () => {
    const body: Parameters<typeof createGeoObservation>[0] = {
      product_id: '10000000-0000-4000-8000-000000000001',
      query_topic_id: '20000000-0000-4000-8000-000000000001',
      search_platform: 'DeepSeek',
      search_query: '射频前端如何选型？',
      tested_at: '2026-08-12T08:30:00.000Z',
      article_results: [{
        published_article_id: '30000000-0000-4000-8000-000000000001',
        discovered: true,
        mentioned: false,
        accuracy: null,
      }],
      attachment_file_ids: [],
      notes: '',
    };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: { id: 'observation-1' },
      response: Response.json({ id: 'observation-1' }),
    } as never);

    await createGeoObservation(body, 'geo-csrf');

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/v1/geo-observations', {
      body,
      params: { header: { 'X-CSRF-Token': 'geo-csrf' } },
    });
  });

  it('删除携带 CSRF，结构化错误保留 request ID 且不重放', async () => {
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: {
        error: {
          code: 'GEO_OBSERVATION_HAS_SUCCESSOR',
          message: '该观测已有后继更正',
          details: {},
          request_id: 'req-geo-delete',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);

    await expect(deleteGeoObservation(
      '00000000-0000-4000-8000-000000000001',
      'geo-csrf',
    )).rejects.toMatchObject({
      name: 'GeoRequestError',
      status: 409,
      message: '该观测已有后继更正（请求 ID：req-geo-delete）',
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('/api/v1/geo-observations/{observation_id}', {
      params: {
        path: { observation_id: '00000000-0000-4000-8000-000000000001' },
        header: { 'X-CSRF-Token': 'geo-csrf' },
      },
    });
    await expect(deleteGeoObservation('id', null)).rejects.toBeInstanceOf(GeoRequestError);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('Insights GET 映射七个筛选，优化 POST 原样携带 body 与稳定 key', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: { generated_at: '2026-08-13T00:00:00Z' },
      response: Response.json({ generated_at: '2026-08-13T00:00:00Z' }),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: { id: 'task-1' }, response: Response.json({ id: 'task-1' }),
    } as never);
    const search = geoInsightSearchSchema.parse({
      from: '2026-07-15', to: '2026-08-13',
      productId: '10000000-0000-4000-8000-000000000001',
      contentPlatformId: '20000000-0000-4000-8000-000000000001',
      geoPlatform: 'DeepSeek',
      publishedArticleId: '30000000-0000-4000-8000-000000000001',
      queryTopicId: '40000000-0000-4000-8000-000000000001',
    });
    const client = new QueryClient();
    await client.fetchQuery(geoInsightsQueryOptions(search));
    expect(get).toHaveBeenCalledWith('/api/v1/geo-insights', { params: { query: {
      date_from: '2026-07-15', date_to: '2026-08-13',
      product_id: search.productId, content_platform_id: search.contentPlatformId,
      geo_platform: 'DeepSeek', published_article_id: search.publishedArticleId,
      query_topic_id: search.queryTopicId,
    } } });

    const body: Parameters<typeof createGeoOptimizationContentTask>[0] = {
      rule_code: 'QUESTION_COVERAGE_GAP', date_from: search.from, date_to: search.to,
      query_topic_id: search.queryTopicId, geo_platform: 'DeepSeek',
      product_id: search.productId!, platform_profile_id: search.contentPlatformId!,
      fact_version_id: '50000000-0000-4000-8000-000000000001',
    };
    await createGeoOptimizationContentTask(body, 'csrf', 'stable-key');
    expect(post).toHaveBeenCalledWith('/api/v1/geo-insights/optimization-content-tasks', {
      body,
      params: { header: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'stable-key' } },
    });
  });
});
