/** 验证洞察页 URL 单一状态、服务端筛选、可访问趋势与原生打印入口。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { GeoInsightsPage, GeoInsightsPrintPage } from './GeoInsightsPage';

const contentPlatformId = '10000000-0000-4000-8000-000000000001';
const publicationId = '20000000-0000-4000-8000-000000000001';
const decliningPublicationId = '20000000-0000-4000-8000-000000000002';
const topicId = '30000000-0000-4000-8000-000000000001';
const secondTopicId = '30000000-0000-4000-8000-000000000002';
const thirdTopicId = '30000000-0000-4000-8000-000000000003';
const fourthTopicId = '30000000-0000-4000-8000-000000000004';
const longPublicationTitle = 'PS-001 面向超长工业应用场景的完整替代选型与验证指南';
const longPlatformName = '工程师社区官方技术论坛平台账号';

const rateTrend = {
  current: { numerator: 2, denominator: 4, value: 0.5 },
  previous: { numerator: 1, denominator: 4, value: 0.25 },
  change: 1,
  points: [
    { date: '2026-07-20', numerator: 0, denominator: 0, value: null },
    { date: '2026-07-21', numerator: 2, denominator: 4, value: 0.5 },
  ],
} satisfies Schema<'GeoInsightRateTrend'>;

const recommendations = Array.from({ length: 6 }, (_, index) => ({
  rule_code: 'QUESTION_INSUFFICIENT_DATA',
  priority: 'LOW',
  title: `补充问题观测 ${index + 1}`,
  basis_text: '当前只有 2 次完整观测。',
  basis_values: [{ metric: 'observation_count', value: 2, threshold: 3, unit: 'COUNT' }],
  impact_relationship_count: 2,
  publication_record_ids: [],
  geo_platforms: ['DeepSeek'],
  query_topic_ids: [topicId],
  detail_path: null,
})) satisfies Schema<'GeoInsightRecommendation'>[];

const insights = {
  generated_at: '2026-07-22T10:00:00Z',
  analysis_unit: 'MANUAL_OBSERVATION_PUBLICATION_RELATION',
  period: {
    current: { date_from: '2026-07-20', date_to: '2026-07-21' },
    previous: { date_from: '2026-07-18', date_to: '2026-07-19' },
  },
  filter_options: {
    content_platforms: [{ id: contentPlatformId, label: '工程师社区' }],
    geo_platforms: ['DeepSeek', 'Gemini'],
    content_angles: ['替代选型'],
    publications: [{ id: publicationId, label: 'PS-001 选型文章', platform_name: '工程师社区' }],
    query_topics: [{ id: topicId, label: 'PS-001 如何替代？' }],
  },
  trends: {
    mention_rate: rateTrend,
    recommendation_rate: rateTrend,
    citation_rate: rateTrend,
    accuracy_rate: rateTrend,
    not_recommended_content_count: {
      current: 1, previous: 2, change: -0.5,
      points: [{ date: '2026-07-20', count: 1 }, { date: '2026-07-21', count: 0 }],
    },
  },
  platform_performance: [{
    geo_platform: 'DeepSeek', observation_count: 3,
    mention_rate: rateTrend.current, recommendation_rate: rateTrend.current,
    citation_rate: rateTrend.current, accuracy_rate: rateTrend.current,
  }],
  funnel: [
    ['PUBLISHED', '完成发布', 4, null],
    ['DISCOVERED', '被检索发现', 4, 1],
    ['MENTIONED', '获得提及', 3, 0.75],
    ['RECOMMENDED', '获得推荐', 2, 2 / 3],
    ['CITED', '展示引用', 2, 1],
    ['ACCURATE', '结果准确', 0, 0],
  ].map(([code, label, count, conversion_from_previous]) => ({ code, label, count, conversion_from_previous })) as Schema<'GeoInsightFunnelStage'>[],
  content_rankings: {
    best: [{
      publication_record_id: publicationId, title: longPublicationTitle, content_platform: longPlatformName, observation_count: 3,
      mention_rate: rateTrend.current, recommendation_rate: rateTrend.current, citation_rate: rateTrend.current,
    }],
    declining: [{
      publication_record_id: decliningPublicationId, title: 'PS-001 表现下降文章', content_platform: '工程师社区', observation_count: 3,
      mention_rate: rateTrend.current, recommendation_rate: rateTrend.current, citation_rate: rateTrend.previous,
      basis: [{ metric: 'citation_rate', current_value: 0.25, previous_value: 0.5, decline: 0.25 }],
    }],
    long_unmentioned: [],
  },
  question_coverage: {
    by_status: { stable: 2, occasional: 1, uncovered: 1, insufficient_data: 1 },
    matrix: [
      {
        query_topic_id: topicId, canonical_question: '不应在总览铺开的问题一', geo_platform: 'DeepSeek', status: 'STABLE',
        observation_count: 4, mentioned_observation_count: 3, coverage_rate: { numerator: 3, denominator: 4, value: 0.75 },
      },
      {
        query_topic_id: topicId, canonical_question: '不应在总览铺开的问题一', geo_platform: 'Gemini', status: 'STABLE',
        observation_count: 4, mentioned_observation_count: 3, coverage_rate: { numerator: 3, denominator: 4, value: 0.75 },
      },
      {
        query_topic_id: secondTopicId, canonical_question: '不应在总览铺开的问题二', geo_platform: 'DeepSeek', status: 'OCCASIONAL',
        observation_count: 4, mentioned_observation_count: 2, coverage_rate: rateTrend.current,
      },
      {
        query_topic_id: thirdTopicId, canonical_question: '不应在总览铺开的问题三', geo_platform: 'Gemini', status: 'UNCOVERED',
        observation_count: 4, mentioned_observation_count: 0, coverage_rate: { numerator: 0, denominator: 4, value: 0 },
      },
      {
        query_topic_id: fourthTopicId, canonical_question: '不应在总览铺开的问题四', geo_platform: 'Gemini', status: 'INSUFFICIENT_DATA',
        observation_count: 2, mentioned_observation_count: 0, coverage_rate: { numerator: 0, denominator: 2, value: 0 },
      },
    ],
  },
  recommendations,
  data_quality: {
    eligible_observation_count: 3,
    excluded_incomplete_observation_count: 1,
    excluded_incomplete_relation_count: 1,
    unavailable_sections: [{ code: 'LONG_UNMENTIONED_PERIOD_TOO_SHORT', message: '筛选周期至少需要覆盖 30 个自然日。' }],
  },
} satisfies Schema<'GeoInsights'>;

function LocationProbe() {
  return <output aria-label="当前查询参数">{useLocation().search}</output>;
}

function renderPage(entry: string, printMode = false) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/observations/insights" element={<><GeoInsightsPage /><LocationProbe /></>} />
            <Route path="/observations/insights/print" element={<>{printMode && <GeoInsightsPrintPage />}<LocationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

test('从 URL 恢复全部筛选，筛选请求和重置继续使用同一查询对象', async () => {
  const user = userEvent.setup();
  const requests: URLSearchParams[] = [];
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/geo-insights') {
      requests.push(new URLSearchParams(url.search));
      return { body: insights };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });
  renderPage(`/observations/insights?date_from=2026-07-20&date_to=2026-07-21&content_platform_id=${contentPlatformId}&geo_platform=DeepSeek&content_angle=${encodeURIComponent('替代选型')}&publication_record_id=${publicationId}&query_topic_id=${topicId}&filters_collapsed=true`);

  expect(await screen.findByText('平台表现对比')).toBeInTheDocument();
  expect(requests[0]?.get('content_platform_id')).toBe(contentPlatformId);
  expect(requests[0]?.get('geo_platform')).toBe('DeepSeek');
  expect(requests[0]?.get('content_angle')).toBe('替代选型');
  expect(requests[0]?.get('publication_record_id')).toBe(publicationId);
  expect(requests[0]?.get('query_topic_id')).toBe(topicId);
  expect(requests[0]?.has('filters_collapsed')).toBe(false);

  await user.click(screen.getByRole('button', { name: '展开筛选' }));
  expect(screen.getByText('分析筛选器')).toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'GEO 观测平台' }));
  await user.click(await screen.findByRole('option', { name: 'Gemini' }));
  await waitFor(() => expect(requests.some((query) => query.get('geo_platform') === 'Gemini')).toBe(true));
  expect(screen.getByLabelText('当前查询参数')).toHaveTextContent('geo_platform=Gemini');

  const printLink = screen.getByRole('link', { name: /导出洞察报告/ });
  const printUrl = new URL(printLink.getAttribute('href')!, 'http://example.test');
  expect(printUrl.pathname).toBe('/observations/insights/print');
  expect(printUrl.searchParams.get('geo_platform')).toBe('Gemini');
  expect(printUrl.searchParams.get('publication_record_id')).toBe(publicationId);

  await user.click(screen.getByRole('button', { name: '重置' }));
  await waitFor(() => {
    const params = new URLSearchParams(screen.getByLabelText('当前查询参数').textContent ?? '');
    expect(params.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get('date_to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.has('geo_platform')).toBe(false);
    expect(params.has('publication_record_id')).toBe(false);
    expect(params.has('filters_collapsed')).toBe(false);
  });
  expect(screen.getAllByText('全部平台')).toHaveLength(2);
  expect(screen.getByText('全部主题')).toBeInTheDocument();
  expect(screen.getByText('全部内容')).toBeInTheDocument();
  expect(screen.getByText('全部问题')).toBeInTheDocument();
});

test('趋势空点断线并可通过键盘焦点或鼠标悬浮读取 Tooltip', async () => {
  mockFetch(() => ({ body: insights }));
  renderPage('/observations/insights?date_from=2026-07-20&date_to=2026-07-21');
  expect(await screen.findByRole('heading', { name: 'GEO 分析洞察' })).toBeInTheDocument();
  expect((await screen.findByText('GEO 指标趋势')).closest('.geo-insight-parent-card')).toHaveClass('geo-insight-trend-panel');
  expect(screen.getByText('内容表现排行').closest('.geo-insight-parent-card')).toHaveClass('geo-insight-ranking-panel');
  expect(screen.getAllByText('上一周期 25.0%')).toHaveLength(4);
  expect(screen.getByLabelText('从上一阶段转化：66.7%')).toHaveTextContent('66.7%');
  expect(screen.getByText('结果准确').parentElement?.querySelector('.geo-insight-funnel-track > span')).toHaveStyle({ height: '0%' });
  const chart = await screen.findByRole('img', { name: /提及率趋势：2026-07-20 至 2026-07-21/ });
  expect(chart).toHaveAttribute('tabindex', '0');
  expect(chart.querySelectorAll('circle[tabindex]')).toHaveLength(0);
  fireEvent.focus(chart);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-07-20 · 无样本');
  fireEvent.keyDown(chart, { key: 'ArrowRight' });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-07-21 · 50.0% · 2 / 4 条关系');
  fireEvent.keyDown(chart, { key: 'Home' });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-07-20 · 无样本');
  fireEvent.blur(chart);
  const point = chart.querySelector('circle');
  expect(point).not.toBeNull();
  fireEvent.mouseEnter(point!);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-07-20 · 无样本');
  fireEvent.mouseLeave(point!);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(document.querySelectorAll('.geo-insight-trend-card:first-child .geo-insight-chart-line')).toHaveLength(0);
});

test('排行省略内容和下降依据仍保留完整可访问文本与 Tooltip', async () => {
  mockFetch(() => ({ body: insights }));
  renderPage('/observations/insights?date_from=2026-07-20&date_to=2026-07-21');

  expect(await screen.findByRole('link', { name: longPublicationTitle })).toHaveClass('geo-insight-ranking-text');
  const platform = screen.getByLabelText(`内容平台：${longPlatformName}`);
  expect(platform).toHaveClass('geo-insight-ranking-text');
  fireEvent.focus(platform);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(longPlatformName);
  fireEvent.blur(platform);
  const decliningContent = screen.getByRole('link', { name: 'PS-001 表现下降文章' });
  fireEvent.focus(decliningContent);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('引用率 50.0% → 25.0%（下降 25.0 个百分点）');
});

test('覆盖总览只按服务端分类结果分组计数，不铺开问题明细', async () => {
  mockFetch(() => ({ body: insights }));
  renderPage('/observations/insights?date_from=2026-07-20&date_to=2026-07-21');

  const table = await screen.findByRole('table', { name: '覆盖状态与 GEO 平台计数' });
  expect(within(table).getByRole('row', { name: /稳定覆盖 1 1 2/ })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: /偶尔命中 1 0 1/ })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: /尚未覆盖 0 1 1/ })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: /数据不足 0 1 1/ })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: /稳定覆盖 1 1 2/ })).toHaveClass('geo-insight-coverage-stable');
  expect(within(table).getByRole('row', { name: /偶尔命中 1 0 1/ })).toHaveClass('geo-insight-coverage-occasional');
  expect(within(table).getByRole('row', { name: /尚未覆盖 0 1 1/ })).toHaveClass('geo-insight-coverage-uncovered');
  expect(within(table).getByRole('row', { name: /数据不足 0 1 1/ })).toHaveClass('geo-insight-coverage-insufficient-data');
  expect(screen.queryByText('不应在总览铺开的问题一')).not.toBeInTheDocument();
  expect(screen.getByLabelText('覆盖状态说明')).toHaveTextContent('稳定覆盖：覆盖率 ≥ 60%（≥3 次）');
});

test('数据质量以紧凑摘要呈现，并通过提示保留完整计数和机器原因', async () => {
  mockFetch(() => ({ body: insights }));
  renderPage('/observations/insights?date_from=2026-07-20&date_to=2026-07-21');

  const status = await screen.findByRole('status', { name: /数据质量：完整 3 条/ });
  expect(status).toHaveTextContent('完整 3 条· 1 项限制');
  fireEvent.focus(status);
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip).toHaveTextContent('排除观测 1 条 · 排除关系 1 条');
  expect(tooltip).toHaveTextContent('LONG_UNMENTIONED_PERIOD_TOO_SHORT：筛选周期至少需要覆盖 30 个自然日。');
  fireEvent.blur(status);
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
});

test('洞察请求失败明确显示错误并保留重试和重置入口', async () => {
  mockFetch(() => ({
    status: 500,
    body: { error: { code: 'GEO_INSIGHT_FAILED', message: '洞察聚合失败', request_id: 'geo-insight-test' } },
  }));
  renderPage('/observations/insights?date_from=2026-07-20&date_to=2026-07-21');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('洞察聚合失败');
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重置筛选' })).toBeInTheDocument();
});

test('打印路由复用同一响应、完整筛选和浏览器原生打印', async () => {
  const requests: URL[] = [];
  mockFetch((request) => {
    requests.push(new URL(request.url));
    return { body: insights };
  });
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  renderPage(`/observations/insights/print?date_from=2026-07-20&date_to=2026-07-21&geo_platform=DeepSeek&query_topic_id=${topicId}`, true);

  expect(await screen.findByRole('heading', { name: 'GEO 分析洞察报告' })).toBeInTheDocument();
  expect(await screen.findByText('补充问题观测 6')).toBeInTheDocument();
  expect(await screen.findByText('生成于 2026/7/22 18:00:00')).toBeInTheDocument();
  expect(screen.getByText('1 项分析限制').closest('details')).toHaveAttribute('open');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.pathname).toBe('/api/v1/geo-insights');
  expect(requests[0]?.searchParams.get('geo_platform')).toBe('DeepSeek');
  expect(requests[0]?.searchParams.get('query_topic_id')).toBe(topicId);
  await userEvent.click(screen.getByRole('button', { name: /打印 \/ 另存为 PDF/ }));
  expect(print).toHaveBeenCalledOnce();
});
