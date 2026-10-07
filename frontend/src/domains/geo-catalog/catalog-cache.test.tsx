import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { catalogKeys } from './catalog.api';
import { CatalogPage } from './catalog-page';
import { catalogSearchSchema, type CatalogSearch } from './catalog.model';
import { catalogFailure, catalogResponse, catalogSubject, openCatalogAction, renderCatalog, subjectId } from './catalog.test-support';

afterEach(() => vi.restoreAllMocks());
describe('Catalog 写后缓存与删除生命周期', () => {
  it('写成功后读取新列表，首个无缓存旧 GET 迟到不能回填旧 revision', async () => {
    const old = catalogSubject();
    let current = old;
    let listReads = 0;
    let release!: (value: never) => void;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/geo/subjects') {
        listReads += 1;
        if (listReads === 1) return new Promise<never>((resolve) => { release = resolve; });
        return catalogResponse({ items: [current], page: 1, page_size: 20, total: 1 });
      }
      if (path === '/api/v1/geo/subjects/{subject_id}') return catalogResponse(current);
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    vi.spyOn(api, 'POST').mockImplementation(async () => {
      current = catalogSubject({ revision: 8, display_name: '写后规范对象', is_active: false, workflow_stage: 'DISABLED', primary_task: 'ENABLE_SUBJECT' });
      return catalogResponse(current);
    });
    const { queryClient } = renderCatalog();
    const driver = await openCatalogAction('停用对象');
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await screen.findByText('停用对象已完成。');
    await act(async () => { release(catalogResponse({ items: [old], page: 1, page_size: 20, total: 1 })); });
    await waitFor(() => expect(within(screen.getByRole('region', { name: '监测对象列表' })).getByRole('link', { name: '写后规范对象' })).toBeVisible());
    expect(listReads).toBe(2);
    expect(queryClient.getQueriesData<components['schemas']['GeoSubjectListPage']>({ queryKey: catalogKeys.lists() })[0]?.[1]?.items[0]?.revision).toBe(8);
  });

  it('删除成功先隐藏旧列表行，URL 清理等待时父重绘不重读详情', async () => {
    const current = catalogSubject({ available_actions: ['DELETE'], deletion: { blockers: [] } });
    let removed = false;
    let detailReads = 0;
    let releaseList!: (value: never) => void;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/geo/subjects') return removed ? new Promise<never>((resolve) => { releaseList = resolve; }) : catalogResponse({ items: [current], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/geo/subjects/{subject_id}') { detailReads += 1; return removed ? catalogFailure('NOT_FOUND', 404) : catalogResponse(current); }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    vi.spyOn(api, 'DELETE').mockImplementation(async () => { removed = true; return { response: new Response(null, { status: 204 }) } as never; });
    const client = createAppQueryClient();
    let setSearch!: (search: CatalogSearch) => void;
    let redraw!: () => void;
    const navigate = vi.fn();
    function Page() {
      const [search, update] = useState(catalogSearchSchema.parse({ subject_id: subjectId }));
      const [generation, setGeneration] = useState(0);
      setSearch = update; redraw = () => setGeneration((value) => value + 1);
      return <div data-generation={generation}><CatalogPage search={search} csrfToken="catalog-csrf" isAdmin onSearchChange={navigate} onConsumersChanged={async () => {}} /></div>;
    }
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/configuration/geo-entities', component: Page });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/configuration/geo-entities'] }) });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    await screen.findByRole('link', { name: current.display_name });
    const driver = await openCatalogAction('删除对象');
    await driver.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect.soft(screen.queryByRole('link', { name: current.display_name })).not.toBeInTheDocument();
    await act(async () => { redraw(); });
    expect(detailReads).toBe(1);
    expect(screen.queryByText(/NOT_FOUND/)).not.toBeInTheDocument();
    await act(async () => { setSearch(navigate.mock.calls[0]![0]); releaseList(catalogResponse({ items: [], total: 0, page: 1, page_size: 20 })); });
    await screen.findByText('暂无监测对象');
    expect(screen.queryByRole('region', { name: '监测对象详情' })).not.toBeInTheDocument();
    expect(detailReads).toBe(1);
  });
});
