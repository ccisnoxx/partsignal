import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contentKeys } from '@/domains/content/content.api';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { GeoRequestError, geoInsightsQueryOptions } from './geo.api';
import { GeoInsightsPrintPage } from './geo-insights-print-page';
import { GeoInsightsPage } from './geo-insights-page';

const articleId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000001';
const platformId = '30000000-0000-4000-8000-000000000001';
const topicId = '40000000-0000-4000-8000-000000000001';
const rate = { numerator: 1, denominator: 2, value: 0.5 };
const trend = {
  current: rate,
  previous: { numerator: 1, denominator: 4, value: 0.25 },
  change: 1,
  points: [{ date: '2026-08-12', ...rate }],
};
const action = {
  rule_code: 'CONTENT_DECLINE', date_from: '2026-07-15', date_to: '2026-08-13',
  published_article_id: articleId, query_topic_id: null, geo_platform: null,
} as const;
const content = {
  published_article_id: articleId, product_id: productId, content_platform_id: platformId,
  title: 'PS-LNA 优化指南', content_platform: '官网', observation_count: 2,
  discovery_rate: rate, mention_rate: rate, accuracy_rate: rate,
  primary_task: 'CREATE_OPTIMIZATION_TASK', optimization_action: action,
} as const;
const insights = {
  generated_at: '2026-08-13T00:00:00Z',
  analysis_unit: 'MANUAL_OBSERVATION_PUBLICATION_RELATION',
  period: {
    current: { date_from: '2026-07-15', date_to: '2026-08-13' },
    previous: { date_from: '2026-06-15', date_to: '2026-07-14' },
  },
  filter_options: {
    products: [{ id: productId, label: 'PartSignal PS-LNA' }],
    content_platforms: [{ id: platformId, label: '官网' }],
    geo_platforms: ['DeepSeek'],
    publications: [{ id: articleId, label: 'PS-LNA 优化指南', platform_name: '官网' }],
    query_topics: [{ id: topicId, label: '如何选择 LNA？' }],
  },
  trends: { discovery_rate: trend, mention_rate: trend, accuracy_rate: trend },
  platform_performance: [{ geo_platform: 'DeepSeek', observation_count: 2, discovery_rate: rate, mention_rate: rate, accuracy_rate: rate, primary_task: 'VIEW_OBSERVATION_DETAILS' }],
  content_rankings: { best: [], declining: [{ ...content, basis: [{ metric: 'mention_rate', current_value: 0.5, previous_value: 0.8, decline: 0.3 }] }], long_unmentioned: [] },
  question_coverage: {
    by_status: { stable: 0, occasional: 0, uncovered: 1, insufficient_data: 0 },
    matrix: [{ query_topic_id: topicId, canonical_question: '如何选择 LNA？', geo_platform: 'DeepSeek', status: 'UNCOVERED', observation_count: 1, mentioned_observation_count: 0, coverage_rate: { numerator: 0, denominator: 1, value: 0 }, primary_task: 'ADD_OBSERVATION', optimization_action: null }],
  },
  recommendations: [{ rule_code: 'CONTENT_PERFORMANCE_DECLINE', priority: 'HIGH', title: '优先优化内容', basis_text: '提及率下降', basis_values: [], impact_relationship_count: 2, published_article_ids: [articleId], geo_platforms: [], query_topic_ids: [], detail_path: '/publications/legacy' }],
  data_quality: { eligible_observation_count: 2, excluded_incomplete_observation_count: 1, excluded_incomplete_relation_count: 1, unavailable_sections: [] },
} satisfies components['schemas']['GeoInsights'];

afterEach(() => vi.restoreAllMocks());

