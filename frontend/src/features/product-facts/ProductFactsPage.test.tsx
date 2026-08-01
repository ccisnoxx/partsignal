/** 验证 Markdown 事实工作区与事实版本删除边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { setCsrfToken } from '../../shared/api/client';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { ProductFactsPage } from './ProductFactsPage';

const productId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const secondVersionId = '20000000-0000-4000-8000-000000000002';
const product = { id: productId, part_number: 'DEMO-001', brand: 'DEMO', category: 'MCU', status: 'ACTIVE', available_actions: ['UPDATE'], revision: 0, facts_revision: 0, created_at: '2026-07-16T00:00:00Z', updated_at: '2026-07-16T00:00:00Z' };
const initialDraft: Schema<'ProductFactsDraft'> = {
  product_id: productId,
  body_markdown: '# 产品事实\n\n初始正文',
  classification: 'PUBLIC',
  available_actions: ['SAVE', 'CREATE_VERSION'],
  revision: 0,
};
let draft = initialDraft;
const factVersion = {
  id: versionId,
  product_id: productId,
  version: 1,
  status: 'DRAFT',
  body_markdown: initialDraft.body_markdown,
  classification: initialDraft.classification,
  change_summary: '测试快照',
  revision: 0,
  created_by: '30000000-0000-4000-8000-000000000001',
  approved_by: null,
  created_at: '2026-07-16T00:00:00Z',
  approved_at: null,
  available_actions: ['SUBMIT', 'DELETE'],
} satisfies Schema<'FactVersion'>;
const secondFactVersion = {
  ...factVersion,
  id: secondVersionId,
  version: 2,
  classification: 'RESTRICTED',
  change_summary: '第二版快照',
} satisfies Schema<'FactVersion'>;
let versions = [factVersion];
let deleteConflict = false;
let deletedIds: string[] = [];
let versionsError = false;
let reviewContexts: Record<string, Schema<'FactReviewContext'>> = {};
let requestedReviewIds: string[] = [];

function renderPage() {
  return render(<ThemeProvider><AntApp><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/products/${productId}`]}><Routes><Route path="/products/:productId" element={<ProductFactsPage />} /></Routes></MemoryRouter></QueryClientProvider></AntApp></ThemeProvider>);
}

beforeEach(() => {
  queryClient.clear();
  versions = [factVersion];
  draft = initialDraft;
  deleteConflict = false;
  deletedIds = [];
  versionsError = false;
  reviewContexts = {};
  requestedReviewIds = [];
  setCsrfToken('x'.repeat(32));
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === `/api/v1/products/${productId}`) return { body: product };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/facts`) return { body: draft };
    if (request.method === 'GET' && path === `/api/v1/products/${productId}/fact-versions`) return versionsError ? { status: 503, body: { error: { message: '版本服务暂不可用' } } } : { body: { items: versions } };
    if (request.method === 'GET' && path.startsWith('/api/v1/fact-versions/') && path.endsWith('/review-context')) {
      const reviewId = path.slice('/api/v1/fact-versions/'.length, -'/review-context'.length);
      requestedReviewIds.push(reviewId);
      const context = reviewContexts[reviewId];
      if (context) return { body: context };
    }
    if (request.method === 'PUT' && path === `/api/v1/products/${productId}/facts`) {
      draft = { ...draft, body_markdown: '# 产品事实\n\n保存后的正文', revision: draft.revision + 1 };
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
  expect(screen.getByRole('button', { name: '创建不可变版本' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '更多操作：事实版本 V1' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  const dialog = await screen.findByRole('dialog', { name: '删除事实版本 V1？' });
  expect(within(dialog).getByText('该版本及其审核记录会一并删除；存在内容任务或内容版本引用时服务端会拒绝。此操作不可恢复。')).toBeInTheDocument();
  expect(within(dialog).queryByText(/物理删除/)).not.toBeInTheDocument();
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
  await screen.findByRole('dialog', { name: '删除事实版本 V1？' });
  await user.click(screen.getAllByRole('button', { name: /删\s*除/ }).at(-1)!);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('内容任务：1');
  expect(alert).toHaveTextContent('内容版本：2');
  expect(screen.getByText('V1')).toBeInTheDocument();
});

test('服务端未投影删除动作时仍保留事实维护、版本和审核入口', async () => {
  const user = userEvent.setup();
  versions = [{ ...factVersion, available_actions: ['SUBMIT'] }];
  renderPage();
  expect(await screen.findByRole('button', { name: '保存事实工作区' })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: /事实版本/ }));
  expect(screen.getByRole('button', { name: '创建不可变版本' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审核与历史' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '更多操作：事实版本 V1' }));
  expect(await screen.findByRole('menuitem', { name: '查看冻结正文' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /删\s*除/ })).not.toBeInTheDocument();
});

test('V2 审核详情只请求并展示 V2 自身历史', async () => {
  const user = userEvent.setup();
  versions = [secondFactVersion, factVersion];
  const actor = {
    id: '30000000-0000-4000-8000-000000000001',
    username: 'reviewer',
    display_name: '审核员',
  };
  reviewContexts = {
    [versionId]: {
      fact_version: factVersion,
      available_actions: ['SUBMIT'],
      review_history: [{
        id: '40000000-0000-4000-8000-000000000001',
        target_id: versionId,
        target_version: 1,
        action: 'submit',
        comment: '仅属于 V1 的事件',
        actor,
        created_at: '2026-07-16T01:00:00Z',
      }],
    },
    [secondVersionId]: {
      fact_version: secondFactVersion,
      available_actions: ['SUBMIT'],
      review_history: [{
        id: '40000000-0000-4000-8000-000000000002',
        target_id: secondVersionId,
        target_version: 2,
        action: 'submit',
        comment: '仅属于 V2 的事件',
        actor,
        created_at: '2026-07-16T02:00:00Z',
      }],
    },
  };

  renderPage();
  await user.click(await screen.findByRole('tab', { name: /事实版本/ }));
  const versionTwoRow = screen.getByText('V2').closest('tr');
  expect(versionTwoRow).not.toBeNull();
  await user.click(within(versionTwoRow!).getByRole('button', { name: '审核与历史' }));

  expect(await screen.findByText('仅属于 V2 的事件')).toBeInTheDocument();
  expect(screen.queryByText('仅属于 V1 的事件')).not.toBeInTheDocument();
  expect(requestedReviewIds).toEqual([secondVersionId]);
});

test('Markdown 工作区显示修改、校验错误和保存成功状态', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText('未修改')).toBeInTheDocument();
  const editor = screen.getByRole('textbox', { name: '事实 Markdown' });
  await user.clear(editor);
  expect(screen.getByText('有未保存修改')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '保存事实工作区' }));
  expect(await screen.findByText('请输入非空事实 Markdown')).toBeInTheDocument();
  await waitFor(() => expect(editor).toHaveFocus());
  await user.type(editor, '# 产品事实\n\n保存后的正文');
  await user.click(screen.getByRole('button', { name: '保存事实工作区' }));
  expect(await screen.findByText('已保存')).toBeInTheDocument();
});

test('加载状态保留唯一页面标题', () => {
  renderPage();
  expect(screen.getByRole('heading', { level: 1, name: '产品事实工作区' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
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

test('未保存事实修改会拦截页签切换和浏览器离开', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(await screen.findByRole('textbox', { name: '事实 Markdown' }), '\n\n未保存内容');
  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);

  await user.click(screen.getByRole('tab', { name: /事实版本/ }));
  const confirm = (await screen.findByText('放弃未保存的事实修改？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  expect(confirm).not.toBeNull();
  await user.click(within(confirm!).getByRole('button', { name: '继续编辑' }));
  expect(screen.getByRole('tab', { name: '事实工作区' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('有未保存修改')).toBeInTheDocument();

  await user.click(screen.getByRole('tab', { name: /事实版本/ }));
  const discard = (await screen.findByText('放弃未保存的事实修改？', { selector: '.ant-modal-confirm-title' })).closest<HTMLElement>('[role="dialog"]');
  await user.click(within(discard!).getByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /事实版本/ })).toHaveAttribute('aria-selected', 'true'));
});
