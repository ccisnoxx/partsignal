/** 验证事实表单状态，以及事实版本更多菜单中的删除权限、刷新和引用错误。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { setCsrfToken } from '../../shared/api/client';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { ProductFactsPage } from './ProductFactsPage';

const authState = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: authState.isAdmin }) }));

const productId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const product = { id: productId, part_number: 'DEMO-001', brand: 'DEMO', category: 'MCU', status: 'ACTIVE', revision: 0, facts_revision: 0, created_at: '2026-07-16T00:00:00Z', updated_at: '2026-07-16T00:00:00Z' };
const snapshot = { reference_parts: [], parameters: [], replacement_relations: [], evidences: [], claims: [] };
const emptyDraft: Schema<'ProductFactsDraft'> = { ...snapshot, product_id: productId, revision: 0 };
let draft = emptyDraft;
const factVersion = { id: versionId, product_id: productId, version: 1, status: 'DRAFT', snapshot, change_summary: '测试快照', revision: 0, created_by: '30000000-0000-4000-8000-000000000001', approved_by: null, created_at: '2026-07-16T00:00:00Z', approved_at: null };
let versions = [factVersion];
let deleteConflict = false;
let deletedIds: string[] = [];
let versionsError = false;

function renderPage() {
  return render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/products/${productId}`]}><Routes><Route path="/products/:productId" element={<ProductFactsPage />} /></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>);
}

beforeEach(() => {
  queryClient.clear();
  authState.isAdmin = true;
  versions = [factVersion];
  draft = emptyDraft;
  deleteConflict = false;
  deletedIds = [];
  versionsError = false;
  setCsrfToken('x'.repeat(32));
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === `/api/v1/products/${productId}`) return { body: product };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/facts`) return { body: draft };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/fact-versions`) return versionsError ? { status: 503, body: { error: { message: '版本服务暂不可用' } } } : { body: { items: versions } };
    if (request.method === 'PUT' && path === `/api/v1/products/${productId}/facts`) {
      draft = { ...draft, revision: draft.revision + 1, reference_parts: [{ client_key: 'reference-1', part_number: 'REF-001', manufacturer: 'DEMO', category: 'MCU' }] };
      return { body: draft };
    }
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
  await user.click(screen.getByRole('button', { name: '更多操作：事实版本 V1' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  await screen.findByRole('dialog', { name: '物理删除事实版本 V1？' });
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
  await user.click(screen.getByRole('button', { name: '更多操作：事实版本 V1' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  await screen.findByRole('dialog', { name: '物理删除事实版本 V1？' });
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
  await user.click(screen.getByRole('button', { name: '更多操作：事实版本 V1' }));
  expect(await screen.findByRole('menuitem', { name: '查看快照' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /删\s*除/ })).not.toBeInTheDocument();
});

test('事实表单显示修改、校验错误和保存成功状态', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText('未修改')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /添加参考型号/ }));
  expect(screen.getByText('参考型号 1')).toBeInTheDocument();
  expect(screen.getByText('有未保存修改')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /参考型号有修改/ })).toHaveClass('is-dirty');

  await user.click(screen.getByRole('button', { name: '保存事实工作区' }));
  expect(await screen.findByText('有 4 个字段需要修正')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /参考型号有错误/ })).toHaveClass('is-error');
  expect(screen.getByRole('button', { name: '定位首个错误' })).toBeInTheDocument();

  await user.type(screen.getByRole('textbox', { name: '本地标识' }), 'reference-1');
  await user.type(screen.getByRole('textbox', { name: '参考型号' }), 'REF-001');
  await user.type(screen.getByRole('textbox', { name: '制造商' }), 'DEMO');
  await user.type(screen.getByRole('textbox', { name: '类别' }), 'MCU');
  await user.click(screen.getByRole('button', { name: '保存事实工作区' }));
  expect(await screen.findByText('已保存')).toBeInTheDocument();
  expect(screen.queryByText(/有 \d+ 个字段需要修正/)).not.toBeInTheDocument();
});

test('事实版本查询失败只影响版本页签', async () => {
  const user = userEvent.setup();
  versionsError = true;
  renderPage();
  expect(await screen.findByRole('button', { name: '保存事实工作区' })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: /事实版本/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('版本服务暂不可用');
  expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '事实工作区' }));
  expect(screen.getByRole('button', { name: '保存事实工作区' })).toBeInTheDocument();
});