describe('GeoInsightsPage', () => {
  it('以单一 read model 呈现全部区块、精确替代数据与服务端动作', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ data: insights, response: Response.json(insights) } as never);
    const onSearchChange = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GeoInsightsPage csrfToken="csrf" onCreated={vi.fn()} onSearchChange={onSearchChange} search={{ from: '2026-07-15', to: '2026-08-13' }} /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'GEO 洞察' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'GEO 平台表现' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '问题覆盖矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打印报告' })).toHaveAttribute('href', '/geo/insights/print?from=2026-07-15&to=2026-08-13');
    expect(screen.getByText('提及率下降')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '优先优化内容' })).not.toBeInTheDocument();
    expect(screen.getAllByText('较上一周期 +100%')).toHaveLength(3);
    await userEvent.click(screen.getAllByText('查看精确数据')[0]!);
    expect(screen.getByRole('region', { name: '发现率每日精确数据' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '补充观测' })).toHaveAttribute('href', `/geo/observations/new?queryTopicId=${topicId}&geoPlatform=DeepSeek`);

    await userEvent.click(screen.getByRole('combobox', { name: 'GEO 平台' }));
    await userEvent.click(await screen.findByRole('option', { name: 'DeepSeek' }));
    await userEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onSearchChange).toHaveBeenCalledWith({ from: '2026-07-15', to: '2026-08-13', geoPlatform: 'DeepSeek' });
  });

  it('打印页复用同一 read model，但只呈现带标签的只读报告', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: insights, response: Response.json(insights) } as never);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GeoInsightsPrintPage onSearchChange={vi.fn()} search={{ from: '2026-07-15', to: '2026-08-13', productId, contentPlatformId: platformId, geoPlatform: 'DeepSeek', publishedArticleId: articleId, queryTopicId: topicId }} /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'GEO 洞察打印报告' })).toBeInTheDocument();
    expect(screen.getByText('PartSignal PS-LNA')).toBeInTheDocument();
    expect(screen.getAllByText('PS-LNA 优化指南 · 官网')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '发现率每日精确数据' })).toBeInTheDocument();
    expect(screen.queryByText('查看精确数据')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建优化任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /查看|补充/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打印' }));
    expect(print).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it('打印筛选缺少服务端标签时显式失败并允许清除筛选', async () => {
    const onSearchChange = vi.fn();
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: { ...insights, filter_options: { ...insights.filter_options, products: [] } },
      response: Response.json(insights),
    } as never);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GeoInsightsPrintPage onSearchChange={onSearchChange} search={{ from: '2026-07-15', to: '2026-08-13', productId }} /></QueryClientProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('缺少所选产品的服务端标签');
    await userEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(onSearchChange).toHaveBeenCalledWith({ from: expect.any(String), to: expect.any(String) });
  });

  it('打印报告刷新失败时保留上一次成功快照', async () => {
    const search = { from: '2026-07-15', to: '2026-08-13' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = geoInsightsQueryOptions(search);
    client.setQueryData(options.queryKey, insights);
    vi.spyOn(api, 'GET').mockRejectedValue(new Error('刷新错误'));
    render(<QueryClientProvider client={client}><GeoInsightsPrintPage onSearchChange={vi.fn()} search={search} /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'GEO 洞察打印报告' })).toBeInTheDocument();
    await client.refetchQueries({ queryKey: options.queryKey });
    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败，当前仍显示上一次成功快照。刷新错误');
    expect(screen.getByText('提及率下降')).toBeInTheDocument();
  });
});

