import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockCatalogReads, productId, renderCatalog, subjectId } from './catalog.test-support';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) });
});
afterEach(() => vi.restoreAllMocks());

describe('Catalog generated 文件路由', () => {
  it('非规范 URL 在 loader 前 replace，默认值及非法值不保留在地址中', async () => {
    const get = mockCatalogReads();
    const { router } = renderCatalog(`/configuration/geo-entities?page=1&page_size=20&sort=NAME_ASC&subject_type=INVALID&subject_id=${subjectId.toUpperCase()}&product_id=invalid&unknown=1`);
    await screen.findByRole('heading', { name: '监测对象与竞品' });
    await waitFor(() => expect(router.state.location.search).toEqual({ subject_id: subjectId }));
    expect(router.history.length).toBe(1);
    expect(get).toHaveBeenCalledWith('/api/v1/geo/subjects', expect.objectContaining({ params: { query: { page: 1, page_size: 20, sort: 'NAME_ASC' } } }));
    expect(get).toHaveBeenCalledWith('/api/v1/geo/subjects/{subject_id}', expect.objectContaining({ params: { path: { subject_id: subjectId } } }));
  });

  it('筛选 URL 驱动 API 参数，Back 恢复 false、分页与选中对象', async () => {
    const get = mockCatalogReads();
    const { router } = renderCatalog(`/configuration/geo-entities?subject_id=${subjectId}&q=PS&subject_type=OWN_PRODUCT&is_active=false&sort=UPDATED_DESC&page=2&page_size=10&product_id=${productId}`);
    await screen.findByRole('heading', { name: '监测对象与竞品' });
    expect(get).toHaveBeenCalledWith('/api/v1/geo/subjects', expect.objectContaining({ params: { query: { q: 'PS', subject_type: 'OWN_PRODUCT', is_active: false, sort: 'UPDATED_DESC', page: 2, page_size: 10, product_id: productId } } }));
    await act(() => router.navigate({ to: '/configuration/geo-entities', search: { q: 'other' } }));
    expect(router.state.location.search.subject_id).toBeUndefined();
    await act(async () => { router.history.back(); });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ subject_id: subjectId, q: 'PS', is_active: false, page: 2, page_size: 10, product_id: productId }));
    expect(await screen.findByRole('region', { name: '监测对象详情' })).toBeVisible();
  });
});
