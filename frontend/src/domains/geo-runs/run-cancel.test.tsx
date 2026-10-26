import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializePrincipalEpoch, invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { context, failure, response, runId } from './manual.test-support';
import { detail, run } from './runs.test-support';
import { RunCancel } from './run-cancel';
import { RunRequestError } from './runs.api';
import type { Cancellation } from './run-cancel.api';

const result: Cancellation = { run_id: runId, cancelled_by: runId, cancelled_at: '2026-10-25T08:00:00Z', reason: '本次无法完成', run_revision: 3, draft_revision: 3 };
function initial(): components['schemas']['GeoRunDetail'] {
  return { ...detail(), cancellation: null, run: run({ revision: 2, available_actions: ['ENTER_MANUAL_OBSERVATION', 'CANCEL'] }) };
}
afterEach(() => vi.restoreAllMocks());
function setup(value = initial(), readError?: unknown) {
  let current = context({ available_actions: ['ENTER_MANUAL_OBSERVATION', 'CANCEL'] });
  let reading = value;
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/observation-runs/{run_id}/manual-entry') return response(current);
    if (path === '/api/v1/geo/observation-runs/{run_id}') return response(reading);
    throw new Error(`未声明GET ${path}`);
  });
  const client = createAppQueryClient(); initializePrincipalEpoch(client, 'engineer');
  const tree = createRootRoute({ component: () => <RunCancel detail={value} csrfToken="csrf" blocked={Boolean(readError)} readError={readError} /> });
  const router = createRouter({ routeTree: tree, history: createMemoryHistory() });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, view, get, setContext: (v: typeof current) => { current = v; }, setRead: (v: typeof reading) => { reading = v; } };
}
async function open() {
  await userEvent.click(await screen.findByRole('button', { name: '取消未提交人工运行' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '取消原因' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: '取消原因' }), { target: { value: result.reason } });
  await waitFor(() => expect(screen.getByRole('button', { name: '确认取消本次人工运行' })).toBeEnabled());
}
describe('未提交人工运行取消', () => {
  it('详情访问被拒绝时隐藏缓存中的取消原因', async () => {
    setup({ ...initial(), cancellation: result }, new RunRequestError('访问被拒绝', 403));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号不能继续读取');
    expect(screen.queryByRole('region', { name: '人工取消记录，只读' })).not.toBeInTheDocument();
    expect(screen.queryByText(result.reason)).not.toBeInTheDocument();
  });

  it('仅随服务端动作展示入口，无动作不发准备请求', async () => {
    const value = initial(); value.run.available_actions = ['ENTER_MANUAL_OBSERVATION'];
    const { get } = setup(value);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: '取消未提交人工运行' })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
  it('先读双版本、填写原因再显式POST，显示不可变留痕', async () => {
    setup(); const post = vi.spyOn(api, 'POST').mockResolvedValue(response(result));
    await open(); expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    const record = await screen.findByRole('region', { name: '人工取消记录，只读' });
    expect(record).toHaveTextContent(result.reason);
    expect(record).toHaveTextContent('取消不删除草稿或文件引用');
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/observation-runs/{run_id}/manual-cancel', { body: { expected_revision: 2, expected_draft_revision: 3, reason: result.reason }, params: { path: { run_id: runId }, header: { 'X-CSRF-Token': 'csrf' } } }]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '取消未提交人工运行' })).not.toBeInTheDocument();
  });
  it('草稿409保留原因，必须显式读新草稿版本后才可提交', async () => {
    const { setContext } = setup(); const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure('REVISION_CONFLICT', 409)).mockResolvedValue(response({ ...result, draft_revision: 4 }));
    await open(); await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    await screen.findByText(/资格或版本已变化/);
    expect(screen.getByRole('button', { name: '确认取消本次人工运行' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '取消原因' })).toHaveValue(result.reason);
    setContext(context({ draft_revision: 4, available_actions: ['CANCEL'] }));
    await userEvent.click(screen.getByRole('button', { name: '重读取消条件并保留原因' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认取消本次人工运行' })).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    await screen.findByRole('region', { name: '人工取消记录，只读' });
    expect(post.mock.calls[1]).toMatchObject(['/api/v1/geo/observation-runs/{run_id}/manual-cancel', { body: { expected_draft_revision: 4, reason: result.reason } }]);
  });
  it('双击只发一次；5xx后只能GET核对实际取消记录', async () => {
    const { setRead } = setup(); let finish!: (v: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open(); await userEvent.dblClick(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => finish(failure('INTERNAL_ERROR', 503)));
    await screen.findByText(/提交结果未知，仅重读/);
    expect(screen.getByRole('textbox', { name: '取消原因' })).toBeDisabled();
    setRead({ ...initial(), cancellation: result });
    await userEvent.click(screen.getByRole('button', { name: '重读运行核对取消结果' }));
    await screen.findByRole('region', { name: '人工取消记录，只读' });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('未知回执GET未见记录时仍不能重发，结束核对须重新准备', async () => {
    setup(); const post = vi.spyOn(api, 'POST').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    await open(); await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    await screen.findByText(/提交结果未知，仅重读/);
    await userEvent.click(screen.getByRole('button', { name: '重读运行核对取消结果' }));
    await userEvent.click(await screen.findByRole('button', { name: '结束核对并保留原因' }));
    expect(screen.getByRole('button', { name: '确认取消本次人工运行' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '取消原因' })).toHaveValue(result.reason);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('已接受后的读取失败保留接受事实，不重新出现取消入口', async () => {
    const { client } = setup(); vi.spyOn(api, 'POST').mockResolvedValue(response(result));
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('虚构刷新失败'));
    await open(); await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    await screen.findByText(/取消已接受，后续刷新失败/);
    expect(screen.getByRole('region', { name: '人工取消记录，只读' })).toHaveTextContent(result.reason);
    expect(screen.queryByRole('button', { name: '取消未提交人工运行' })).not.toBeInTheDocument();
  });
  it('主体切换后迟到成功不能显示原主体记录', async () => {
    const { client } = setup(); let finish!: (v: never) => void;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open(); await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    invalidatePrincipalEpoch(client, 'other'); await act(async () => finish(response(result)));
    expect(screen.queryByRole('region', { name: '人工取消记录，只读' })).not.toBeInTheDocument();
  });
  it('卸载取消请求，迟到成功不失效新页面缓存', async () => {
    const { client, view } = setup(); let finish!: (v: never) => void;
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open(); await userEvent.click(screen.getByRole('button', { name: '确认取消本次人工运行' }));
    const signal = (post.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => finish(response(result)));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
