import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializePrincipalEpoch, invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { opportunityKeys } from './opportunities.api';
import { OpportunitySchedule } from './opportunity-schedule';
import { initialSchedule, scheduleForm, scheduleKey, type ScheduleDetail } from './opportunity-schedule.api';
import { failure, response } from './opportunities.test-support';

const path = '/api/v1/geo/opportunities/evaluation-schedule';
const at = '2026-10-25T08:00:00Z';
const id = '30000000-0000-4000-8000-000000000001';
function detail(patch: Partial<ScheduleDetail> = {}): ScheduleDetail {
  return { revision: 1, status: 'DISABLED', configuration: structuredClone(initialSchedule), authorizer_id: id, next_run_at: null, latest_window: null, available_actions: ['CONFIGURE', 'ACTIVATE'], blocked_reason: null, ...patch };
}
function completed(): ScheduleDetail {
  return detail({ status: 'ACTIVE', next_run_at: at, available_actions: ['CONFIGURE', 'PAUSE'], latest_window: { scheduled_for: at, configuration_revision: 1, configuration: structuredClone(initialSchedule), status: 'COMPLETED', error_code: null, covered_until: null, created_at: at, receipt: { evaluation_run_id: id, rule_set_revision: 1, evaluated_cells: 3, created: 1, existing_reused: 1, skipped: 1, unavailable_reasons: [{ code: 'INSUFFICIENT_SAMPLE', count: 1 }], as_of: at, replayed: false } } });
}
afterEach(() => vi.restoreAllMocks());
function setup(read: () => ScheduleDetail = detail) {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (url) => {
    if (url === path) return response(read());
    throw new Error(`未声明GET ${url}`);
  });
  const client = createAppQueryClient();
  initializePrincipalEpoch(client, 'admin');
  const routeTree = createRootRoute({ component: () => <OpportunitySchedule csrfToken="csrf" /> });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, view, get };
}
async function open() {
  await userEvent.click(await screen.findByRole('button', { name: '自动周期评估' }));
  await screen.findByRole('region', { name: '自动评估运行进展' });
}
async function edit() {
  await open();
  await userEvent.click(screen.getByRole('button', { name: '编辑周期配置' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存周期配置' })).toBeEnabled());
}
describe('机会自动评估管理员入口', () => {
  it('关闭时不读取；展开仅GET，保存仍DISABLED，状态命令显式确认并CAS', async () => {
    let current = detail();
    const { get } = setup(() => current);
    const put = vi.spyOn(api, 'PUT').mockImplementation(async () => response(current = detail({ revision: 2, configuration: { ...initialSchedule, interval_hours: 12 } })));
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => response(current = detail({ revision: 3, status: 'ACTIVE', next_run_at: at, available_actions: ['CONFIGURE', 'PAUSE'] })));
    await screen.findByRole('button', { name: '自动周期评估' });
    expect(get).not.toHaveBeenCalled();
    await edit();
    fireEvent.change(screen.getByRole('spinbutton', { name: '评估周期（小时）' }), { target: { value: '12' } });
    await userEvent.click(screen.getByRole('button', { name: '保存周期配置' }));
    await screen.findByText('最近已确认操作的配置修订号：2。');
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toMatchObject([path, { body: { expected_revision: 1, configuration: { ...initialSchedule, interval_hours: 12 } }, params: { header: { 'X-CSRF-Token': 'csrf', 'X-Request-ID': expect.any(String) } } }]);
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '启用周期评估' }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认周期状态操作' }));
    await screen.findByText('最近已确认操作的配置修订号：3。');
    expect(post.mock.calls[0]).toMatchObject([path + '/activate', { body: { expected_revision: 2 } }]);
  });
  it('409与背景修订冻结编辑基线，显式GET保留输入后才可新提交', async () => {
    let current = detail(); const { client, get } = setup(() => current);
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(failure(409));
    await edit();
    fireEvent.change(screen.getByRole('spinbutton', { name: '评估周期（小时）' }), { target: { value: '18' } });
    await userEvent.click(screen.getByRole('button', { name: '保存周期配置' }));
    await screen.findByText(/版本或读取上下文已变化/);
    current = detail({ revision: 2 });
    act(() => client.setQueryData(scheduleKey, current));
    expect(screen.getByRole('button', { name: '保存周期配置' })).toBeDisabled();
    expect(put).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '刷新运行记录与配置' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存周期配置' })).toBeEnabled());
    expect(screen.getByRole('spinbutton', { name: '评估周期（小时）' })).toHaveValue(18);
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
  });
  it('未知结果冻结输入；只GET核对，不重发原操作', async () => {
    setup(); const put = vi.spyOn(api, 'PUT').mockResolvedValue(failure(503));
    await edit();
    fireEvent.change(screen.getByRole('spinbutton', { name: '评估周期（小时）' }), { target: { value: '18' } });
    await userEvent.click(screen.getByRole('button', { name: '保存周期配置' }));
    await screen.findByText(/提交结果未知，请重读/);
    expect(screen.getByRole('spinbutton', { name: '评估周期（小时）' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '刷新运行记录与配置' }));
    await userEvent.click(await screen.findByRole('button', { name: '结束核对并保留输入' }));
    expect(screen.getByRole('spinbutton', { name: '评估周期（小时）' })).toHaveValue(18);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存周期配置' })).toBeEnabled());
    expect(put).toHaveBeenCalledTimes(1);
  });
  it('请求中双击只提交一次；主体切换后迟到成功不进入缓存', async () => {
    const { client } = setup(); let finish!: (v: never) => void;
    const put = vi.spyOn(api, 'PUT').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await edit();
    await userEvent.dblClick(screen.getByRole('button', { name: '保存周期配置' }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '保存周期配置' })).toBeDisabled();
    invalidatePrincipalEpoch(client, 'engineer');
    await act(async () => finish(response(detail({ revision: 2 }))));
    expect(client.getQueryData<ScheduleDetail>(scheduleKey)?.revision).not.toBe(2);
    expect(screen.queryByText('最近已确认操作的配置修订号：2。')).not.toBeInTheDocument();
  });
  it('首次读取已经完成的回执也失效机会等读模型，同ID不会重复失效', async () => {
    const { client } = setup(completed);
    client.setQueryData([...opportunityKeys.root(), 'fixture'], { stale: true });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await open();
    await screen.findByLabelText('自动评估冻结回执');
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('自动评估冻结回执')).toHaveTextContent('有效样本不足');
    act(() => client.setQueryData(scheduleKey, completed()));
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('link', { name: '查看机会结果' })).toHaveAttribute('href', '/geo/opportunities');
  });
  it.each([401, 403])('HTTP %i隐藏配置和写入口', async (status) => {
    const { get } = setup(); get.mockResolvedValue(failure(status));
    await userEvent.click(await screen.findByRole('button', { name: '自动周期评估' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号不能访问');
    expect(screen.queryByRole('button', { name: '编辑周期配置' })).not.toBeInTheDocument();
  });
  it('周期边界复用手动评估的范围校验，读取轮询配置不触发评估', () => {
    expect(scheduleForm.safeParse(initialSchedule).success).toBe(true);
    for (const patch of [{ interval_hours: 0 }, { interval_hours: 169 }, { lookback_days: 32 }, { scope: 'FILTERED' }, { subject_ids: [id] }])
      expect(scheduleForm.safeParse({ ...initialSchedule, ...patch }).success).toBe(false);
  });
});
