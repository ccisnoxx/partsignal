import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { surfaceListQueryOptions } from './surfaces.api';
import { openAction, renderSurfaces, response, surfaceFixture, surfaceId } from './surfaces.test-support';

beforeAll(() => Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) }));
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('GEO 配置提交后的关联读取', () => {
  it.each(['enable', 'delete'] as const)('%s 完成后取消无缓存筛选的首次 GET，迟到的旧快照不能恢复旧行', async (command) => {
    const original = surfaceFixture();
    const canonical = surfaceFixture({ summary: { ...original.summary, revision: 5, is_active: true }, workflow_stage: 'ACTIVE', available_actions: ['UPDATE', 'DISABLE', 'DELETE'] });
    const oldRead = deferred<never>();
    const write = deferred<never>();
    let reads = 0;
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/geo/engine-surfaces/{surface_id}') return response(original);
      if (path !== '/api/v1/geo/engine-surfaces') throw new Error(`未声明请求：${path}`);
      const query = (options as unknown as { params?: { query?: { q?: string } }; signal?: AbortSignal });
      if (query.params?.query?.q !== '首次筛选') return response({ items: [original], page: 1, page_size: 20, total: 1 });
      reads += 1;
      if (reads === 1) { oldSignal = query.signal; return oldRead.promise; }
      return response({ items: command === 'delete' ? [] : [canonical], page: 1, page_size: 20, total: command === 'delete' ? 0 : 1 });
    });
    const mutate = command === 'delete' ? vi.spyOn(api, 'DELETE').mockImplementation(() => write.promise) : vi.spyOn(api, 'POST').mockImplementation(() => write.promise);
    const { router, queryClient } = renderSurfaces();
    const driver = await openAction(command === 'delete' ? '删除观测面' : '启用观测面');
    await driver.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    const search = { surface_id: surfaceId, q: '首次筛选' };
    await act(() => router.navigate({ to: '/configuration/geo-surfaces', search }));
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => write.resolve(command === 'delete' ? { response: new Response(null, { status: 204 }) } as never : response(canonical)));
    await waitFor(() => expect(reads).toBe(2));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => oldRead.resolve(response({ items: [original], page: 1, page_size: 20, total: 1 })));
    const list = queryClient.getQueryData(surfaceListQueryOptions(search).queryKey);
    expect(list?.items.map((item) => item.summary.revision)).toEqual(command === 'delete' ? [] : [5]);
    expect(queryClient.getQueryState(surfaceListQueryOptions(search).queryKey)?.isInvalidated).toBe(false);
    if (command === 'delete') expect(screen.queryByRole('link', { name: original.summary.name })).not.toBeInTheDocument();
  });
});
