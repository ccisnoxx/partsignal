import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { geoKeys } from './geo.api';
import { NewGeoObservationPage } from './new-geo-observation-page';

const ids = vi.hoisted(() => ({ product: '10000000-0000-4000-8000-000000000001', topic: '20000000-0000-4000-8000-000000000001', article: '30000000-0000-4000-8000-000000000001' }));
vi.mock('@/design-system/forms/dirty-guard', () => ({ DirtyGuard: ({ when }: { when: boolean }) => <span data-testid="dirty">{String(when)}</span> }));
vi.mock('./new-geo-observation.model', async (importOriginal) => {
  const original = await importOriginal<typeof import('./new-geo-observation.model')>();
  return { ...original, emptyGeoObservationValues: () => ({ ...original.emptyGeoObservationValues(), product_id: ids.product, query_topic_id: ids.topic, search_platform: 'DeepSeek', search_query: '实际问题', article_results: [{ published_article_id: ids.article, discovered: true, mentioned: false, accuracy: null }] }) };
});
vi.mock('./geo-evidence-upload', () => ({ useGeoEvidenceUpload: (props: unknown) => props, GeoEvidenceUploadView: ({ controller: { onBlockingChange, onUploaded } }: { controller: { onBlockingChange: (value: boolean) => void; onUploaded: (file: components['schemas']['FileRecord']) => void } }) => <>
  <button type="button" onClick={() => onBlockingChange(true)}>开始上传</button>
  <button type="button" onClick={() => onBlockingChange(false)}>放弃上传成功</button>
  <button type="button" onClick={() => { onUploaded({ id: '40000000-0000-4000-8000-000000000001', original_filename: 'A.png' } as components['schemas']['FileRecord']); onBlockingChange(false); }}>完成 A</button>
  <button type="button" onClick={() => { onUploaded({ id: '40000000-0000-4000-8000-000000000002', original_filename: 'B.png' } as components['schemas']['FileRecord']); onBlockingChange(false); }}>完成 B</button>
</> }));

const candidate = { published_article_id: ids.article, title: '候选文章', platform_name: '官网', final_url: 'https://example.test/article', status: 'COMPLETED' };
function response(data: unknown) { return { data, response: Response.json(data) } as never; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function setup() {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  let candidates: () => Promise<never> = async () => response({ items: [candidate] });
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo-observation-publications') return candidates();
    if (path === '/api/v1/products') return response({ items: [{ id: ids.product, brand: '品牌', part_number: '型号' }], total: 1, page: 1, page_size: 20 });
    if (path === '/api/v1/query-topics') return response({ items: [{ id: ids.topic, canonical_question: '主题' }] });
    throw new Error(`意外请求 ${path}`);
  });
  const post = vi.spyOn(api, 'POST').mockResolvedValue(response({ id: 'created-id' }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onCreated = vi.fn();
  const view = render(<QueryClientProvider client={queryClient}><TooltipProvider><NewGeoObservationPage csrfToken="csrf" onCancel={vi.fn()} onCreated={onCreated} /></TooltipProvider></QueryClientProvider>);
  return { ...view, queryClient, post, onCreated, setCandidates: (read: typeof candidates) => { candidates = read; } };
}
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: '创建 Observation' })).not.toHaveAttribute('aria-disabled', 'true')); }
afterEach(() => vi.restoreAllMocks());

