import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import {
  batchDetailOptions,
  batchListOptions,
  runDetailOptions,
  runListOptions,
  RunRequestError,
  requestError,
  runPlanNow,
  retryRun,
  submitRunReview,
} from './runs.api';
import type { components } from '@/shared/api/generated/schema';
import { reviewReceipt } from './analysis.test-support';
import { analysisId } from './analysis.test-support';
import { runId } from './runs.test-support';
afterEach(() => vi.restoreAllMocks());
function poll(options: ReturnType<typeof runListOptions>, stages: components['schemas']['GeoRunWorkflowStage'][]) {
  const data = {
    items: stages.map((workflow_stage) => ({ workflow_stage })),
  } as components['schemas']['GeoRunListPage'];
  const interval = options.refetchInterval as (query: {
    state: { data: components['schemas']['GeoRunListPage'] };
  }) => unknown;
  return interval({ state: { data } });
}
describe('读取频率与请求边界', () => {
  it('只轮询服务端活跃工作阶段，后台发送由 Query focus 管理', () => {
    expect(
      poll(runListOptions({}), ['MANUAL_ENTRY_REQUIRED', 'COMPLETED', 'REVIEW_REQUIRED', 'HISTORICAL_FAILURE']),
    ).toBe(false);
    expect(poll(runListOptions({}), ['ANALYSIS_PENDING'])).toBe(5000);
    expect(poll(runListOptions({}), ['COLLECTION_IN_PROGRESS'])).toBe(5000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(poll(runListOptions({}), ['QUEUED'])).toBe(5000);
    expect(runListOptions({}).refetchIntervalInBackground).toBe(false);
  });
  it('后台 GET 完成后，fresh 数据返回前台仍按 interval 恢复读取', async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    client.mount();
    focusManager.setFocused(false);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let release!: (value: never) => void;
    const data = { run: { workflow_stage: 'QUEUED' } };
    const result = { data, response: Response.json(data) } as never;
    const get = vi.spyOn(api, 'GET').mockResolvedValue(result);
    get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const observer = new QueryObserver(client, { ...runDetailOptions('one'), refetchOnWindowFocus: false });
    const unsubscribe = observer.subscribe(() => {});
    try {
      release(result);
      await vi.advanceTimersByTimeAsync(0);
      expect(observer.getCurrentResult().isStale).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(get).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible');
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe(); client.unmount(); client.clear();
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });
  it('轮询失败暂停读取，旧成功数据保留；批次无实际采集工作时停止', () => {
    const options = runListOptions({});
    const interval = options.refetchInterval as (query: unknown) => unknown;
    expect(interval({ state: { error: new Error('offline'), data: { items: [{ workflow_stage: 'QUEUED' }] } } })).toBe(false);
    const batchInterval = batchDetailOptions('one').refetchInterval as (query: unknown) => unknown;
    const data = { workflow: { workflow_stage: 'IN_PROGRESS' }, summary: { pending_manual_count: 0, status_counts: { pending: 0, running: 0, analyzing: 0, collected: 1 } } };
    expect(batchInterval({ state: { data } })).toBe(5000);
    data.summary.status_counts.collected = 0;
    expect(batchInterval({ state: { data } })).toBe(false);
    data.summary.status_counts.running = 1;
    expect(batchInterval({ state: { data } })).toBe(5000);
    data.workflow.workflow_stage = 'MANUAL_ENTRY_REQUIRED';
    expect(batchInterval({ state: { data } })).toBe(5000);
    data.summary.status_counts.running = 0;
    data.summary.status_counts.pending = 2; data.summary.pending_manual_count = 2;
    expect(batchInterval({ state: { data } })).toBe(false);
    data.summary.status_counts.collected = 1;
    expect(batchInterval({ state: { data } })).toBe(5000);
  });
  it('retry携带revision与CSRF，没有幂等键或自动重放，畸形成功为未知', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: { run_id: 'bad' }, response: Response.json({}) } as never);
    await expect(retryRun('10000000-0000-4000-8000-000000000001', 7, 'csrf')).rejects.toMatchObject({ status: undefined });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/retry', {
      body: { expected_revision: 7 }, params: { path: { run_id: '10000000-0000-4000-8000-000000000001' }, header: { 'X-CSRF-Token': 'csrf' } },
    });
  });
  it('review使用generated请求、冻结analysis/revision与CSRF；畸形回执保持未知，不重放', async () => {
    const body: components['schemas']['GeoRunReviewRequest'] = { analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CONFIRMED', correction_payload: null, comment: '' };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: reviewReceipt(body), response: Response.json({}) } as never);
    await expect(submitRunReview(runId, body, 'csrf')).resolves.toMatchObject({ run_revision: 8 });
    expect(post).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/review', { body, params: { path: { run_id: runId }, header: { 'X-CSRF-Token': 'csrf' } } });
    const wrong = reviewReceipt(body); wrong.run_revision = 9;
    post.mockResolvedValue({ data: wrong, response: Response.json({}) } as never);
    await expect(submitRunReview(runId, body, 'csrf')).rejects.toMatchObject({ status: undefined });
    expect(post).toHaveBeenCalledTimes(2);
  });
  it.each([null, 17, { schema_version: 1, mentions: [], recommendations: [], claims: [], citations: [] }])('CORRECTED 的畸形或丢失修正回执 %j 保持未知', async (correction) => {
    const body: components['schemas']['GeoRunReviewRequest'] = {
      analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CORRECTED', comment: '已人工核验引用',
      correction_payload: { schema_version: 1, mentions: [], recommendations: [], claims: [], citations: [{ citation_id: runId, source_category: 'COMMUNITY', subject_id: null }] },
    };
    const wrong = { ...reviewReceipt(body), review: { ...reviewReceipt(body).review, correction_payload: correction } };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: wrong, response: Response.json(wrong) } as never);
    await expect(submitRunReview(runId, body, 'csrf')).rejects.toMatchObject({ status: undefined });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('回执键顺序不改变有效写入；说明或 CONFIRMED 载荷不一致不能证明成功', async () => {
    const body: components['schemas']['GeoRunReviewRequest'] = {
      analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CORRECTED', comment: '已核验',
      correction_payload: { schema_version: 1, mentions: [], recommendations: [], claims: [], citations: [{ citation_id: runId, source_category: 'COMMUNITY', subject_id: null }] },
    };
    const correct = reviewReceipt(body);
    correct.review.correction_payload = { citations: [{ subject_id: null, source_category: 'COMMUNITY', citation_id: runId }], claims: [], recommendations: [], mentions: [], schema_version: 1 };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: correct, response: Response.json(correct) } as never);
    await expect(submitRunReview(runId, body, 'csrf')).resolves.toMatchObject({ run_revision: 8 });
    correct.review.comment = '另一份说明';
    await expect(submitRunReview(runId, body, 'csrf')).rejects.toMatchObject({ status: undefined });
    const confirmed = { ...body, decision: 'CONFIRMED' as const, correction_payload: null };
    correct.review.decision = 'CONFIRMED'; correct.review.comment = confirmed.comment;
    await expect(submitRunReview(runId, confirmed, 'csrf')).rejects.toMatchObject({ status: undefined });
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('2000 个 Unicode codepoint 的合法说明回执不能误归未知', async () => {
    const body: components['schemas']['GeoRunReviewRequest'] = { analysis_revision_id: analysisId, expected_run_revision: 7, decision: 'CONFIRMED', correction_payload: null, comment: '😀'.repeat(2000) };
    const receipt = reviewReceipt(body);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: receipt, response: Response.json(receipt) } as never);
    await expect(submitRunReview(runId, body, 'csrf')).resolves.toMatchObject({ review: { comment: body.comment } });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('列表、完整摘要与详情 query key 相互隔离，选中对象不污染列表 key', () => {
    expect(runListOptions({ run_id: 'one', edit: 1 }).queryKey).toEqual(runListOptions({}).queryKey);
    expect(batchListOptions({ page: 2 }).queryKey).not.toEqual(batchListOptions({}).queryKey);
    expect(batchDetailOptions('one').queryKey).not.toEqual(runDetailOptions('one').queryKey);
    expect(runDetailOptions('one')).toMatchObject({ gcTime: 0, retry: false, refetchIntervalInBackground: false });
  });
  it('畸形4xx envelope不证明明确拒绝，保留未知结果语义', () => {
    const error = { error: { code: 'CONFLICT', message: '拒绝', request_id: 'req', details: {}, extra: true } };
    expect(requestError('提交', { error, response: Response.json(error, { status: 409 }) }).detail).toBeUndefined();
    expect(
      requestError('提交', {
        error: { error: { code: 'CONFLICT', message: '拒绝', request_id: 'req', details: {} }, extra: true },
        response: Response.json({}, { status: 409 }),
      }).detail,
    ).toBeUndefined();
  });
  it('读取携带取消信号，失败保持 HTTP 边界和请求 ID；创建无自动重发', async () => {
    const error = { error: { code: 'REVISION_CONFLICT', message: '修订冲突', request_id: 'run-req', details: {} } };
    vi.spyOn(api, 'POST').mockResolvedValue({ error, response: Response.json(error, { status: 409 }) } as never);
    await expect(runPlanNow('one', 7, 'stable-key', 'csrf')).rejects.toMatchObject({
      status: 409,
      detail: error.error,
    });
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(api.POST).toHaveBeenCalledWith(
      '/api/v1/geo/monitoring-plans/{plan_id}/run',
      expect.objectContaining({
        body: { expected_revision: 7 },
        params: { path: { plan_id: 'one' }, header: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'stable-key' } },
      }),
    );
    await expect(runPlanNow('one', 7, 'stable-key', null)).rejects.toBeInstanceOf(RunRequestError);
    expect(api.POST).toHaveBeenCalledTimes(1);
    const get = vi
      .spyOn(api, 'GET')
      .mockResolvedValue({
        data: { items: [], total: 0, page: 1, page_size: 20 },
        response: Response.json({}),
      } as never);
    const client = new QueryClient();
    await client.fetchQuery(runListOptions({ view: 'runs' }));
    expect(get).toHaveBeenCalledWith(
      '/api/v1/geo/observation-runs',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        params: { query: expect.objectContaining({ latest_only: true }) },
      }),
    );
  });
});
