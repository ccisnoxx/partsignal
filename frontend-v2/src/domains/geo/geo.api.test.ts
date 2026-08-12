import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  createGeoObservation,
  deleteGeoObservation,
  GeoRequestError,
  geoObservationListQueryOptions,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
} from './geo.api';
import { geoObservationSearchSchema } from './geo-observation-list.model';

afterEach(() => vi.restoreAllMocks());

describe('GEO API', () => {
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
