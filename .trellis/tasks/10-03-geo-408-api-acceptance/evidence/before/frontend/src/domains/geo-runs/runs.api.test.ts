import { QueryClient } from '@tanstack/react-query';
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
} from './runs.api';
import type { components } from '@/shared/api/generated/schema';
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
  it('只轮询服务端活跃工作阶段，停止人工等待、复核和终态；后台停止', () => {
    expect(
      poll(runListOptions({}), ['MANUAL_ENTRY_REQUIRED', 'COMPLETED', 'REVIEW_REQUIRED', 'HISTORICAL_FAILURE']),
    ).toBe(false);
    expect(poll(runListOptions({}), ['ANALYSIS_PENDING'])).toBe(5000);
    expect(poll(runListOptions({}), ['COLLECTION_IN_PROGRESS'])).toBe(5000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(poll(runListOptions({}), ['QUEUED'])).toBe(false);
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