const factId = '50000000-0000-4000-8000-000000000001';
const taskId = '60000000-0000-4000-8000-000000000001';
const search = { from: '2026-07-15', to: '2026-08-13' };
const creationOptions = {
  products: [{ id: productId, brand: 'PartSignal', part_number: 'PS-LNA', approved_fact_versions: [{ id: factId, version: 1, classification: 'PUBLIC' }] }],
  platforms: [{ id: platformId, name: '官网' }],
  requested_product: null,
} satisfies components['schemas']['ContentTaskCreationOptions'];
function result(data: unknown) { return { data, response: Response.json(data) } as never; }
function mockReads(data: components['schemas']['GeoInsights'] = insights) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => result(path === '/api/v1/geo-insights' ? data : creationOptions));
}
function renderOptimization(onCreated = vi.fn<(id: string) => void | Promise<void>>()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (nextSearch = search) => <QueryClientProvider client={client}><GeoInsightsPage csrfToken="csrf" onCreated={onCreated} onSearchChange={vi.fn()} search={nextSearch} /></QueryClientProvider>;
  const rendered = render(view());
  return { client, onCreated, rerender: (nextSearch: typeof search) => rendered.rerender(view(nextSearch)) };
}
async function openOptimization(index = 0) {
  await userEvent.click((await screen.findAllByRole('button', { name: '创建优化任务' }))[index]!);
  const dialog = await screen.findByRole('dialog', { name: '创建 GEO 优化任务' });
  await userEvent.click(await within(dialog).findByRole('combobox', { name: '已批准事实版本' }));
  await userEvent.click(await screen.findByRole('option', { name: 'v1 · PUBLIC' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '创建任务' })).not.toBeDisabled());
  return dialog;
}
function conflict() {
  return new GeoRequestError('来源变化', 409, { code: 'GEO_OPTIMIZATION_CONTEXT_STALE', message: '来源变化', details: {}, request_id: 'req-stale' });
}

