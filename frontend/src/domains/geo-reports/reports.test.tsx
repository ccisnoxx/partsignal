import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { answerInsights, filters, id, search } from '@/domains/geo-insights/insights.test-support';
import { ReportPage } from './report-page';
import { ReportContent } from './report-content';
import { reportOptions } from './reports.api';
import { exportUrl, reportParams, reportSearchSchema, type Report } from './reports.model';
function report(): Report {
  return { as_of: filters.date_to, generated_at: filters.date_to, source_mode: 'LIVE', filters, available: true, unavailable_reason: null,
    insights: answerInsights(), formulas: [{ metric_code: 'natural_visibility', label: '自然可见率', formula_version: 'geo-answer-v1', numerator_description: '符合提及的合格运行', denominator_description: '未点名合格运行' }], method_notes: ['实时报告，保持各采集维度独立'],
    exports: [{ kind: 'runs', available: true, unavailable_reason: null }, { kind: 'citations', available: true, unavailable_reason: null }, { kind: 'claims', available: true, unavailable_reason: null }, { kind: 'opportunities', available: false, unavailable_reason: 'NOT_IMPLEMENTED' }] };
}
function renderPage(print = false) {
  const client = createAppQueryClient(); const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/geo/reports', component: () => <ReportPage search={search} print={print}/> });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/geo/reports'] }) });
  return render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
}
const response = (data: Report) => ({ data, response: Response.json(data) }) as never;
afterEach(() => vi.restoreAllMocks());
describe('GEO 报告公开展示和下载边界', () => {
  it('报告URL与CSV保留全部基础筛选，丢弃明细和自由字段；打印与预览缓存隔离', () => {
    const parsed = reportSearchSchema.parse({ ...search, product_ids: [id], query_topic_ids: [id], prompt_variant_ids: [id], engine_surface_ids: [id], collection_profile_ids: [id], language_codes: ['zh-CN'], region_codes: ['cn'], login_states: ['ANONYMOUS'], intent_types: ['PRODUCT'], review_policy: 'REVIEWED_ONLY', fields: ['raw_payload'], detail: 'metric', cell_key: 'old' });
    const params = reportParams(parsed); const url = new URL(exportUrl('claims', parsed));
    for (const [key, value] of Object.entries(params)) expect(url.searchParams.getAll(key)).toEqual((Array.isArray(value) ? value : [value]).map(String));
    expect(url.searchParams.has('fields')).toBe(false); expect(url.searchParams.has('cell_key')).toBe(false);
    expect(reportOptions(parsed).queryKey).not.toEqual(reportOptions(parsed, true).queryKey);
  });
  it('纸面显示完整筛选、as_of、服务端值、样本、公式；维度无需展开且文本不执行', () => {
    const data = report(); data.insights.current_cells[0]!.display_name = '<script>window.unsafe=true</script>';
    render(<ReportContent report={data}/>);
    expect(screen.getByText(/数据截止 as_of/)).toBeInTheDocument(); expect(screen.getByText('subject_ids')).toBeInTheDocument();
    expect(screen.getAllByText('67%').length).toBeGreaterThan(0); expect(screen.getAllByText('1 / 17').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: '报告公式字典' })).toHaveTextContent('geo-answer-v1');
    expect(screen.getAllByText('fact_version_bindings').length).toBe(2); expect(document.querySelector('details')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
  it('无合格运行保留排除原因但不提供打印完成入口', async () => {
    const data = report(); data.available = false; data.unavailable_reason = 'NO_ELIGIBLE_RUNS';
    data.insights.current_cells = []; data.insights.previous_cells = [];
    data.insights.data_quality.overview.eligible_run_count = 0;
    data.insights.data_quality.overview.exclusion_reason_counts = [{ code: 'CURRENT_REVIEW_REQUIRED', run_count: 5 }];
    vi.spyOn(api, 'GET').mockResolvedValue(response(data)); renderPage(true);
    expect(await screen.findByText(/当前筛选没有合格运行/)).toBeInTheDocument();
    expect(screen.getByText(/尚需当前复核：5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打印' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '当前周期指标、产品与平台矩阵、竞品 SOV' })).not.toBeInTheDocument();
  });
  it('下载使用服务端链接；刷新权限拒绝清除已加载报告及下载入口', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(report())); renderPage();
    const download = await screen.findByRole('link', { name: '运行 CSV' });
    expect(download).toHaveAttribute('href', exportUrl('runs', search));
    expect(screen.queryByRole('link', { name: '机会 CSV' })).not.toBeInTheDocument();
    get.mockResolvedValue({ error: { error: { code: 'FORBIDDEN', request_id: 'denied' } }, response: Response.json({}, { status: 403 }) } as never);
    await userEvent.click(screen.getByRole('button', { name: '重新读取报告' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('报告不可访问'));
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: '运行 CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新读取报告' })).not.toBeInTheDocument();
  });
});
