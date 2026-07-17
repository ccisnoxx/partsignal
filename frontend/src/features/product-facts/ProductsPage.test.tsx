/** 验证产品搜索与分页由 URL 恢复，并能随浏览器历史同步。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import type { Product } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { ProductsPage } from './ProductsPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: false }) }));

const products = Array.from({ length: 21 }, (_, index) => ({
  id: `product-${index + 1}`,
  part_number: `DEMO-${String(index + 1).padStart(3, '0')}`,
  brand: 'DEMO',
  category: 'MCU',
  status: 'ACTIVE',
  revision: 0,
  facts_revision: 0,
  created_at: '2026-07-17T00:00:00Z',
  updated_at: '2026-07-17T00:00:00Z',
})) as Product[];

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="当前查询参数">{location.search}</output><button onClick={() => navigate(-1)}>后退</button></>;
}

function renderPage(entry: string) {
  return render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[entry]}><Routes><Route path="/products" element={<><ProductsPage /><LocationProbe /></>} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);
}

beforeEach(() => {
  queryClient.clear();
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/products') {
      const items = url.searchParams.get('search') === 'ALT' ? [{ ...products[0]!, part_number: 'ALT-001' }] : products;
      return { body: { items, page: 1, page_size: 100, total: items.length } };
    }
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });
});

afterEach(() => vi.restoreAllMocks());

test('从 URL 恢复搜索和分页，并通过历史返回先前视图', async () => {
  const user = userEvent.setup();
  renderPage('/products?q=DEMO&page=2');
  expect(await screen.findByText('DEMO-021')).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('DEMO');
  expect(screen.getByLabelText('当前查询参数')).toHaveTextContent('?q=DEMO&page=2');

  const search = screen.getByRole('searchbox', { name: '搜索产品' });
  await user.clear(search);
  await user.type(search, 'ALT{Enter}');
  expect(await screen.findByText('ALT-001')).toBeInTheDocument();
  expect(screen.getByLabelText('当前查询参数')).toHaveTextContent('?q=ALT');

  await user.click(screen.getByRole('button', { name: '后退' }));
  expect(await screen.findByText('DEMO-021')).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: '搜索产品' })).toHaveValue('DEMO');
});

test('无效页码在数据加载后替换为默认视图', async () => {
  renderPage('/products?page=0');
  await screen.findByText('DEMO-001');
  await waitFor(() => expect(screen.getByLabelText('当前查询参数')).toHaveTextContent(''));
});
