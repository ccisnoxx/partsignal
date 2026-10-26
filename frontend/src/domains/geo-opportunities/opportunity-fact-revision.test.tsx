import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { opportunityKeys } from './opportunities.api';
import type { Opportunity } from './opportunities.model';
import { comparisonRead, detail, failure, list, opportunity, opportunityId, renderOpportunities, response, retestId, time } from './opportunities.test-support';

type FactCommand = components['schemas']['GeoOpportunityFactRevisionRequest'];
const productId = '10000000-0000-4000-8000-000000000001';
const otherProductId = '40000000-0000-4000-8000-000000000001';
const factPath = '/api/v1/geo/opportunities/{opportunity_id}/actions/fact-revision';
const optionPath = '/api/v1/geo/opportunities/{opportunity_id}/fact-revision-options';
function active(): Opportunity { return opportunity({ status: 'ACKNOWLEDGED', workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'], revision: 2, product_id: productId }); }
function readDetail(current = active()) { return { ...detail(current), available_action_types: ['FACT_REVISION' as const] }; }
function options(current = active()): components['schemas']['GeoOpportunityFactRevisionOptions'] {
  return { opportunity_id: opportunityId, opportunity_revision: current.revision, available_action_types: ['FACT_REVISION'], as_of: time,
    products: [{ product_id: productId, brand: '测试品牌', part_number: 'PS-123' }, { product_id: otherProductId, brand: '其他品牌', part_number: 'PS-456' }] };
}
function receipt(body: FactCommand, replayed = false): components['schemas']['GeoOpportunityActionResult'] {
  const source = detail().trigger_snapshot;
  return { opportunity_revision: body.expected_revision + 1, replayed, action: {
    id: retestId, action_type: 'FACT_REVISION', target_type: 'Product', target_id: body.product_id,
    status_snapshot: 'FACTS_READY', created_by: opportunityId, created_at: time, target_available: true,
    navigation_path: `/products/${body.product_id}/facts?source_opportunity_id=${opportunityId}`,
    source_snapshot: { schema_version: 1, opportunity_id: opportunityId, opportunity_revision: body.expected_revision,
      trigger_snapshot: source, sources: source.sources, product_id: body.product_id, query_topic_id: opportunityId,
      fact_version_id: null, platform_profile_id: null, published_article_id: null, published_content_issue_id: null, request_id: 'core03-test' },
  } };
}
function reads(current: () => Opportunity = active, readOptions: () => components['schemas']['GeoOpportunityFactRevisionOptions'] = () => options(current())) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/opportunities') return response(list(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(current()));
    if (path === optionPath) return response(readOptions());
    throw new Error(`测试收到未声明 GET：${path}`);
  });
}
const sheet = () => screen.getByRole('dialog', { name: '机会详情与历史证据' });
async function input() {
  await userEvent.click(await within(sheet()).findByRole('button', { name: '发起事实修订' }));
  await within(sheet()).findByRole('form', { name: '机会事实修订表单' });
  const select = within(sheet()).getByRole('combobox', { name: '修订产品' });
  await waitFor(() => expect(select).toBeEnabled());
  await userEvent.click(select);
  await userEvent.click(await screen.findByRole('option', { name: '测试品牌 · PS-123' }));
}
afterEach(() => vi.restoreAllMocks());

