import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializePrincipalEpoch, invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { OpportunityEvaluation } from './opportunity-evaluation';
import { failure, mockReads, renderOpportunities, response } from './opportunities.test-support';

const receipt: components['schemas']['GeoOpportunityEvaluationReceipt'] = { evaluation_run_id: '30000000-0000-4000-8000-000000000001', rule_set_revision: 2, evaluated_cells: 3, created: 1, existing_reused: 1, skipped: 1, unavailable_reasons: [{ code: 'INSUFFICIENT_SAMPLE', count: 1 }], as_of: '2026-10-07T08:00:00Z', replayed: false };
afterEach(() => vi.restoreAllMocks());
function setup() {
  vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [], total: 0 }));
  const client = createAppQueryClient(); initializePrincipalEpoch(client, 'admin');
  const routeTree = createRootRoute({ component: () => <OpportunityEvaluation csrfToken="csrf" /> });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, view };
}
async function fill() {
  await userEvent.click(await screen.findByRole('button', { name: '评估 Opportunity' }));
  fireEvent.change(screen.getByRole('textbox', { name: '评估开始时间' }), { target: { value: '2026-10-01T00:00:00Z' } });
  fireEvent.change(screen.getByRole('textbox', { name: '评估结束时间' }), { target: { value: '2026-10-02T00:00:00Z' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '评估规则修订号' }), { target: { value: '2' } });
  await userEvent.click(screen.getByRole('combobox', { name: '评估范围' }));
  await userEvent.click(await screen.findByRole('option', { name: '全部对象（不带实体过滤）' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认执行评估' })).toBeEnabled());
}
describe('管理员评估页面', () => {
  it('ENGINEER route没有评估入口或评估选项请求', async () => {
    const read = mockReads(); renderOpportunities('/geo/opportunities');
    await screen.findByRole('heading', { name: 'GEO 机会工作台' });
    expect(screen.queryByRole('button', { name: '评估 Opportunity' })).not.toBeInTheDocument();
    expect(read.requests.every((item) => item.path === '/api/v1/geo/opportunities')).toBe(true);
  });
  it('明确提交并显示新建/复用/跳过及低样本原因', async () => {
    setup(); const post = vi.spyOn(api, 'POST').mockResolvedValue(response(receipt)); await fill();
    await userEvent.click(screen.getByRole('button', { name: '确认执行评估' }));
    expect(await screen.findByRole('region', { name: '评估冻结回执' })).toHaveTextContent('新建 1 · 复用 1 · 跳过 1');
    expect(screen.getByRole('region', { name: '评估冻结回执' })).toHaveTextContent('有效样本不足');
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/opportunities/evaluate', { body: { scope: 'ALL', rule_set_revision: 2, date_from: '2026-10-01T00:00:00.000Z', collection_modes: ['MANUAL'] }, params: { header: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': expect.any(String) } } }]);
  });
  it.each([403, 409, 422])('HTTP %i显示反馈并保留输入，不自动重发', async (status) => {
    setup(); const post = vi.spyOn(api, 'POST').mockResolvedValue(failure(status)); await fill(); await userEvent.click(screen.getByRole('button', { name: '确认执行评估' }));
    await screen.findByText(/服务端拒绝当前请求/);
    expect(screen.getByRole('textbox', { name: '评估开始时间' })).toHaveValue('2026-10-01T00:00:00Z');
    expect(post).toHaveBeenCalledTimes(1);
    if (status === 403) expect(screen.getByRole('button', { name: '确认执行评估' })).toBeDisabled();
  });
  it('未知5xx只显式恢复同key同payload；进行中不重复提交', async () => {
    setup(); let finish!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(response({ ...receipt, replayed: true }));
    await fill(); await userEvent.click(screen.getByRole('button', { name: '确认执行评估' }));
    expect(screen.getByRole('button', { name: '确认执行评估' })).toBeDisabled();
    await act(async () => finish(failure(503)));
    expect(await screen.findByText(/提交结果未知/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '评估开始时间' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '使用原请求核对评估结果' }));
    await screen.findByText(/原请求回放/);
    expect(post.mock.calls[1]?.[1]).toMatchObject(JSON.parse(JSON.stringify(post.mock.calls[0]?.[1])));
  });
  it('主体切换后迟到回执不进入页面', async () => {
    const { client } = setup(); let finish!: (value: never) => void;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await fill(); await userEvent.click(screen.getByRole('button', { name: '确认执行评估' }));
    invalidatePrincipalEpoch(client, 'engineer'); await act(async () => finish(response(receipt)));
    expect(screen.queryByRole('region', { name: '评估冻结回执' })).not.toBeInTheDocument();
  });
  it('成功HTTP缺失回执视为结果未知，显式恢复仍使用原payload和key', async () => {
    setup();
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce({ response: new Response(null, { status: 204 }) } as never).mockResolvedValue(response({ ...receipt, replayed: true }));
    await fill(); await userEvent.click(screen.getByRole('button', { name: '确认执行评估' }));
    await screen.findByText(/提交结果未知/);
    await userEvent.click(screen.getByRole('button', { name: '使用原请求核对评估结果' }));
    await screen.findByText(/原请求回放/);
    expect(post.mock.calls[1]?.[1]).toMatchObject(JSON.parse(JSON.stringify(post.mock.calls[0]?.[1])));
  });
});
