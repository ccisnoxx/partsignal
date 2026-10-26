import { useState, type Dispatch, type SetStateAction } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { plan, planId, mockReads, response, failure } from '@/domains/geo-plans/plans.test-support';
import { planKeys } from '@/domains/geo-plans/plans.api';
import { BatchCreate } from './batch-create';
const receipt = {
  batch_id: '10000000-0000-4000-8000-000000000009',
  requested_run_count: 3,
  created_at: '2026-10-02T08:00:00Z',
};
function setup(initialPlanId?: string) {
  const client = createAppQueryClient();
  const created = vi.fn();
  const root = createRootRoute();
  let update!: Dispatch<SetStateAction<string | undefined>>;
  function TestForm() {
    const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId);
    update = setSelectedPlanId;
    return <BatchCreate key={selectedPlanId ?? 'unselected'} planId={selectedPlanId} onPlanChange={setSelectedPlanId} csrfToken="csrf" onClose={vi.fn()} onCreated={created} />;
  }
  const route = createRoute({
    getParentRoute: () => root,
    path: '/geo/runs',
    component: TestForm,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/geo/runs?create=1'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, created, updatePlan: (id?: string) => act(() => update(id)) };
}
afterEach(() => vi.restoreAllMocks());
async function select() {
  await userEvent.click(await screen.findByRole('button', { name: /原始监测计划 · Revision 7/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认创建批次' })).toBeEnabled());
}
describe('批次创建的快照与幂等身份', () => {
  it('向服务端仅查询人工计划，历史 CRON 投影不可选且没有写请求', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [plan({
      schedule_kind: 'CRON', cron_expression: '0 * * * *', status: 'ACTIVE',
      workflow_stage: 'UNSUPPORTED_SCHEDULE', primary_task: 'VIEW_HISTORY', available_actions: [],
      deletion: { blockers: ['SCHEDULE_UNSUPPORTED'] },
      run_entry: { available: false, reason_code: 'GEO_PLAN_CRON_UNSUPPORTED' },
    })], total: 1, page: 1, page_size: 20 }));
    const post = vi.spyOn(api, 'POST');
    setup();
    const historical = await screen.findByRole('button', { name: /原始监测计划 · Revision 7/ });
    expect(get).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans', expect.objectContaining({
      params: { query: expect.objectContaining({ schedule_kind: 'MANUAL_ONLY' }) },
    }));
    expect(historical).toBeDisabled();
    await userEvent.click(historical);
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
  it('未知结果保留原计划修订和同键，显式重试后采用canonical batch ID', async () => {
    mockReads();
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new TypeError('网络断开'))
      .mockResolvedValueOnce(response(receipt));
    const { created, client } = setup();
    await select();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建批次' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await screen.findByRole('button', { name: '确认原批次创建结果' });
    act(() => client.setQueryData(planKeys.detail(planId), plan({ revision: 99 })));
    expect(screen.getByText(/已选择：原始监测计划 · Revision 7/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '确认原批次创建结果' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id, planId));
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7 } });
  });
  it('冲突保留选择且停止写入，显式重新读取后使用新修订', async () => {
    let current = plan();
    const get = vi
      .spyOn(api, 'GET')
      .mockImplementation(async (path) =>
        path === '/api/v1/geo/monitoring-plans/{plan_id}'
          ? response(current)
          : response({ items: [plan()], total: 1, page: 1, page_size: 20 }),
      );
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure()).mockResolvedValueOnce(response(receipt));
    setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    const reload = await screen.findByRole('button', { name: '重新读取计划并确认' });
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeDisabled();
    current = plan({ revision: 8 });
    await userEvent.click(reload);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}', expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 8 } });
  });
  it('畸形成功回执不丢幂等键、不宣告创建成功；同键恢复可信回执', async () => {
    mockReads();
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response({ batch_id: 'bad' }))
      .mockResolvedValueOnce(response(receipt));
    const { created } = setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    const retry = await screen.findByRole('button', { name: '确认原批次创建结果' });
    expect(created).not.toHaveBeenCalled();
    await userEvent.click(retry);
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id, planId));
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  });
  it('旧主体未知请求不得作为新主体重新创建', async () => {
    mockReads();
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('网络断开'));
    const { client } = setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    const retry = await screen.findByRole('button', { name: '确认原批次创建结果' });
    invalidatePrincipalEpoch(client);
    await userEvent.click(retry);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('深链计划不在列表中仍精确读取当前矩阵，只在确认后发送该计划revision', async () => {
    const get = mockReads(() => plan({ revision: 12, name: '列表外的来源计划' }), () => []);
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(receipt));
    const { created } = setup(planId);
    expect(await screen.findByText(/已选择：列表外的来源计划 · Revision 12/)).toBeVisible();
    expect(screen.getByText(/服务端矩阵：1 × 1 × 3 = 3 次/)).toBeVisible();
    expect(get).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}', expect.objectContaining({ params: { path: { plan_id: planId } } }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id, planId));
    expect(post).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}/run', expect.objectContaining({ body: { expected_revision: 12 }, params: expect.objectContaining({ path: { plan_id: planId } }) }));
  });
  it.each([401, 403, 404])('深链读取%d不自动改选列表中的计划，不提供无效重试', async (status) => {
    mockReads(plan, () => [plan()], () => failure('NOT_FOUND', status));
    const post = vi.spyOn(api, 'POST');
    setup(planId);
    expect(await screen.findByText(/无法读取所选计划/)).toBeVisible();
    expect(screen.queryByText(/已选择：/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认创建批次' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新读取所选计划' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '清除计划并重新选择' }));
    expect(screen.queryByText(/无法读取所选计划/)).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it('暂时读取失败保留计划身份，显式重读恢复，无自动写请求', async () => {
    let failed = true;
    mockReads(plan, () => [], () => failed ? failure('INTERNAL_ERROR', 503) : undefined);
    const post = vi.spyOn(api, 'POST');
    setup(planId);
    await screen.findByText(/无法读取所选计划/);
    failed = false;
    await userEvent.click(screen.getByRole('button', { name: '重新读取所选计划' }));
    expect(await screen.findByText(/已选择：原始监测计划/)).toBeVisible();
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });
  it('切换计划后忽略迟到旧读取，提交只使用最新URL身份', async () => {
    const otherId = '10000000-0000-4000-8000-000000000008';
    let release!: (value: never) => void;
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path !== '/api/v1/geo/monitoring-plans/{plan_id}') return response({ items: [], total: 0, page: 1, page_size: 20 });
      const request = options as { params?: { path?: { plan_id?: string } } } | undefined;
      if (request?.params?.path?.plan_id === planId) return new Promise((resolve) => { release = resolve; });
      return response(plan({ id: otherId, revision: 9, name: '后选计划' }));
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(receipt));
    const { updatePlan, created } = setup(planId);
    await screen.findByText('正在读取所选计划及当前矩阵…');
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeDisabled();
    updatePlan(otherId);
    await screen.findByText(/已选择：后选计划/);
    await act(async () => release(response(plan())));
    expect(screen.queryByText(/已选择：原始监测计划/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id, otherId));
    expect(post).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}/run', expect.objectContaining({ params: expect.objectContaining({ path: { plan_id: otherId } }), body: { expected_revision: 9 } }));
  });
  it('通过深链传入CRON也不绕过人工建批范围', async () => {
    mockReads(() => plan({ schedule_kind: 'CRON', cron_expression: '0 * * * *' }), () => []);
    const post = vi.spyOn(api, 'POST');
    setup(planId);
    await screen.findByText(/此入口仅支持人工计划/);
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([false, true])('读取成功后403隐藏缓存详情及写入入口，未知结果=%s仍可安全退出', async (unknown) => {
    let denied = false;
    mockReads(plan, () => [], () => denied ? failure('FORBIDDEN', 403) : undefined);
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('网络断开'));
    const { client } = setup(planId);
    await screen.findByText(/已选择：原始监测计划/);
    if (unknown) {
      await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
      await screen.findByRole('button', { name: '确认原批次创建结果' });
    }
    denied = true;
    await act(async () => { await client.refetchQueries({ queryKey: planKeys.detail(planId), exact: true }); });
    await screen.findByText(/无法读取所选计划/);
    expect(client.getQueryData(planKeys.detail(planId))).toMatchObject({ revision: 7 });
    expect(screen.queryByText(/已选择：原始监测计划/)).not.toBeInTheDocument();
    expect(screen.queryByText(/服务端矩阵：/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认创建批次' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认原批次创建结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭批次创建' })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(unknown ? 1 : 0);
  });

  it('创建回执已到但列表取消尚未完成时切换计划，旧完成回调不覆盖新上下文', async () => {
    let current = plan();
    mockReads(() => current, () => []);
    vi.spyOn(api, 'POST').mockResolvedValue(response(receipt));
    const { client, created, updatePlan } = setup(planId);
    await screen.findByText(/已选择：原始监测计划/);
    let release!: () => void;
    const cancel = vi.spyOn(client, 'cancelQueries').mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    current = plan({ id: '10000000-0000-4000-8000-000000000008', name: '最新计划上下文' });
    updatePlan(current.id);
    await screen.findByText(/已选择：最新计划上下文/);
    await act(async () => release());
    expect(created).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeEnabled();
  });

});