describe('机会事实修订入口', () => {
  it('按动作投影提供入口，按需读取保存来源选项并调用既有API，成功提供工作区导航', async () => {
    let current = active(); const get = reads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path, params) => {
      expect(path).toBe(factPath);
      const body = (params as { body: FactCommand }).body;
      current = { ...current, revision: 3, status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS' };
      return response(receipt(body));
    });
    renderOpportunities();
    await within(await screen.findByRole('dialog', { name: '机会详情与历史证据' })).findByRole('button', { name: '发起事实修订' });
    expect(get.mock.calls.filter((call) => call[0] === optionPath)).toHaveLength(0);
    await input(); await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    const link = await within(sheet()).findByRole('link', { name: '打开产品事实工作区' });
    expect(link).toHaveAttribute('href', `/products/${productId}/facts?source_opportunity_id=${opportunityId}`);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toMatchObject({ body: { expected_revision: 2, product_id: productId }, params: { header: { 'X-CSRF-Token': 'geo703-csrf', 'Idempotency-Key': expect.any(String) } } });
    expect(within(sheet()).getByText(/已登记事实修订行动/)).toBeVisible();
  });

  it('同一机会状态没有FACT_REVISION token时不渲染入口或请求选项', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/geo/opportunities') return response(list(active()));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(detail(active()));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(active()));
      throw new Error('未声明读取');
    });
    renderOpportunities(); await within(await screen.findByRole('dialog', { name: '机会详情与历史证据' })).findByRole('heading', { name: active().title });
    expect(within(sheet()).queryByRole('button', { name: '发起事实修订' })).not.toBeInTheDocument();
    expect(get.mock.calls.some((call) => call[0] === optionPath)).toBe(false);
  });

  it('选项为空或读取失败明确说明，不假设关联产品合格', async () => {
    let broken = true;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === optionPath) return broken ? failure(503) : response({ ...options(), products: [] });
      if (path === '/api/v1/geo/opportunities') return response(list(active()));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail());
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(active()));
      throw new Error('未声明读取');
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' });
    await userEvent.click(await within(sheet()).findByRole('button', { name: '发起事实修订' }));
    await within(sheet()).findByRole('button', { name: '重试读取修订产品' });
    expect(within(sheet()).queryByRole('button', { name: '确认登记事实修订' })).not.toBeInTheDocument();
    broken = false; await userEvent.click(within(sheet()).getByRole('button', { name: '重试读取修订产品' }));
    expect(await within(sheet()).findByText(/当前没有可修订的来源产品/)).toBeVisible();
    expect(within(sheet()).getByRole('button', { name: '确认登记事实修订' })).toBeDisabled();
  });

  it('pending抑制重复点击，未知结果冻结选择且以原载荷和原key显式确认', async () => {
    reads(); let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise<never>((resolve) => { release = resolve; }))
      .mockImplementation(async (_path, params) => response(receipt((params as { body: FactCommand }).body, true)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    const button = within(sheet()).getByRole('button', { name: '确认登记事实修订' });
    await userEvent.dblClick(button); expect(post).toHaveBeenCalledTimes(1);
    expect(within(sheet()).getByRole('button', { name: '取消事实修订' })).toBeDisabled();
    await act(async () => { release(failure(503)); });
    const confirm = await within(sheet()).findByRole('button', { name: '确认原事实修订结果' });
    expect(within(sheet()).getByRole('combobox', { name: '修订产品' })).toBeDisabled();
    await userEvent.click(confirm); await within(sheet()).findByRole('link', { name: '打开产品事实工作区' });
    expect(post).toHaveBeenCalledTimes(2);
    const first = post.mock.calls[0]![1] as { body: FactCommand; params: object };
    expect(post.mock.calls[1]![1]).toMatchObject({ body: first.body, params: first.params });
  });

  it('409保留产品，后台读取不解锁；显式刷新再确认使用新revision和key', async () => {
    let current = active(); reads(() => current);
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(failure(409)).mockImplementation(async (_path, params) => response(receipt((params as { body: FactCommand }).body)));
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    await within(sheet()).findByRole('button', { name: '加载最新机会与修订产品' });
    current = { ...current, revision: 3 };
    await act(async () => { client.setQueryData(opportunityKeys.detail(opportunityId, { source_page: 1, source_page_size: 20 }), readDetail(current)); });
    expect(within(sheet()).getByRole('button', { name: '确认登记事实修订' })).toBeDisabled();
    await userEvent.click(within(sheet()).getByRole('button', { name: '加载最新机会与修订产品' }));
    await waitFor(() => expect(within(sheet()).getByRole('button', { name: '确认登记事实修订' })).toBeEnabled());
    expect(within(sheet()).getByRole('combobox', { name: '修订产品' })).toHaveTextContent('PS-123');
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    await within(sheet()).findByRole('link', { name: '打开产品事实工作区' });
    const headers = (index: number) => (post.mock.calls[index]![1] as { params: { header: object } }).params.header;
    expect(headers(1)).not.toEqual(headers(0)); expect(post.mock.calls[1]![1]).toMatchObject({ body: { expected_revision: 3, product_id: productId } });
  });

  it('错误产品或来源回执视为未知，既有请求保持可核对而不导航到错误目标', async () => {
    reads(); vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => {
      const value = receipt((params as { body: FactCommand }).body); value.action.target_id = otherProductId;
      return response(value);
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    await within(sheet()).findByRole('button', { name: '确认原事实修订结果' });
    expect(within(sheet()).queryByRole('link', { name: '打开产品事实工作区' })).not.toBeInTheDocument();
  });

  it('主体变化后的迟到成功不能显示旧产品或执行后续缓存工作', async () => {
    reads(); let release!: (value: never) => void;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise<never>((resolve) => { release = resolve; }));
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => { invalidatePrincipalEpoch(client); release(response(receipt({ expected_revision: 2, product_id: productId }))); });
    expect(within(sheet()).queryByRole('link', { name: '打开产品事实工作区' })).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('422定位产品字段并保留选择，403撤销产品表单而非重发命令', async () => {
    reads(); const post = vi.spyOn(api, 'POST').mockResolvedValueOnce({ error: { error: { code: 'VALIDATION_ERROR', message: '产品选择不再可用', request_id: 'core03-422', details: { errors: [{ loc: ['body', 'product_id'], msg: '请核对修订产品' }] } } }, response: Response.json({}, { status: 422 }) } as never).mockResolvedValueOnce(failure(403));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    const select = within(sheet()).getByRole('combobox', { name: '修订产品' });
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(select).toHaveAttribute('aria-describedby', expect.stringContaining('opportunity-fact-product-error'));
    expect(select).toHaveTextContent('PS-123');
    expect(within(sheet()).queryByRole('button', { name: '确认原事实修订结果' })).not.toBeInTheDocument();
    await userEvent.click(select); await userEvent.click(await screen.findByRole('option', { name: '其他品牌 · PS-456' }));
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    await waitFor(() => expect(within(sheet()).queryByRole('combobox', { name: '修订产品' })).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('目标已不可用的有效重放保留行动回执但不提供错误导航', async () => {
    reads(); vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => {
      const value = receipt((params as { body: FactCommand }).body, true);
      value.action.target_available = false; value.action.navigation_path = null;
      return response(value);
    });
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    expect(await within(sheet()).findByText('目标产品当前不可用，行动来源仍保留。')).toBeVisible();
    expect(within(sheet()).queryByRole('button', { name: '确认原事实修订结果' })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole('link', { name: '打开产品事实工作区' })).not.toBeInTheDocument();
  });

  it('登记成功但刷新失败保留已确认工作区入口，不重发已完成命令', async () => {
    reads(); const post = vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => response(receipt((params as { body: FactCommand }).body)));
    const { client } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('定向刷新故障'));
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    expect(await within(sheet()).findByText(/行动已登记，关联数据刷新失败/)).toBeVisible();
    expect(within(sheet()).getByRole('link', { name: '打开产品事实工作区' })).toHaveAttribute('href', `/products/${productId}/facts?source_opportunity_id=${opportunityId}`);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('首次旧列表迟到不能在事实行动登记后回填旧revision', async () => {
    let current = active(); let listReads = 0; let release!: (value: never) => void;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/geo/opportunities') {
        listReads += 1;
        if (listReads === 1) return new Promise<never>((resolve) => { release = resolve; });
        return response(list(current));
      }
      if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail(current));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(current));
      if (path === optionPath) return response(options(current));
      throw new Error('未声明读取');
    });
    vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => {
      current = { ...current, revision: 3, title: '事实修订后的机会', status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS' };
      return response(receipt((params as { body: FactCommand }).body));
    });
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(within(sheet()).getByRole('button', { name: '确认登记事实修订' }));
    await within(sheet()).findByRole('link', { name: '打开产品事实工作区' });
    await act(async () => { release(response(list(active()))); });
    await act(async () => { await router.navigate({ to: '/geo/opportunities', search: {}, ignoreBlocker: true }); });
    expect(await screen.findByRole('button', { name: '事实修订后的机会' })).toBeVisible();
    await waitFor(() => expect(listReads).toBe(2));
  });
});
