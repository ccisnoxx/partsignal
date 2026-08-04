/** 验证产品搜索与分页由 URL 恢复，并能随浏览器历史同步。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { setCsrfToken } from '../../shared/api/client';
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
  workflow_stage: 'FACTS_EMPTY',
  primary_task: 'ENTER_FACTS',
  available_actions: index === 0 ? ['UPDATE', 'DELETE'] : ['UPDATE'],
  deletion: index === 0 ? { blockers: [] } : null,
  revision: 0,
  facts_revision: 0,
  created_at: '2026-07-17T00:00:00Z',
  updated_at: '2026-07-17T00:00:00Z',
})) as Product[];
let createFailure = false;

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
  createFailure = false;
  setCsrfToken('x'.repeat(32));
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/products') {
      const items = url.searchParams.get('search') === 'ALT' ? [{ ...products[0]!, part_number: 'ALT-001' }] : products;
      return { body: { items, page: 1, page_size: 100, total: items.length } };
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/products') {
      return createFailure ? { status: 503, body: { error: { message: '产品服务暂不可用' } } } : { body: products[0] };
    }
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });
});

afterEach(() => {
  setCsrfToken(null);
  vi.restoreAllMocks();
});

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

test('产品删除确认说明工作区范围和引用阻断', async () => {
  const user = userEvent.setup();
  renderPage('/products');
  await user.click(await screen.findByRole('button', { name: '更多操作：DEMO-001' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  const dialog = await screen.findByRole('dialog', { name: '删除产品“DEMO-001”？' });
  expect(within(dialog).getByText('将删除产品及当前事实工作区；如果仍有事实版本、内容任务或 GEO 观测引用，服务端会拒绝。此操作不可恢复。')).toBeInTheDocument();
  expect(within(dialog).queryByText(/物理删除/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
});

test('产品被引用时展示删除条件并下钻任务与不可变观测历史', async () => {
  const user = userEvent.setup();
  const blocked = {
    ...products[1]!,
    deletion: { blockers: [
      { type: 'CONTENT_TASK' as const, count: 2 },
      { type: 'GEO_OBSERVATION' as const, count: 3 },
    ] },
  };
  mockFetch((request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/products') return { body: { items: [blocked], page: 1, page_size: 100, total: 1 } };
    throw new Error(`未声明测试请求：${request.method} ${url.pathname}`);
  });

  renderPage('/products');
  await user.click(await screen.findByRole('button', { name: '更多操作：DEMO-002' }));
  await user.click(screen.getByRole('menuitem', { name: '查看删除条件' }));
  expect(screen.getByText('内容任务：2')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看引用' })).toHaveAttribute('href', `/tasks?filter_product_id=${blocked.id}`);
  expect(screen.getByRole('link', { name: '查看历史' })).toHaveAttribute('href', `/observations?product_id=${blocked.id}&all_time=true`);
});

test('创建产品先聚焦首个错误，并在关闭前保护未保存输入', async () => {
  const user = userEvent.setup();
  renderPage('/products');
  await user.click(await screen.findByRole('button', { name: /新增产品/ }));
  expect(document.querySelector('.products-create-dialog')).toBeInTheDocument();
  const partNumber = screen.getByRole('textbox', { name: '产品型号' });
  await user.click(screen.getByRole('button', { name: '创建事实工作区' }));
  await waitFor(() => expect(partNumber).toHaveFocus());

  await user.type(partNumber, 'PS-NEW');
  await user.click(screen.getByRole('button', { name: /取\s*消/ }));
  const confirm = (await screen.findByText('放弃未保存的产品信息？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  expect(confirm).not.toBeNull();
  await user.click(within(confirm!).getByRole('button', { name: '继续编辑' }));
  expect(partNumber).toHaveValue('PS-NEW');
  await waitFor(() => expect(confirm).not.toBeInTheDocument());

  await user.click(screen.getByRole('button', { name: /取\s*消/ }));
  const discard = (await screen.findByText('放弃未保存的产品信息？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  await user.click(within(discard!).getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增产品' })).not.toBeInTheDocument());
});

test('创建失败时保留输入并把焦点移到服务端错误', async () => {
  const user = userEvent.setup();
  createFailure = true;
  renderPage('/products');
  await user.click(await screen.findByRole('button', { name: /新增产品/ }));
  await user.type(screen.getByRole('textbox', { name: '产品型号' }), 'PS-ERROR');
  await user.type(screen.getByRole('textbox', { name: '品牌' }), 'PartSignal');
  await user.type(screen.getByRole('textbox', { name: '类别' }), 'MCU');
  await user.click(screen.getByRole('button', { name: '创建事实工作区' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('产品服务暂不可用');
  expect(alert.parentElement).toHaveFocus();
  expect(screen.getByRole('textbox', { name: '产品型号' })).toHaveValue('PS-ERROR');
});