describe('NewGeoObservationPage 提交生命周期', () => {
  it('未编辑表单开始上传即启用离开保护，放弃成功仅在没有草稿时解除', async () => {
    setup(); await ready();
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    await userEvent.click(screen.getByRole('button', { name: '开始上传' }));
    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    await userEvent.click(screen.getByRole('button', { name: '放弃上传成功' }));
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    await userEvent.type(screen.getByLabelText('Notes'), '保留说明');
    await userEvent.click(screen.getByRole('button', { name: '开始上传' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃上传成功' }));
    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
  });

  it('409 刷新失败保留草稿及请求 ID，成功刷新按文章 ID 合并后才解冻', async () => {
    const context = setup();
    context.post.mockResolvedValue({ error: { error: { code: 'GEO_PUBLICATIONS_CHANGED', message: '候选变化', request_id: 'req-conflict', details: {} } }, response: Response.json({}, { status: 409 }) } as never);
    await ready();
    await userEvent.type(screen.getByLabelText('Notes'), '保留说明');
    await userEvent.click(screen.getByRole('button', { name: '创建 Observation' }));
    await screen.findByText('请求 ID：req-conflict');
    context.setCandidates(async () => { throw new Error('读取失败'); });
    await userEvent.click(screen.getByRole('button', { name: '重新读取候选' }));
    await screen.findByText('读取失败');
    expect(screen.getByText('请求 ID：req-conflict')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('保留说明');
    fireEvent.submit(context.container.querySelector('form')!);
    expect(context.post).toHaveBeenCalledTimes(1);
    context.setCandidates(async () => response({ items: [candidate, { ...candidate, published_article_id: '30000000-0000-4000-8000-000000000002', title: '新增文章' }] }));
    await userEvent.click(screen.getByRole('button', { name: '重新读取候选' }));
    await ready();
    expect(screen.queryByText('请求 ID：req-conflict')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '创建 Observation' }));
    await screen.findByText('新增文章：请选择是否发现');
    expect(context.post).toHaveBeenCalledTimes(1);
  });

  it('后台候选读取中和失败时，即使直接 submit 也不发送 POST', async () => {
    const context = setup(); await ready();
    const read = deferred<never>(); context.setCandidates(() => read.promise);
    let refreshing!: Promise<unknown>;
    act(() => { refreshing = context.queryClient.refetchQueries({ queryKey: geoKeys.publicationCandidates(ids.product) }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '创建 Observation' })).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.submit(context.container.querySelector('form')!);
    await act(async () => { read.resolve({ error: {}, response: Response.json({}, { status: 500 }) } as never); await refreshing; });
    // 使用失败 query，而不是带旧 data 的成功响应。
    context.setCandidates(async () => { throw new Error('后台读取失败'); });
    await act(async () => { await context.queryClient.refetchQueries({ queryKey: geoKeys.publicationCandidates(ids.product) }); });
    fireEvent.submit(context.container.querySelector('form')!);
    expect(context.post).not.toHaveBeenCalled();
  });

  it('已接受创建立即交接且持续锁定，缓存失效等待不会允许第二次 POST', async () => {
    const context = setup(); await ready();
    const invalidation = deferred<void>();
    vi.spyOn(context.queryClient, 'invalidateQueries').mockReturnValue(invalidation.promise);
    await userEvent.type(screen.getByLabelText('Notes'), '说明');
    await userEvent.click(screen.getByRole('button', { name: '创建 Observation' }));
    await waitFor(() => expect(context.onCreated).toHaveBeenCalledWith('created-id'));
    expect(screen.getByLabelText('Notes')).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    await userEvent.click(screen.getByRole('button', { name: '完成 B' }));
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    fireEvent.submit(context.container.querySelector('form')!);
    expect(context.post).toHaveBeenCalledTimes(1);
    await act(async () => { invalidation.resolve(); });
  });

  it('上传期间阻止 POST，完成后只提交仍保留的最新附件', async () => {
    const context = setup(); await ready();
    await userEvent.click(screen.getByRole('button', { name: '完成 A' }));
    await userEvent.click(screen.getByRole('button', { name: '开始上传' }));
    fireEvent.submit(context.container.querySelector('form')!);
    expect(context.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '移除' }));
    await userEvent.click(screen.getByRole('button', { name: '完成 B' }));
    await userEvent.click(screen.getByRole('button', { name: '创建 Observation' }));
    await waitFor(() => expect(context.post).toHaveBeenCalledTimes(1));
    expect((context.post.mock.calls[0]?.[1] as unknown as { body: unknown }).body).toMatchObject({ attachment_file_ids: ['40000000-0000-4000-8000-000000000002'] });
  });
});
