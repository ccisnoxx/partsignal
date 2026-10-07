import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { reportParams, type Report, type ReportSearch } from './reports.model';
export class ReportRequestError extends Error {
  constructor(readonly status: number, readonly detail?: components['schemas']['ErrorDetail']) { super('报告读取失败'); this.name = 'ReportRequestError'; }
}
export const reportKeys = { root: ['geo', 'reports'] as const };
export function reportOptions(search: ReportSearch, print = false) {
  const query = reportParams(search);
  return queryOptions({ queryKey: [...reportKeys.root, print ? 'print' : 'preview', query], retry: false, retryOnMount: false, refetchOnWindowFocus: false, staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result = await api.GET(print ? '/api/v1/geo/reports/print' : '/api/v1/geo/reports/preview', { params: { query }, signal, cache: 'no-store' });
      if (!result.data) throw new ReportRequestError(result.response.status, result.error?.error);
      return result.data as Report;
    },
  });
}
export function retainReport(error: Error | null) {
  return !error || !(error instanceof ReportRequestError) || error.status >= 500 || error.status === 429;
}
