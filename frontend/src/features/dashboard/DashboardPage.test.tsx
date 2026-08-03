/** 验证工作台严格使用契约统计，不从列表自行拼接第二份指标。 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { api } from '../../shared/api/client';
import { mockFetch } from '../../test/fetchMock';

const user = {
  id: '10000000-0000-4000-8000-000000000001', username: 'reviewer', display_name: '审核员',
  account_type: 'ENGINEER', is_active: true, must_change_password: false, available_actions: [], revision: 1, created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'User'>;

const summaryData = {
  pending_fact_reviews: 3, pending_content_reviews: 2, pending_publications: 4,
  open_publication_issues: 1, recent_accuracy_errors: 2,
} satisfies Schema<'DashboardSummary'>;

const metricsData = {
  legacy_sample_count: 0, legacy_mention_rate: null, legacy_recommendation_rate: null,
  legacy_citation_rate: null, legacy_accuracy_rate: null,
  manual_observation_count: 3, article_result_count: 10, discovered_article_count: 8,
  mentioned_article_count: 6, article_discovery_rate: 0.8, article_mention_rate: 0.6,
  article_accuracy_rate: 0.75,
} satisfies Schema<'GeoMetrics'>;

function mockDashboard(
  summary: Schema<'DashboardSummary'> = summaryData,
  metrics: Schema<'GeoMetrics'> = metricsData,
) {
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/dashboard/summary')) return { body: summary };
    if (path.endsWith('/geo-metrics')) return { body: metrics };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
}

test('按管理层层级展示真实 GEO 指标、运营状态和处理入口', async () => {
  window.history.pushState({}, '', '/');
  mockDashboard();
  expect((await api.GET('/api/v1/auth/me')).data).toEqual(user);
  render(<App />);

  expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
  const shell = document.querySelector('.app-shell');
  expect(shell).toHaveClass('app-shell');
  expect([...shell!.classList].filter((className) => className.startsWith('app-shell-'))).toEqual([]);
  expect(screen.getAllByText('审核员')).toHaveLength(2);
  const metrics = await screen.findByRole('region', { name: 'GEO 管理指标' });
  for (const label of ['人工观测', '文章发现率', '文章提及率', '文章准确率']) {
    expect(within(metrics).getByText(label)).toBeInTheDocument();
  }
  expect(within(metrics).getByLabelText('文章发现率 80%')).toBeInTheDocument();
  expect(within(metrics).getByLabelText('文章提及率 60%')).toBeInTheDocument();
  expect(within(metrics).getByLabelText('文章准确率 75%')).toBeInTheDocument();
  expect(within(metrics).queryByText('待审事实')).not.toBeInTheDocument();

  expect(within(screen.getByRole('region', { name: '审核流程状态' })).getByText('待审事实 3 · 待审内容 2')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '发布流程状态' })).getByText('待处理发布 4 · 开放问题 1')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'GEO 观测状态' })).getByText('发现率 80% · 提及率 60% · 准确性问题 2')).toBeInTheDocument();

  for (const [name, href] of [
    ['处理已发布内容问题', '/publications?tab=issues&status=OPEN'], ['处理近 30 日准确性问题', '/observations'],
    ['处理待审事实', '/products'], ['处理待审内容', '/tasks'],
    ['处理待人工发布', '/publications'],
    ['进入产品事实', '/products'], ['进入内容任务', '/tasks'],
    ['进入发布管理', '/publications'], ['进入GEO 观测', '/observations'],
  ]) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }

  await userEvent.click(screen.getByRole('button', { name: '打开用户操作菜单' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /修改密码/ }));
  expect(await screen.findByRole('heading', { name: '修改密码' })).toBeInTheDocument();
});

test('空独立比率和零待办保持明确的正常状态', async () => {
  window.history.pushState({}, '', '/');
  mockDashboard(
    { pending_fact_reviews: 0, pending_content_reviews: 0, pending_publications: 0, open_publication_issues: 0, recent_accuracy_errors: 0 },
    { ...metricsData, manual_observation_count: 0, article_result_count: 0, discovered_article_count: 0, mentioned_article_count: 0, article_discovery_rate: null, article_mention_rate: null, article_accuracy_rate: null },
  );
  render(<App />);

  expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
  const metrics = await screen.findByRole('region', { name: 'GEO 管理指标' });
  expect(within(metrics).getAllByText('—')).toHaveLength(3);
  expect(within(metrics).queryByRole('progressbar')).not.toBeInTheDocument();
  for (const label of ['审核流程状态', '发布流程状态', 'GEO 观测状态']) {
    expect(within(screen.getByRole('region', { name: label })).getByText('正常')).toBeInTheDocument();
  }
  expect(screen.getAllByText('当前无需处理')).toHaveLength(5);
  expect(screen.getByRole('link', { name: '查看已发布内容问题' })).toHaveClass('is-clear');
});

test('加载中仍保留 PageHeader，并用统一状态卡承载反馈', async () => {
  window.history.pushState({}, '', '/');
  let resolveSummary!: (response: Response) => void;
  let resolveMetrics!: (response: Response) => void;
  const pendingSummary = new Promise<Response>((resolve) => { resolveSummary = resolve; });
  const pendingMetrics = new Promise<Response>((resolve) => { resolveMetrics = resolve; });
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return Promise.resolve(Response.json(user));
    if (path.endsWith('/auth/csrf')) return Promise.resolve(Response.json({ csrf_token: 'x'.repeat(32) }));
    if (path.endsWith('/dashboard/summary')) return pendingSummary;
    if (path.endsWith('/geo-metrics')) return pendingMetrics;
    return Promise.reject(new Error(`未声明的测试请求：${request.method} ${path}`));
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
  expect(screen.getByLabelText('正在加载工作台')).toBeInTheDocument();

  resolveSummary(Response.json(summaryData));
  resolveMetrics(Response.json(metricsData));
  expect(await screen.findByRole('region', { name: 'GEO 管理指标' })).toBeInTheDocument();
});

test('任一统计请求失败时保留 PageHeader，并允许同时重试两个真实查询', async () => {
  window.history.pushState({}, '', '/');
  let summaryRequests = 0;
  let metricsRequests = 0;
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/dashboard/summary')) {
      summaryRequests += 1;
      return { status: 500, body: { error: { code: 'DASHBOARD_FAILED', message: '工作台统计失败' } } };
    }
    if (path.endsWith('/geo-metrics')) {
      metricsRequests += 1;
      return { status: 500, body: { error: { code: 'GEO_METRICS_FAILED', message: 'GEO 统计失败' } } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(/工作台统计失败|GEO 统计失败/);
  const previousSummaryRequests = summaryRequests;
  const previousMetricsRequests = metricsRequests;
  await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => {
    expect(summaryRequests).toBeGreaterThan(previousSummaryRequests);
    expect(metricsRequests).toBeGreaterThan(previousMetricsRequests);
  });
});
