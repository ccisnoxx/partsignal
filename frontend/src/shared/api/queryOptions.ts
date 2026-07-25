/** 被多个页面或预取流程共享的服务端查询定义。 */
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { QUERY_STALE_TIME } from '../../app/queryClient';
import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';
import type {
  AuditLogListQuery,
  GeoInsightQuery,
  GeoMetricsQuery,
  GeoObservationListQuery,
  PlatformProfileListQuery,
} from './types';

export const auditLogListQueryOptions = (query: AuditLogListQuery) => queryOptions({
  queryKey: queryKeys.auditLogListByQuery(query),
  queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs', { params: { query } })),
  placeholderData: keepPreviousData,
  staleTime: QUERY_STALE_TIME.businessList,
});

export const auditLogDetailQueryOptions = (auditLogId: string | undefined) => queryOptions({
  queryKey: queryKeys.auditLogDetail(auditLogId ?? ''),
  queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs/{audit_log_id}', {
    params: { path: { audit_log_id: auditLogId! } },
  })),
  enabled: !!auditLogId,
  staleTime: QUERY_STALE_TIME.detail,
});

export const auditLogFilterOptionsQueryOptions = () => queryOptions({
  queryKey: queryKeys.auditLogFilterOptions,
  queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs/filter-options')),
  staleTime: QUERY_STALE_TIME.configuration,
});

export const dashboardSummaryQueryOptions = () => queryOptions({
  queryKey: queryKeys.dashboard,
  queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/summary')),
  staleTime: QUERY_STALE_TIME.workbench,
});

export const geoMetricsQueryOptions = (query: GeoMetricsQuery = {}) => queryOptions({
  queryKey: queryKeys.geo.metric(query),
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-metrics', { params: { query } })),
  staleTime: QUERY_STALE_TIME.workbench,
});

export const geoObservationsQueryOptions = (query: GeoObservationListQuery) => queryOptions({
  queryKey: queryKeys.geo.observationList(query),
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-observations', { params: { query } })),
  staleTime: QUERY_STALE_TIME.businessList,
});

export const geoInsightsQueryOptions = (query: GeoInsightQuery = {}) => queryOptions({
  queryKey: queryKeys.geo.insight(query),
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-insights', { params: { query } })),
  staleTime: QUERY_STALE_TIME.workbench,
});

export const geoObservationQueryOptions = (observationId: string | undefined) => queryOptions({
  queryKey: queryKeys.geo.observation(observationId ?? ''),
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-observations/{observation_id}', {
    params: { path: { observation_id: observationId! } },
  })),
  enabled: !!observationId,
  staleTime: QUERY_STALE_TIME.detail,
});

export const geoPublicationCandidatesQueryOptions = (productId: string | undefined) => queryOptions({
  queryKey: queryKeys.geo.publications(productId),
  queryFn: async () => unwrap(await api.GET('/api/v1/geo-observation-publications', {
    params: { query: { product_id: productId! } },
  })),
  enabled: !!productId,
  staleTime: QUERY_STALE_TIME.businessList,
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

export const platformProfilesQueryOptions = (query: PlatformProfileListQuery = {}) => queryOptions({
  queryKey: queryKeys.platformProfiles.list(query),
  queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles', { params: { query } })),
  staleTime: QUERY_STALE_TIME.configuration,
});

export const platformProfileQueryOptions = (platformProfileId: string | undefined) => queryOptions({
  queryKey: queryKeys.platformProfiles.detail(platformProfileId ?? ''),
  queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}', {
    params: { path: { platform_profile_id: platformProfileId! } },
  })),
  enabled: !!platformProfileId,
  staleTime: QUERY_STALE_TIME.detail,
});

export const auditLogsQueryOptions = (
  targetType: string,
  targetId: string | undefined,
  page = 1,
  pageSize = 100,
) => queryOptions({
  queryKey: queryKeys.auditLogList(targetType, targetId ?? '', page, pageSize),
  queryFn: async () => unwrap(await api.GET('/api/v1/audit-logs', {
    params: { query: { page, page_size: pageSize, target_type: targetType, target_id: targetId! } },
  })),
  enabled: !!targetId,
  staleTime: QUERY_STALE_TIME.businessList,
});

export const platformTypesQueryOptions = () => queryOptions({
  queryKey: queryKeys.platformTypes.all,
  queryFn: async () => unwrap(await api.GET('/api/v1/platform-types')),
  staleTime: QUERY_STALE_TIME.configuration,
});

export const publicationRecordsQueryOptions = (
  page: number,
  pageSize: number,
  status?: 'PENDING_MANUAL_PUBLISH' | 'PLATFORM_REVIEW' | 'PUBLISHED' | 'VERIFIED' | 'REJECTED' | 'REMOVED' | 'VERIFICATION_FAILED',
) => queryOptions({
  queryKey: queryKeys.publications.recordList(page, pageSize, status),
  queryFn: async () => unwrap(await api.GET('/api/v1/publication-records', {
    params: { query: { page, page_size: pageSize, ...(status ? { status } : {}) } },
  })),
  staleTime: QUERY_STALE_TIME.businessList,
});
