/** 验证事实版本物理删除权限、刷新和结构化引用错误。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { setCsrfToken } from '../../shared/api/client';
import { mockFetch } from '../../test/fetchMock';
import { ProductFactsPage } from './ProductFactsPage';

const authState = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: authState.isAdmin }) }));

const productId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const product = { id: productId, part_number: 'DEMO-001', brand: 'DEMO', category: 'MCU', status: 'ACTIVE', revision: 0, facts_revision: 0, created_at: '2026-07-16T00:00:00Z', updated_at: '2026-07-16T00:00:00Z' };
const snapshot = { reference_parts: [], parameters: [], replacement_relations: [], evidences: [], claims: [] };
const draft = { ...snapshot, product_id: productId, revision: 0 };
const factVersion = { id: versionId, product_id: productId, version: 1, status: 'DRAFT', snapshot, change_summary: '测试快照', revision: 0, created_by: '30000000-0000-4000-8000-000000000001', approved_by: null, created_at: '2026-07-16T00:00:00Z', approved_at: null };
let versions = [factVersion];
let deleteConflict = false;
let deletedIds: string[] = [];

function renderPage() {
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/products/${productId}`]}><Routes><Route path="/products/:productId" element={<ProductFactsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  queryClient.clear();
  authState.isAdmin = true;
  versions = [factVersion];
  deleteConflict = false;
  deletedIds = [];
  setCsrfToken('x'.repeat(32));
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === `/api/v1/products/${productId}`) return { body: product };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/facts`) return { body: draft };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/fact-versions`) return { body: { items: versions } };
    if (request.method === 'DELETE' && path === `/api/v1/fact-versions/${versionId}`) {
      if (deleteConflict) return { status: 409, body: { error: { code: 'FACT_VERSION_IN_USE', message: '事实版本仍被引用', request_id: 'req-delete', details: { references: [{ type: 'CONTENT_TASK', count: 1 }, { type: 'CONTENT_VERSION', count: 2 }] } } } };
      deletedIds.push(versionId);
      versions = [];
      return { status: 200, body: null };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
});

afterEach(() => {
  setCsrfToken(null);
  vi.restoreAllMocks();
});

test('管理员删除事实版本后只刷新当前产品版本列表', async () => {
  const user = userEvent.setup();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  renderPage();
  await user.click(await screen.findByRole('tab', { name: /事实版本/ }));
  expect(screen.getByRole('button', { name: '创建不可变快照' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /删\s*除/ }));
  await screen.findByText('物理删除事实版本 V1？');
  await user.click(screen.getAllByRole('button', { name: /删\s*除/ }).at(-1)!);
  await waitFor(() => expect(deletedIds).toEqual([versionId]));
  await waitFor(() => expect(screen.getByRole('tab', { name: '事实版本（0）' })).toBeInTheDocument());
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['fact-versions', productId] });
});

test('事实版本双引用冲突复用结构化中文错误展示', async () => {
  const user = userEvent.setup();
  deleteConflict = true;
  renderPage();
  await user.click(await screen.findByRole('tab', { name: /事实版本/ }));
  await user.click(screen.getByRole('button', { name: /删\s*除/ }));
  await screen.findByText('物理删除事实版本 V1？');
  await user.click(screen.getAllByRole('button', { name: /删\s*除/ }).at(-1)!);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('内容任务：1');
  expect(alert).toHaveTextContent('内容版本：2');
  expect(screen.getByText('V1')).toBeInTheDocument();
});

test('工程师看不到删除按钮但保留事实维护、快照和审核入口', async () => {
  const user = userEvent.setup();
  authState.isAdmin = false;
  renderPage();
  expect(await screen.findByRole('button', { name: '保存事实工作区' })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: /事实版本/ }));
  expect(screen.getByRole('button', { name: '创建不可变快照' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审核证据与历史' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /删\s*除/ })).not.toBeInTheDocument();
});
