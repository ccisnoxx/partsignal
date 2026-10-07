import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { plan, response, failure } from '@/domains/geo-plans/plans.test-support';
import { BatchCreate } from './batch-create';
const receipt = {
  batch_id: '10000000-0000-4000-8000-000000000009',
  requested_run_count: 3,
  created_at: '2026-10-02T08:00:00Z',
};
function setup() {
  const client = createAppQueryClient();
  const created = vi.fn();
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/geo/runs',
    component: () => <BatchCreate csrfToken="csrf" onClose={vi.fn()} onCreated={created} />,
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
  return { client, created };
}
afterEach(() => vi.restoreAllMocks());
async function select() {
  await userEvent.click(await screen.findByRole('button', { name: /原始监测计划 · Revision 7/ }));
}
describe('批次创建的快照与幂等身份', () => {
  it('未知结果保留原计划修订和同键，显式重试后采用canonical batch ID', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [plan()], total: 1, page: 1, page_size: 20 }));
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new TypeError('网络断开'))
      .mockResolvedValueOnce(response(receipt));
    const { created } = setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认原批次创建结果' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id));
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ body: { expected_revision: 7 } });
  });
  it('冲突保留选择且停止写入，显式重新读取后使用新修订', async () => {
    const get = vi
      .spyOn(api, 'GET')
      .mockImplementation(async (path) =>
        path === '/api/v1/geo/monitoring-plans/{plan_id}'
          ? response(plan({ revision: 8 }))
          : response({ items: [plan()], total: 1, page: 1, page_size: 20 }),
      );
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure()).mockResolvedValueOnce(response(receipt));
    setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    const reload = await screen.findByRole('button', { name: '重新读取计划并确认' });
    expect(screen.getByRole('button', { name: '确认创建批次' })).toBeDisabled();
    await userEvent.click(reload);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/geo/monitoring-plans/{plan_id}', expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { expected_revision: 8 } });
  });
  it('畸形成功回执不丢幂等键、不宣告创建成功；同键恢复可信回执', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [plan()], total: 1, page: 1, page_size: 20 }));
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
    await waitFor(() => expect(created).toHaveBeenCalledWith(receipt.batch_id));
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  });
  it('旧主体未知请求不得作为新主体重新创建', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [plan()], total: 1, page: 1, page_size: 20 }));
    const post = vi.spyOn(api, 'POST').mockRejectedValue(new TypeError('网络断开'));
    const { client } = setup();
    await select();
    await userEvent.click(screen.getByRole('button', { name: '确认创建批次' }));
    const retry = await screen.findByRole('button', { name: '确认原批次创建结果' });
    invalidatePrincipalEpoch(client);
    await userEvent.click(retry);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
