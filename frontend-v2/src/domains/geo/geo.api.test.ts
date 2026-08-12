import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  createGeoObservation,
  deleteGeoObservation,
  GeoRequestError,
  geoObservationCorrectionContextQueryOptions,
  geoObservationDetailQueryOptions,
  geoObservationListQueryOptions,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
} from './geo.api';
import { geoObservationSearchSchema } from './geo-observation-list.model';

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
});
