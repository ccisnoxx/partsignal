import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

export type LeadershipFilterOptions = components['schemas']['GeoLeadershipFilterOptionsOut'];
export type LeadershipDashboard = components['schemas']['GeoLeadershipDashboardOut'];
export type LeadershipSummaryCards = components['schemas']['GeoLeadershipSummaryCards'];
export type LeadershipRateMetric = components['schemas']['GeoRateMetricOut'];
export type LeadershipEvidenceItem = components['schemas']['GeoLeadershipEvidenceItem'];
export type LeadershipEvidenceList = components['schemas']['GeoLeadershipEvidenceList'];
export type ReportSnapshotSummary = components['schemas']['GeoReportSnapshotOut'];
export type ReportSnapshotDetail = components['schemas']['GeoReportSnapshotDetail'];
export type ReportSnapshotList = components['schemas']['GeoReportSnapshotList'];
export type ReportSnapshotCreateRequest = components['schemas']['GeoReportSnapshotCreateRequest'];
export type ReportSnapshotKind = components['schemas']['GeoReportSnapshotKind'];

export type LeadershipDashboardQueryParams = {
  period_from?: string;
  period_to?: string;
  bucket_granularity?: 'DAY' | 'WEEK';
  product_id?: string;
  surface_id?: string;
  collection_mode?: 'MANUAL' | 'API' | 'BROWSER';
  timezone?: string;
};

export type LeadershipEvidenceQueryParams = {
  run_id?: string[];
  prompt_variant_id?: string;
  surface_id?: string;
  article_publication_id?: string;
  period_from?: string;
  period_to?: string;
  limit?: number;
};

export const dashboardKeys = {
  all: ['geo-leadership-dashboard'] as const,
  filterOptions: ['geo-leadership-filter-options'] as const,
  dashboard: (params: LeadershipDashboardQueryParams) => ['geo-leadership-dashboard', params] as const,
  evidence: (params: LeadershipEvidenceQueryParams) => ['geo-leadership-evidence', params] as const,
  snapshots: ['geo-report-snapshots'] as const,
  snapshotDetail: (snapshotId: string) => ['geo-report-snapshot', snapshotId] as const,
};

function unwrapError(action: string, result: { error?: unknown; response: Response }): Error {
  const err = result.error as { error?: { message?: string } } | undefined;
  return new Error(err?.error?.message ?? `${action}失败（HTTP ${result.response.status}）`);
}

export function leadershipFilterOptionsQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.filterOptions,
    queryFn: async (): Promise<LeadershipFilterOptions> => {
      const result = await api.GET('/api/v1/geo/leadership-dashboard/filter-options');
      if (!result.data) throw unwrapError('读取看板筛选项', result);
      return result.data;
    },
    staleTime: 60_000,
  });
}

export function leadershipDashboardQueryOptions(params: LeadershipDashboardQueryParams) {
  return queryOptions({
    queryKey: dashboardKeys.dashboard(params),
    queryFn: async (): Promise<LeadershipDashboard> => {
      const result = await api.GET('/api/v1/geo/leadership-dashboard', {
        params: { query: params },
      });
      if (!result.data) throw unwrapError('读取领导效果看板', result);
      return result.data;
    },
    staleTime: 15_000,
  });
}

export function leadershipEvidenceQueryOptions(params: LeadershipEvidenceQueryParams, enabled = true) {
  return queryOptions({
    queryKey: dashboardKeys.evidence(params),
    queryFn: async (): Promise<LeadershipEvidenceList> => {
      const result = await api.GET('/api/v1/geo/leadership-dashboard/evidence', {
        params: { query: params },
      });
      if (!result.data) throw unwrapError('读取下钻证据列表', result);
      return result.data;
    },
    enabled,
    staleTime: 15_000,
  });
}

export function reportSnapshotsQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.snapshots,
    queryFn: async (): Promise<ReportSnapshotList> => {
      const result = await api.GET('/api/v1/geo/report-snapshots', {
        params: { query: { limit: 100 } },
      });
      if (!result.data) throw unwrapError('读取冻结快照列表', result);
      return result.data;
    },
    staleTime: 15_000,
  });
}

export function reportSnapshotDetailQueryOptions(snapshotId: string, enabled = true) {
  return queryOptions({
    queryKey: dashboardKeys.snapshotDetail(snapshotId),
    queryFn: async (): Promise<ReportSnapshotDetail> => {
      const result = await api.GET('/api/v1/geo/report-snapshots/{snapshot_id}', {
        params: { path: { snapshot_id: snapshotId } },
      });
      if (!result.data) throw unwrapError('读取冻结快照详情', result);
      return result.data;
    },
    enabled: enabled && Boolean(snapshotId),
    staleTime: 60_000,
  });
}

export async function createReportSnapshot(
  body: ReportSnapshotCreateRequest,
  csrfToken: string,
): Promise<ReportSnapshotDetail> {
  const result = await api.POST('/api/v1/geo/report-snapshots', {
    params: { header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('创建冻结周报快照', result);
  return result.data;
}
