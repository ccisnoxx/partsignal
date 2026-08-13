import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
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
    expect(screen.getByText('提及率下降')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '优先优化内容' })).not.toBeInTheDocument();
    expect(screen.getAllByText('较上一周期 +100%')).toHaveLength(3);
    await userEvent.click(screen.getAllByText('查看精确数据')[0]!);
    expect(screen.getByRole('region', { name: '发现率每日精确数据' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '补充观测' })).toHaveAttribute('href', `/geo/observations/new?queryTopicId=${topicId}&geoPlatform=DeepSeek`);

    await userEvent.selectOptions(screen.getByLabelText('GEO 平台'), 'DeepSeek');
    await userEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onSearchChange).toHaveBeenCalledWith({ from: '2026-07-15', to: '2026-08-13', geoPlatform: 'DeepSeek' });
  });
});
