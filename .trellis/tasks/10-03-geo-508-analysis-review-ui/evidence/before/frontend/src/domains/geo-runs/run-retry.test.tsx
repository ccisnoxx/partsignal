import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import { RunRetry } from './run-retry';
import { detail, runId, batchId, asOf } from './runs.test-support';
const nextId = '10000000-0000-4000-8000-000000000003';
function setup(offered = true) {
  const value = detail();
  value.run = { ...value.run, status: 'FAILED', revision: 7, error_stage: 'COLLECTION', available_actions: offered ? ['RETRY'] : [] };
  const client = createAppQueryClient();
  const created = vi.fn();
  const view = render(<QueryClientProvider client={client}><RunRetry blocked={false} csrfToken="csrf" detail={value} onCreated={created} /></QueryClientProvider>);
  return { ...view, client, created, value };
}
async function confirm() {
  await userEvent.click(screen.getByRole('button', { name: '创建新采集尝试' }));
  await userEvent.click(screen.getByRole('button', { name: '确认创建新尝试' }));
}
function receipt() {
  const data = { run_id: nextId, batch_id: batchId, previous_attempt_id: runId, attempt_no: 2, created_at: asOf };
  return { data, response: Response.json(data, { status: 201 }) } as never;
}
afterEach(() => vi.restoreAllMocks());
describe('显式新attempt命令', () => {
  it('相同FAILED状态没有服务端RETRY时无入口', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: '创建新采集尝试' })).not.toBeInTheDocument();
  });
  it('先确认影响，单次POST绑定revision并导航稳定新身份', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue(receipt());
    const { created } = setup();
    await userEvent.click(screen.getByRole('button', { name: '创建新采集尝试' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('外部调用及费用');
    await userEvent.click(screen.getByRole('button', { name: '确认创建新尝试' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(nextId));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: { expected_revision: 7 } }));
  });
  it('网络丢回执只GET尝试链，尚无后继不解除unknown；读到后继可恢复', async () => {
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('网络中断'));
    const { value, created } = setup();
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => ({ data: value, response: Response.json(value) }) as never);
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('结果未知');
    await userEvent.click(screen.getByRole('button', { name: '读取最新尝试链' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('尚无已确认后继');
    expect(screen.getByRole('button', { name: '确认创建新尝试' })).toBeDisabled();
    value.attempts.push({ ...value.attempts[0]!, id: nextId, attempt_no: 2, previous_attempt_id: runId, status: 'PENDING' });
    await userEvent.click(screen.getByRole('button', { name: '读取最新尝试链' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(nextId));
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('409展示请求ID并阻止重放，显式读取新revision后仍需用户确认', async () => {
    const error = { error: { code: 'REVISION_CONFLICT', message: '修订冲突', request_id: 'geo408-request', details: {} } };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ error, response: Response.json(error, { status: 409 }) } as never);
    const { value } = setup();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('geo408-request');
    expect(screen.getByRole('button', { name: '确认创建新尝试' })).toBeDisabled();
    vi.spyOn(api, 'GET').mockResolvedValue({ data: value, response: Response.json(value) } as never);
    await userEvent.click(screen.getByRole('button', { name: '读取最新尝试链' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建新尝试' })).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['pending', 'close'], ['pending', 'switch'], ['unknown', 'close'], ['unknown', 'switch'],
  ])('%s 命令在详情 %s 后仍阻断 POST，只能 GET 收敛', async (phase, boundary) => {
    let reject!: (reason: Error) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { value, client, created, unmount } = setup();
    const get = vi.spyOn(api, 'GET').mockImplementation(async () => ({ data: value, response: Response.json(value) }) as never);
    await confirm();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    if (phase === 'unknown') await act(async () => reject(new TypeError('网络中断')));
    unmount();
    if (boundary === 'switch') {
      const other = { ...value, run: { ...value.run, id: nextId } };
      const switched = render(<QueryClientProvider client={client}><RunRetry blocked={false} csrfToken="csrf" detail={other} onCreated={created} /></QueryClientProvider>);
      expect(screen.getByRole('button', { name: '创建新采集尝试' })).toBeEnabled();
      switched.unmount();
    }
    render(<QueryClientProvider client={client}><RunRetry blocked={false} csrfToken="csrf" detail={value} onCreated={created} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: '查看新尝试创建结果' }));
    expect(screen.getByRole('button', { name: phase === 'pending' ? '处理中…' : '确认创建新尝试' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '读取最新尝试链' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('尚无已确认后继');
    expect(post).toHaveBeenCalledTimes(1);
    if (phase === 'pending') await act(async () => reject(new TypeError('网络中断')));
    value.attempts.push({ ...value.attempts[0]!, id: nextId, attempt_no: 2, previous_attempt_id: runId, status: 'PENDING' });
    await userEvent.click(screen.getByRole('button', { name: '读取最新尝试链' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(nextId));
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it.each(['unmount', 'principal'])('迟到回执在%s后不导航', async (boundary) => {
    let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { client, created, unmount } = setup();
    await confirm();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    if (boundary === 'unmount') unmount(); else invalidatePrincipalEpoch(client);
    await act(async () => release(receipt()));
    expect(created).not.toHaveBeenCalled();
  });
});
