import { z } from 'zod';
import type { components, operations } from '@/shared/api/generated/schema';
import { baseParams, normalizeBase, type BaseSearch } from '@/domains/geo-insights/insights.model';
export type Report = components['schemas']['GeoReportPreview'];
export type ReportSearch = BaseSearch;
export type ExportKind = components['schemas']['GeoReportExport']['kind'];
export const reportSearchSchema = z.record(z.string(), z.unknown()).transform(normalizeBase);
export function isCanonicalReportSearch(raw: Record<string, unknown>, search: ReportSearch) {
  const keys = Object.keys(raw).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(search).sort()) && keys.every((key) => JSON.stringify(raw[key]) === JSON.stringify(search[key as keyof ReportSearch]));
}
export function reportParams(search: ReportSearch): operations['getGeoReportPreview']['parameters']['query'] { return baseParams(search); }
export const exportLabels = { runs: '运行', citations: '引用', claims: '声明', opportunities: '机会' } satisfies Record<ExportKind, string>;
export function exportUrl(kind: ExportKind, search: ReportSearch) {
  const url = new URL(`/api/v1/geo/reports/${kind}.csv`, import.meta.env.VITE_API_BASE_URL || globalThis.location.origin);
  for (const [key, value] of Object.entries(reportParams(search))) {
    if (value === undefined || value === null) continue;
    for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(entry));
  }
  return url.href;
}
