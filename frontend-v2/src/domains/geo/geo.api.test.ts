import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  deleteGeoObservation,
  GeoRequestError,
  geoObservationListQueryOptions,
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
