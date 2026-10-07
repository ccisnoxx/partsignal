import { useState, type Dispatch, type SetStateAction } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { AnswerInsightsPage } from './insights-page';
import { OverviewPage } from './overview-page';
import { InsightSampleTables } from './insight-sample-tables';
import { MetricReadout } from './insights-components';
import { insightSearchSchema, type InsightSearch } from './drilldown.model';
import { answerInsights, filters, id, metric, overview, runSample, search, secondId } from './insights.test-support';

const requestOptions = (value: unknown) => value as { params?: { query?: Record<string, unknown> & { subject_ids?: string[] } }; signal?: AbortSignal | null };
const response = (data: unknown) => ({ data, response: Response.json(data) }) as never;
function renderPage(initial: InsightSearch = search, kind: 'answers' | 'overview' = 'answers') {
  const client = createAppQueryClient();
  let update!: Dispatch<SetStateAction<InsightSearch>>;
  const change = vi.fn((next: InsightSearch) => update(next));
  function Page() {
    const [current, setCurrent] = useState(initial); update = setCurrent;
    const Component = kind === 'answers' ? AnswerInsightsPage : OverviewPage;
    return <Component search={current} onSearchChange={change}/>;
  }
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: kind === 'answers' ? '/geo/insights/answers' : '/geo/overview', component: Page });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [kind === 'answers' ? '/geo/insights/answers' : '/geo/overview'] }) });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
  return { ...view, client, change, update: (next: InsightSearch) => act(() => update(next)) };
}
afterEach(() => vi.restoreAllMocks());
describe('回答洞察组件与异步边界', () => {
  it.each(['NONE', 'OBSERVED', 'REPORTABLE', 'STABLE'] as const)('样本等级 %s 完全由服务端决定，值不会重算', (level) => {
    render(<MetricReadout metric={{ ...metric(), sample_level: level }} onDrilldown={vi.fn()}/>);
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/分子 1 \/ 分母 17/)).toBeInTheDocument();
    expect(screen.getByText(level === 'NONE' ? /无样本/ : level === 'OBSERVED' ? /仅观测/ : level === 'REPORTABLE' ? /可报告/ : /稳定样本/)).toBeInTheDocument();
  });
  it('同一汇总提供全部分析区块与图表替代表，点击明细保持全筛选', async () => {
    let detailQuery: unknown;
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/geo/insights/runs') detailQuery = requestOptions(options).params?.query;
      return response(path === '/api/v1/geo/insights' ? answerInsights() : { as_of: filters.date_to, filters: {}, items: [runSample()], total: 26, page: 1, page_size: 20 });
    });
    const view = renderPage();
    await screen.findByRole('heading', { name: '趋势与前期比较' });
    expect(screen.getByRole('region', { name: '产品矩阵表格替代' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: '竞品 SOV 表格替代' })).toBeInTheDocument();
    expect(screen.getByText(/变化：\+2 个百分点/)).toBeInTheDocument();
    expect(screen.getByText(/目标主题覆盖率 45%/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '引用分析' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '事实风险' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '数据质量' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: '查看自然可见率样本' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '回答指标样本' });
    await within(dialog).findByRole('region', { name: '指标组成样本表' });
    expect(view.change).toHaveBeenLastCalledWith(expect.objectContaining({ ...search, detail: 'metric', cell_key: 'current' }));
    expect(detailQuery).toEqual({ ...filters, date_from: search.date_from, date_to: search.date_to, metric_code: 'natural_visibility', cell_key: 'current', period: 'CURRENT', cohort: 'DENOMINATOR', page: 1, page_size: 20 });
    await userEvent.click(within(dialog).getByRole('button', { name: '下一页' }));
    expect(view.change).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, cell_key: 'current' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(view.change).toHaveBeenLastCalledWith(search);
  });
  it('筛选变化时取消旧请求并清除明细，迟到旧结果不能覆盖新意图', async () => {
    let release!: (value: never) => void; let signal: AbortSignal | undefined;
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      const request = requestOptions(options);
      if (path === '/api/v1/geo/insights' && request.params?.query?.subject_ids?.[0] === id) {
        signal = request.signal ?? undefined; return new Promise((resolve) => { release = resolve; });
      }
      const newer = answerInsights(); newer.current_cells[0]!.display_name = '最新筛选结果';
      return response(newer);
    });
    const view = renderPage();
    await waitFor(() => expect(release).toBeDefined());
    view.update({ ...search, subject_ids: [secondId] });
    await screen.findAllByText('最新筛选结果');
    expect(signal?.aborted).toBe(true);
    await act(async () => release(response(answerInsights())));
    expect(within(screen.getByRole('region', { name: '可见性与推荐' })).queryByText('虚构监测产品')).not.toBeInTheDocument();
  });
  it('应用筛选校验时间和ID，不发送无效输入，成功时清除cell与分页', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => response(path === '/api/v1/geo/insights' ? answerInsights() : { as_of: filters.date_to, items: [], total: 0, page: 2, page_size: 20 }));
    const view = renderPage(insightSearchSchema.parse({ ...search, detail: 'metric', cell_key: 'current', metric_code: 'natural_visibility', page: 2 }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    const form = screen.getByRole('form', { name: 'GEO 洞察筛选' });
    const date = within(form).getByRole('textbox', { name: '结束时间（不含）' });
    await userEvent.clear(date); await userEvent.type(date, '2026-08-01T00:00:00Z');
    await userEvent.click(within(form).getByRole('button', { name: '应用筛选' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('结束时间必须晚于开始时间');
    await userEvent.clear(date); await userEvent.type(date, '2026-10-02T00:00:00Z');
    await userEvent.click(within(form).getByRole('button', { name: '应用筛选' }));
    expect(view.change).toHaveBeenLastCalledWith({ ...search, date_to: '2026-10-02T00:00:00.000Z' });
  });
  it('403与失效cell不给无效重试，服务失败可恢复', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ error: { error: { code: 'FORBIDDEN', request_id: 'request-a', message: '权限不足', details: {} } }, response: Response.json({}, { status: 403 }) } as never);
    renderPage(); expect(await screen.findByRole('alert')).toHaveTextContent('当前资源不可访问');
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
  });
  it('总览明确空样本与本页计数缺口，提供现有机会工作台路径', async () => {
    const data = overview(); data.metric_cells = []; data.key_products = []; data.data_quality.candidate_run_count = 0;
    data.cards = [{ ...data.cards[0]!, value: null, sample_level: 'NONE', unavailable_reason: 'NO_DENOMINATOR', numerator: 0, denominator: 0 }];
    vi.spyOn(api, 'GET').mockResolvedValue(response(data)); renderPage(search, 'overview');
    expect(await screen.findByText(/当前筛选没有运行样本/)).toBeInTheDocument();
    expect(screen.getByText('不可计算 · 无可用样本')).toBeInTheDocument();
    expect(screen.getByText(/当前没有可用的机会计数/)).toBeInTheDocument();
    expect(screen.getByText(/本页面尚未整合机会计数（NOT_IMPLEMENTED）/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GEO 机会工作台' })).toHaveAttribute('href', '/geo/opportunities');
    expect(screen.queryByText(/机会行动闭环尚未实现/)).not.toBeInTheDocument();
  });
  it('回答洞察限定本页动作集成缺口，说明工作台与现有 Action/Retest API', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(answerInsights())); renderPage();
    expect(await screen.findByText(/本页面尚未整合机会计数或业务动作/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GEO 机会工作台' })).toHaveAttribute('href', '/geo/opportunities');
    expect(screen.getByText(/Action\/Retest API/)).toBeInTheDocument();
    expect(screen.queryByText(/机会行动闭环尚未实现/)).not.toBeInTheDocument();
  });
  it.each(['answers', 'overview'] as const)('%s 同key刷新5xx保留成功快照，权限拒绝清除展示', async (kind) => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(kind === 'answers' ? answerInsights() : overview()));
    renderPage(search, kind); await screen.findAllByText('虚构监测产品');
    get.mockResolvedValue({ error: { error: { code: 'TEMPORARY', request_id: 'refresh-a' } }, response: Response.json({}, { status: 503 }) } as never);
    await userEvent.click(screen.getByRole('button', { name: '刷新汇总' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保留同一筛选');
    expect(screen.getAllByText('虚构监测产品').length).toBeGreaterThan(0);
    get.mockResolvedValue({ error: { error: { code: 'FORBIDDEN', request_id: 'refresh-b' } }, response: Response.json({}, { status: 403 }) } as never);
    await userEvent.click(screen.getByRole('button', { name: '刷新汇总' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('当前资源不可访问'));
    expect(screen.queryByText('虚构监测产品')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
  });
  it('声明纯文本和共享域候选不会执行脚本或冒充归属', () => {
    render(<InsightSampleTables detail={{ kind: 'claims', page: { as_of: filters.date_to, filters: { ...filters, cell_key: 'current', page: 1, page_size: 20 }, total: 1, run_count: 1, page: 1, page_size: 20,
      items: [{ ...runSample(), analysis_revision_id: secondId, claim_assessment_id: id, subject_id: id, fact_version_id: secondId, claim_kind: 'PARAMETER', claim_text: '<script>window.unsafe=true</script>', verdict: 'INCORRECT', severity: 'HIGH', fact_excerpt: '<img src=x onerror=alert(1)>', explanation: '批准事实不符' }] } }}/>);
    expect(screen.getByText('<script>window.unsafe=true</script>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('img')).toBeNull();
  });
});
