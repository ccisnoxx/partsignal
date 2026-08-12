import { describe, expect, it } from 'vitest';

import {
  canonicalGeoObservationSearchRecord,
  formatGeoObservationIndicator,
  geoObservationSearchSchema,
  geoObservationSearchToApiParams,
  geoObservationSortToSorting,
  isCanonicalGeoObservationSearch,
  sortingToGeoObservationSort,
} from './geo-observation-list.model';

describe('GEO Observation list model', () => {
  it('规范化 URL 并一一映射到 API query，不接受兼容别名', () => {
    const search = geoObservationSearchSchema.parse({
      q: '  测试问题  ',
      productId: '00000000-0000-4000-8000-000000000001',
      geoPlatform: '  DeepSeek  ',
      accuracy: 'PARTIAL',
      from: '2026-08-01',
      to: '2026-08-12',
      sort: 'OBSERVED_ASC',
      page: '2',
      pageSize: '50',
      search: 'alias-must-not-work',
    });

    expect(search).toEqual({
      q: '测试问题',
      productId: '00000000-0000-4000-8000-000000000001',
      geoPlatform: 'DeepSeek',
      accuracy: 'PARTIAL',
      from: '2026-08-01',
      to: '2026-08-12',
      sort: 'OBSERVED_ASC',
      page: 2,
      pageSize: 50,
    });
    expect(geoObservationSearchToApiParams(search)).toEqual({
      search: '测试问题',
      product_id: search.productId,
      geo_platform: 'DeepSeek',
      accuracy: 'PARTIAL',
      date_from: '2026-08-01',
      date_to: '2026-08-12',
      sort: 'OBSERVED_ASC',
      page: 2,
      page_size: 50,
    });
    expect(canonicalGeoObservationSearchRecord(search)).toEqual(search);
  });

  it('非法值 canonicalize 为默认页，不把默认排序写入 URL', () => {
    const search = geoObservationSearchSchema.parse({
      q: 'x'.repeat(201),
      productId: 'bad-id',
      geoPlatform: 'x'.repeat(161),
      accuracy: 'UNKNOWN',
      from: '2026-99-99',
      sort: 'UNKNOWN',
      page: 0,
      pageSize: 99,
    });

    expect(search).toEqual({ page: 1, pageSize: 20 });
    expect(canonicalGeoObservationSearchRecord(search)).toEqual({ page: 1, pageSize: 20 });
    expect(isCanonicalGeoObservationSearch({ page: 0, extra: 'x' }, search)).toBe(false);
    expect(isCanonicalGeoObservationSearch({ page: 1, pageSize: 20 }, search)).toBe(true);
  });

  it('观测时间排序只映射唯一服务端排序列', () => {
    expect(geoObservationSortToSorting()).toEqual([{ id: 'observed_at', desc: true }]);
    expect(geoObservationSortToSorting('OBSERVED_ASC')).toEqual([
      { id: 'observed_at', desc: false },
    ]);
    expect(sortingToGeoObservationSort([{ id: 'observed_at', desc: true }])).toBeUndefined();
    expect(sortingToGeoObservationSort([{ id: 'observed_at', desc: false }]))
      .toBe('OBSERVED_ASC');
    expect(() => sortingToGeoObservationSort([{ id: 'unknown', desc: false }]))
      .toThrow('未知排序列');
  });

  it('compact indicator 明确表达不适用和未评估', () => {
    expect(formatGeoObservationIndicator('发现', null)).toBe('发现不适用');
    expect(formatGeoObservationIndicator('提及', {
      positive_count: 1,
      assessed_count: 3,
      total_count: 3,
    })).toBe('提及 1/3');
    expect(formatGeoObservationIndicator('准确', {
      positive_count: 1,
      assessed_count: 1,
      total_count: 3,
    })).toBe('准确 1/1（2 未评估）');
  });
});
