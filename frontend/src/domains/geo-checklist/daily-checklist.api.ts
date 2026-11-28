import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

export type DailyChecklist = components['schemas']['GeoDailyChecklistOut'];
export type DailyChecklistItem = components['schemas']['GeoDailyChecklistItem'];
export type DailyChecklistEnsureOut = components['schemas']['GeoDailyChecklistEnsureOut'];
export type ManualPreviewRequest = components['schemas']['GeoManualPreviewRequest'];
export type ManualPreviewOut = components['schemas']['GeoManualPreviewOut'];
export type ManualObservationSubmit = components['schemas']['GeoManualObservationSubmit'];
export type ManualObservationSubmitted = components['schemas']['GeoManualObservationSubmitted'];
export type ManualFailRequest = components['schemas']['GeoManualFailRequest'];
export type DirectManualObservationCreate = components['schemas']['GeoDirectManualObservationCreate'];
export type DirectManualObservationOut = components['schemas']['GeoDirectManualObservationOut'];
export type CitationPublicationLink = components['schemas']['GeoCitationPublicationLinkOut'];
export type PromptCategory = components['schemas']['GeoPromptCategory'];
export type RunStatus = components['schemas']['GeoRunStatus'];

export type DailyChecklistQueryParams = {
  target_date?: string;
  timezone?: string;
  assignee_id?: string;
  status?: RunStatus;
  category?: PromptCategory;
};

export const checklistKeys = {
  all: ['geo-daily-checklist'] as const,
  list: (params: DailyChecklistQueryParams) => ['geo-daily-checklist', params] as const,
  links: (runId: string) => ['geo-run-citation-links', runId] as const,
};

function unwrapError(action: string, result: { error?: unknown; response: Response }): Error {
  const err = result.error as { error?: { message?: string } } | undefined;
  return new Error(err?.error?.message ?? `${action}失败（HTTP ${result.response.status}）`);
}

export function dailyChecklistQueryOptions(params: DailyChecklistQueryParams) {
  return queryOptions({
    queryKey: checklistKeys.list(params),
    queryFn: async (): Promise<DailyChecklist> => {
      const result = await api.GET('/api/v1/geo/daily-checklist', { params: { query: params } });
      if (!result.data) throw unwrapError('读取今日待监测清单', result);
      return result.data;
    },
    staleTime: 10_000,
  });
}

export async function ensureDailyChecklist(
  targetDate: string,
  csrfToken: string,
): Promise<DailyChecklistEnsureOut> {
  const result = await api.POST('/api/v1/geo/daily-checklist/ensure', {
    params: { header: { 'X-CSRF-Token': csrfToken } },
    body: { target_date: targetDate },
  });
  if (!result.data) throw unwrapError('生成今日清单', result);
  return result.data;
}

export async function previewManualObservation(
  runId: string,
  body: ManualPreviewRequest,
  csrfToken: string,
): Promise<ManualPreviewOut> {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/manual-preview', {
    params: { path: { run_id: runId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('规则预判', result);
  return result.data;
}

export async function submitManualObservation(
  runId: string,
  body: ManualObservationSubmit,
  idempotencyKey: string,
  csrfToken: string,
): Promise<ManualObservationSubmitted> {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/manual-submit', {
    params: {
      path: { run_id: runId },
      header: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': idempotencyKey },
    },
    body,
  });
  if (!result.data) throw unwrapError('提交人工观测', result);
  return result.data;
}

export async function failManualObservation(
  runId: string,
  body: ManualFailRequest,
  csrfToken: string,
): Promise<void> {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/manual-fail', {
    params: { path: { run_id: runId }, header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('标记采集异常', result);
}

export async function createDirectObservation(
  body: DirectManualObservationCreate,
  csrfToken: string,
): Promise<DirectManualObservationOut> {
  const result = await api.POST('/api/v1/geo/direct-observations', {
    params: { header: { 'X-CSRF-Token': csrfToken } },
    body,
  });
  if (!result.data) throw unwrapError('单条直录', result);
  return result.data;
}

export async function decideCitationLink(
  linkId: string,
  expectedRevision: number,
  linkStatus: 'CONFIRMED' | 'REJECTED',
  csrfToken: string,
): Promise<CitationPublicationLink> {
  const result = await api.PATCH('/api/v1/geo/citation-links/{link_id}', {
    params: { path: { link_id: linkId }, header: { 'X-CSRF-Token': csrfToken } },
    body: { expected_revision: expectedRevision, link_status: linkStatus },
  });
  if (!result.data) throw unwrapError('确认引用归因', result);
  return result.data;
}
