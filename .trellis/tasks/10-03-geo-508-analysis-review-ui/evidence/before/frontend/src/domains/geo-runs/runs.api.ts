import { z } from 'zod';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  batchPollInterval,
  batchSearchToParams,
  runPollInterval,
  runSearchToParams,
  type BatchParams,
  type RunParams,
  type RunSearch,
} from './runs.model';

class RunRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: components['schemas']['ErrorDetail'],
  ) {
    super(message);
    this.name = 'RunRequestError';
  }
}
const runKeys = {
  root: () => ['geo', 'runs'] as const,
  lists: () => ['geo', 'runs', 'list'] as const,
  list: (params: RunParams) => ['geo', 'runs', 'list', params] as const,
  batches: () => ['geo', 'runs', 'batches'] as const,
  batchList: (params: BatchParams) => ['geo', 'runs', 'batches', params] as const,
  batch: (id: string) => ['geo', 'runs', 'batch', id] as const,
  detail: (id: string) => ['geo', 'runs', 'detail', id] as const,
  manual: (id: string) => ['geo', 'runs', 'manual', id] as const,
};
const readDefaults = {
  retry: false,
  retryOnMount: false,
  staleTime: 10_000,
  refetchIntervalInBackground: false,
} as const;
function batchListOptions(search: RunSearch, enabled = true) {
  const params = batchSearchToParams(search);
  return queryOptions({
    ...readDefaults,
    enabled,
    queryKey: runKeys.batchList(params),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/observation-batches', { params: { query: params }, signal });
      if (!result.data) throw requestError('读取批次', result);
      return result.data as components['schemas']['GeoBatchListPage'];
    },
    refetchInterval: (query) =>
      !query.state.error && query.state.data?.items.some((item) => batchPollInterval(item.workflow_stage, item.summary)) ? 5000 : false,
  });
}
function runListOptions(search: RunSearch, enabled = true) {
  const params = runSearchToParams(search);
  return queryOptions({
    ...readDefaults,
    enabled,
    queryKey: runKeys.list(params),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/observation-runs', { params: { query: params }, signal });
      if (!result.data) throw requestError('读取运行', result);
      return result.data as components['schemas']['GeoRunListPage'];
    },
    refetchInterval: (query) =>
      !query.state.error && query.state.data?.items.some((item) => runPollInterval(item.workflow_stage)) ? 5000 : false,
  });
}
function batchDetailOptions(id: string, enabled = true) {
  return queryOptions({
    ...readDefaults,
    enabled,
    queryKey: runKeys.batch(id),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/observation-batches/{batch_id}', {
        params: { path: { batch_id: id } },
        signal,
      });
      if (!result.data) throw requestError('读取批次详情', result);
      return result.data as components['schemas']['GeoBatchDetail'];
    },
    refetchInterval: (query) =>
      !query.state.error && query.state.data ? batchPollInterval(query.state.data.workflow.workflow_stage, query.state.data.summary) : false,
  });
}
function runDetailOptions(id: string, enabled = true) {
  return queryOptions({
    ...readDefaults,
    gcTime: 0,
    enabled,
    queryKey: runKeys.detail(id),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/observation-runs/{run_id}', {
        params: { path: { run_id: id } },
        signal,
        cache: 'no-store',
      });
      if (!result.data) throw requestError('读取运行详情', result);
      return result.data as components['schemas']['GeoRunDetail'];
    },
    refetchInterval: (query) =>
      !query.state.error && query.state.data ? runPollInterval(query.state.data.run.workflow_stage) : false,
  });
}
function manualEntryOptions(id: string, enabled = true) {
  return queryOptions({
    ...readDefaults,
    enabled,
    queryKey: runKeys.manual(id),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/observation-runs/{run_id}/manual-entry', {
        params: { path: { run_id: id } },
        signal,
        cache: 'no-store',
      });
      if (!result.data) throw requestError('读取人工草稿', result);
      return result.data as components['schemas']['GeoManualEntryContext'];
    },
  });
}
async function saveManualDraft(
  id: string,
  body: components['schemas']['GeoManualDraftSave'],
  csrfToken: string | null,
) {
  const result = await api.PUT('/api/v1/geo/observation-runs/{run_id}/manual-draft', {
    body,
    params: { path: { run_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('保存人工草稿', result);
  return result.data as components['schemas']['GeoManualDraftOut'];
}
async function submitManualObservation(
  id: string,
  body: components['schemas']['GeoManualObservationSubmit'],
  key: string,
  csrfToken: string | null,
) {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/manual-submit', {
    body,
    params: { path: { run_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken), 'Idempotency-Key': key } },
  });
  if (!result.data) throw requestError('提交人工观测', result);
  return result.data as components['schemas']['GeoManualObservationSubmitted'];
}
async function runPlanNow(id: string, revision: number, key: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/monitoring-plans/{plan_id}/run', {
    body: { expected_revision: revision },
    params: { path: { plan_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken), 'Idempotency-Key': key } },
  });
  if (!result.data) throw requestError('创建运行批次', result);
  const receipt = z
    .object({
      batch_id: canonicalUuidSchema,
      requested_run_count: z.number().int().positive(),
      created_at: z.iso.datetime({ offset: true }),
    })
    .strict()
    .safeParse(result.data);
  if (!receipt.success) throw new RunRequestError('批次创建回执不完整，结果未知，请使用原请求确认');
  return receipt.data;
}
async function retryRun(id: string, revision: number, csrfToken: string | null) {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/retry', {
    body: { expected_revision: revision },
    params: { path: { run_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('创建新尝试', result);
  const receipt = z.object({
    run_id: canonicalUuidSchema,
    batch_id: canonicalUuidSchema,
    previous_attempt_id: canonicalUuidSchema,
    attempt_no: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
  }).strict().safeParse(result.data);
  if (!receipt.success || receipt.data.previous_attempt_id !== id || receipt.data.run_id === id)
    throw new RunRequestError('新尝试回执不完整，结果未知，请读取尝试链确认');
  return receipt.data;
}
async function createRunUploadIntent(body: components['schemas']['UploadIntentCreate'], csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/upload-intents', {
    body,
    params: { header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('创建截图上传', result);
  return result.data as components['schemas']['UploadIntent'];
}
async function completeRunUpload(id: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/complete', {
    params: { path: { file_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('校验截图', result);
  return result.data as components['schemas']['FileRecord'];
}
async function readRunUpload(id: string) {
  const result = await api.GET('/api/v1/files/{file_id}', { params: { path: { file_id: id } }, cache: 'no-store' });
  if (!result.data) throw requestError('读取截图状态', result);
  return result.data as components['schemas']['FileRecord'];
}
async function abortRunUpload(id: string, csrfToken: string | null) {
  const result = await api.POST('/api/v1/files/{file_id}/abort', {
    params: { path: { file_id: id }, header: { 'X-CSRF-Token': csrf(csrfToken) } },
  });
  if (!result.data) throw requestError('放弃截图上传', result);
  return result.data as components['schemas']['FileRecord'];
}
function csrf(value: string | null) {
  if (value) return value;
  throw new RunRequestError('缺少会话安全令牌，无法执行操作');
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function requestError(action: string, result: { error?: unknown; response: Response }) {
  const body = result.error;
  if (record(body) && Object.keys(body).length === 1 && record(body.error)) {
    const detail = body.error;
    if (
      Object.keys(detail).length === 4 &&
      typeof detail.code === 'string' &&
      typeof detail.message === 'string' &&
      typeof detail.request_id === 'string' &&
      record(detail.details)
    )
      return new RunRequestError(
        `${detail.message}（请求 ID：${detail.request_id}）`,
        result.response.status,
        detail as components['schemas']['ErrorDetail'],
      );
  }
  return new RunRequestError(`${action}失败（HTTP ${result.response.status}）`, result.response.status);
}
export {
  abortRunUpload,
  batchDetailOptions,
  batchListOptions,
  completeRunUpload,
  createRunUploadIntent,
  manualEntryOptions,
  readRunUpload,
  requestError,
  runDetailOptions,
  runKeys,
  runListOptions,
  runPlanNow,
  retryRun,
  RunRequestError,
  saveManualDraft,
  submitManualObservation,
};
