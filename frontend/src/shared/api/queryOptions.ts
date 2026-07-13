/** 被多个页面或预取流程共享的服务端查询定义。 */
import { queryOptions } from '@tanstack/react-query';
import { QUERY_STALE_TIME } from '../../app/queryClient';
import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';

export const dashboardSummaryQueryOptions = () => queryOptions({
  queryKey: queryKeys.dashboard,
  queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/summary')),
  staleTime: QUERY_STALE_TIME.workbench,
});

export const geoMetricsQueryOptions = () => queryOptions({
  queryKey: queryKeys.geo.metrics,
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-metrics')),
  staleTime: QUERY_STALE_TIME.workbench,
});

export const productsQueryOptions = (search = '') => queryOptions({
  queryKey: queryKeys.products.list(search),
  queryFn: async () => unwrap(await api.GET('/api/v1/products', {
    params: { query: { page: 1, page_size: 100, ...(search ? { search } : {}) } },
  })),
  staleTime: QUERY_STALE_TIME.businessList,
});

export const queryTopicsQueryOptions = () => queryOptions({
  queryKey: queryKeys.queryTopics,
  queryFn: async () => unwrap(await api.GET('/api/v1/query-topics')),
  staleTime: QUERY_STALE_TIME.businessList,
});

export const platformProfilesQueryOptions = () => queryOptions({
  queryKey: queryKeys.platformProfiles.all,
  queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles')),
  staleTime: QUERY_STALE_TIME.configuration,
});

export const platformTypesQueryOptions = () => queryOptions({
  queryKey: queryKeys.platformTypes.all,
  queryFn: async () => unwrap(await api.GET('/api/v1/platform-types')),
  staleTime: QUERY_STALE_TIME.configuration,
});

export const publicationRecordsQueryOptions = () => queryOptions({
  queryKey: queryKeys.publications.records,
  queryFn: async () => unwrap(await api.GET('/api/v1/publication-records', {
    params: { query: { page: 1, page_size: 100 } },
  })),
  staleTime: QUERY_STALE_TIME.businessList,
});