describe('GEO optimization command lifecycle', () => {
  it('pending 拒绝取消、Escape、关闭及重复提交，仍使用同一个命令', async () => {
    mockReads();
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }) as never);
    const { onCreated } = renderOptimization();
    const dialog = await openOptimization();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.submit(dialog.querySelector('form')!);
    expect(post).toHaveBeenCalledOnce();
    await act(async () => resolvePost?.(result({ id: taskId })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(taskId));
  });

  it('201 后缓存悬停和导航拒绝不会重新 POST，重试仅打开响应 ID', async () => {
    mockReads();
    const post = vi.spyOn(api, 'POST').mockResolvedValue(result({ id: taskId }));
    const onCreated = vi.fn<(id: string) => Promise<void>>().mockRejectedValueOnce(new Error('导航失败')).mockResolvedValue(undefined);
    const { client } = renderOptimization(onCreated);
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    const dialog = await openOptimization();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await screen.findByText('打开任务失败：导航失败');
    fireEvent.submit(dialog.querySelector('form')!);
    await userEvent.click(within(dialog).getByRole('button', { name: '打开已创建任务' }));
    expect(post).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenLastCalledWith(taskId);
  });

  it('相同 body 的 409 显式刷新后人工重试复用幂等键', async () => {
    mockReads();
    const post = vi.spyOn(api, 'POST').mockRejectedValueOnce(conflict()).mockResolvedValue(result({ id: taskId }));
    renderOptimization();
    const dialog = await openOptimization();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await screen.findByText('请求 ID：req-stale');
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载洞察' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '创建任务' })).not.toBeDisabled());
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  });

  it('来源消失时显式刷新保留 Dialog、目标与 request ID', async () => {
    const get = mockReads();
    vi.spyOn(api, 'POST').mockRejectedValue(conflict());
    renderOptimization();
    const dialog = await openOptimization();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    await screen.findByText('请求 ID：req-stale');
    get.mockImplementation(async (path) => result(path === '/api/v1/geo-insights' ? { ...insights, content_rankings: { ...insights.content_rankings, declining: [] } } : creationOptions));
    await userEvent.click(within(dialog).getByRole('button', { name: '重新加载洞察' }));
    await screen.findByText(/原优化来源已不再可用/);
    expect(within(dialog).getByRole('combobox', { name: '已批准事实版本' })).toHaveTextContent('v1 · PUBLIC');
    expect(within(dialog).getByText('请求 ID：req-stale')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '创建任务' })).toBeDisabled();
  });

  it.each(['source', 'target', 'read-error'] as const)('%s 撤销后不能用旧上下文提交，被动恢复不能解冻', async (kind) => {
    const get = mockReads();
    const post = vi.spyOn(api, 'POST');
    const { client } = renderOptimization();
    const dialog = await openOptimization();
    await act(async () => {
      if (kind === 'source') client.setQueryData(geoInsightsQueryOptions(search).queryKey, { ...insights, content_rankings: { ...insights.content_rankings, declining: [] } });
      else if (kind === 'target') client.setQueryData(contentKeys.creationOptions(productId), { ...creationOptions, platforms: [] });
      else {
        get.mockRejectedValue(new Error('选项读取失败'));
        await client.refetchQueries({ queryKey: contentKeys.creationOptions(productId) });
      }
    });
    await screen.findByRole('button', { name: '重新加载洞察' });
    act(() => {
      client.setQueryData(geoInsightsQueryOptions(search).queryKey, insights);
      client.setQueryData(contentKeys.creationOptions(productId), creationOptions);
    });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(post).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: '创建任务' })).toBeDisabled();
  });

  it('A reload 迟到不会关闭或写入重新打开的 B Dialog', async () => {
    const second = { ...content, published_article_id: taskId, title: '第二来源', optimization_action: { ...action, published_article_id: taskId }, basis: [] };
    const twoSources = { ...insights, content_rankings: { ...insights.content_rankings, declining: [...insights.content_rankings.declining, second] } };
    const get = mockReads(twoSources);
    vi.spyOn(api, 'POST').mockRejectedValue(conflict());
    renderOptimization();
    const first = await openOptimization();
    await userEvent.click(within(first).getByRole('button', { name: '创建任务' }));
    await screen.findByText('请求 ID：req-stale');
    let resolveGet: ((value: unknown) => void) | undefined;
    get.mockImplementation((path) => path === '/api/v1/geo-insights' ? new Promise((resolve) => { resolveGet = resolve; }) as never : Promise.resolve(result(creationOptions)));
    await userEvent.click(within(first).getByRole('button', { name: '重新加载洞察' }));
    await userEvent.click(within(first).getByRole('button', { name: '取消' }));
    await userEvent.click(screen.getAllByRole('button', { name: '创建优化任务' })[1]!);
    const secondDialog = await screen.findByRole('dialog');
    expect(secondDialog).toHaveTextContent('第二来源');
    await act(async () => resolveGet?.(result({ ...twoSources, content_rankings: { ...twoSources.content_rankings, declining: [second] } })));
    expect(screen.getByRole('dialog')).toHaveTextContent('第二来源');
    expect(screen.queryByText(/原优化来源已不再可用/)).not.toBeInTheDocument();
  });

  it('search 往返复用页面命令：pending 不重复 POST，迟到 201 后只打开已接受 ID', async () => {
    mockReads();
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }) as never);
    const { onCreated, rerender } = renderOptimization();
    const first = await openOptimization();
    await userEvent.click(within(first).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    rerender({ from: '2026-07-14', to: '2026-08-13' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const second = await openOptimization();
    await userEvent.click(within(second).getByRole('button', { name: '创建任务' }));
    await screen.findByText('同一优化任务正在创建，请等待原请求完成');
    expect(post).toHaveBeenCalledOnce();
    await act(async () => resolvePost?.(result({ id: taskId })));
    expect(onCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(within(second).getByRole('button', { name: '创建任务' })).not.toBeDisabled());
    await userEvent.click(within(second).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(taskId));
    expect(post).toHaveBeenCalledOnce();
  });

  it('失败后关闭重开并用相同 body 人工重试仍复用同一幂等键', async () => {
    mockReads();
    const post = vi.spyOn(api, 'POST').mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue(result({ id: taskId }));
    renderOptimization();
    const first = await openOptimization();
    await userEvent.click(within(first).getByRole('button', { name: '创建任务' }));
    await screen.findByText('网络失败');
    await userEvent.click(within(first).getByRole('button', { name: '取消' }));
    const second = await openOptimization();
    await userEvent.click(within(second).getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  });

  it('search 切换结束旧 Dialog；旧 POST 晚到不导航新筛选', async () => {
    mockReads();
    let resolvePost: ((value: unknown) => void) | undefined;
    vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }) as never);
    const { onCreated, rerender } = renderOptimization();
    const dialog = await openOptimization();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }));
    rerender({ from: '2026-07-14', to: '2026-08-13' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => resolvePost?.(result({ id: taskId })));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
