import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeadershipDashboardPage } from './leadership-dashboard-page';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const mockGet = vi.fn();

vi.mock('@/shared/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockGet(...args),
    POST: vi.fn(),
  },
}));

const sampleDashboard = {
  as_of: '2026-11-28T10:00:00Z',
  period_from: '2026-11-22T00:00:00Z',
  period_to: '2026-11-28T23:59:59Z',
  bucket_granularity: 'DAY' as const,
  comparability_warnings: ['固定核心问题尚有 1 题未采样，请结合缺口谨慎解读趋势。'],
  summary_cards: {
    perspective: 'COMPANY' as const,
    selected_product_label: null,
    natural_mention_rate: {
      numerator: 3,
      denominator: 5,
      rate: 0.6,
      ci_95: { lower: 0.23, upper: 0.88, sample_size: 5, method: 'WILSON_95' as const },
      previous_numerator: 2,
      previous_denominator: 5,
      previous_rate: 0.4,
      delta_pp: 20.0,
      delta_ci_95: null,
    },
    brand_mention_breakdown: {
      numerator: 3,
      denominator: 5,
      rate: 0.6,
      ci_95: null,
      previous_numerator: 0,
      previous_denominator: 0,
      previous_rate: null,
      delta_pp: null,
      delta_ci_95: null,
    },
    product_mention_breakdown: {
      numerator: 2,
      denominator: 5,
      rate: 0.4,
      ci_95: null,
      previous_numerator: 0,
      previous_denominator: 0,
      previous_rate: null,
      delta_pp: null,
      delta_ci_95: null,
    },
    article_citation_hit_rate: {
      numerator: 0,
      denominator: 0,
      rate: null,
      ci_95: null,
      previous_numerator: 0,
      previous_denominator: 0,
      previous_rate: null,
      delta_pp: null,
      delta_ci_95: null,
    },
    citation_unobserved_count: 2,
    core_question_coverage: {
      hit_questions: 1,
      sampled_questions: 1,
      total_core_questions: 2,
      unsampled_questions: 1,
      coverage_rate: 0.5,
    },
    first_cited_articles: {
      first_cited_count: 1,
      total_cited_publications_in_period: 1,
      note: '系统观测历史内首次观察到被引用，不代表全网历史首次',
    },
    recommendation_rate: {
      numerator: 1,
      denominator: 2,
      rate: 0.5,
      ci_95: null,
      previous_numerator: 0,
      previous_denominator: 0,
      previous_rate: null,
      delta_pp: null,
      delta_ci_95: null,
    },
    recommendation_unknown_count: 1,
  },
  trend_series: [
    {
      bucket_key: '2026-11-27',
      label: '11-27',
      mention_numerator: 0,
      mention_denominator: 0,
      natural_mention_rate: null,
      citation_numerator: 0,
      citation_denominator: 0,
      citation_hit_rate: null,
    },
  ],
  platform_comparisons: [
    {
      surface_id: '00000000-0000-0000-0000-000000000011',
      platform_name: '豆包',
      collection_mode: 'MANUAL',
      mention_numerator: 3,
      mention_denominator: 5,
      natural_mention_rate: 0.6,
      mention_ci_95: null,
      citation_numerator: 0,
      citation_denominator: 0,
      citation_hit_rate: null,
      needs_review_count: 1,
      failed_count: 0,
    },
  ],
  question_platform_matrix: [
    {
      prompt_variant_id: '00000000-0000-0000-0000-000000000021',
      prompt_text: '工业控制用低功耗运放有哪些选择？',
      prompt_priority: 'CORE',
      cells: [
        {
          surface_id: '00000000-0000-0000-0000-000000000011',
          platform_name: '豆包',
          valid_count: 5,
          mention_hit_count: 3,
          citation_hit_count: 1,
          needs_review_count: 0,
          failed_count: 0,
          run_ids: ['00000000-0000-0000-0000-000000000099'],
        },
      ],
    },
  ],
  article_performance: [],
  brand_model_section: {
    category: 'BRAND_MODEL' as const,
    total_runs: 1,
    valid_completed_runs: 1,
    mention_hit_runs: 1,
    citation_hit_runs: 0,
    needs_review_runs: 0,
    failed_runs: 0,
  },
  article_lookup_section: {
    category: 'ARTICLE_LOOKUP' as const,
    total_runs: 0,
    valid_completed_runs: 0,
    mention_hit_runs: 0,
    citation_hit_runs: 0,
    needs_review_runs: 0,
    failed_runs: 0,
  },
  data_quality: {
    planned_total: 6,
    completed_valid_count: 5,
    needs_review_count: 1,
    pending_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    query_modified_excluded_count: 0,
    exploratory_excluded_count: 0,
    backfill_count: 1,
    citation_partial_or_unknown_count: 2,
    pending_candidate_links_count: 1,
  },
  evidence_run_ids: ['00000000-0000-0000-0000-000000000099'],
};

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/api/v1/geo/leadership-dashboard/filter-options') {
      return {
        data: {
          products: [{ id: 'p-1', label: 'OPA2333 工业低功耗运放', meta: 'PartSignal' }],
          platforms: [{ id: 's-1', label: '豆包', meta: 'MANUAL' }],
          core_plans: [],
        },
        response: new Response(null, { status: 200 }),
      };
    }
    if (path === '/api/v1/geo/leadership-dashboard/evidence') {
      return {
        data: {
          items: [
            {
              run_id: '00000000-0000-0000-0000-000000000099',
              effective_at: '2026-11-28T08:00:00Z',
              collected_at: '2026-11-28T08:00:00Z',
              registered_at: '2026-11-28T08:05:00Z',
              status: 'COMPLETED',
              entry_kind: 'PLAN_STANDARD',
              is_backfill: false,
              backfill_source: null,
              platform_name: '豆包',
              collection_mode: 'MANUAL',
              prompt_category: 'NATURAL_DEMAND',
              prompt_text: '工业控制用低功耗运放有哪些选择？',
              actual_prompt_text: null,
              query_modified: false,
              answer_text: '推荐参考 PartSignal 的 OPA2333 运放方案。',
              screenshot_file_id: null,
              web_search_observed: true,
              citation_observation_status: 'OBSERVED_COMPLETE',
              recorder_name: '日常运营',
              mentioned_brand: true,
              mentioned_product: true,
              recommended: true,
              citation_links: [],
              error_code: null,
              error_summary: null,
            },
          ],
          total: 1,
        },
        response: new Response(null, { status: 200 }),
      };
    }
    return { data: sampleDashboard, response: new Response(null, { status: 200 }) };
  });
});

describe('LeadershipDashboardPage', () => {
  it('renders 4 core cards, null-rate gaps, pp deltas, and hides freeze button for VIEWER', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LeadershipDashboardPage canOperate={false} csrfToken={null} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('60.0%')).toBeTruthy();
    expect(screen.getByText('较上期 +20.0 个百分点')).toBeTruthy();
    expect(screen.getAllByText('暂无数据').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('— 断线（暂无样本）')).toBeTruthy();
    expect(screen.getByText('待判断 1 条')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '冻结周报快照' })).toBeNull();
  });

  it('shows freeze button for operators and opens evidence drawer on matrix cell click', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LeadershipDashboardPage canOperate csrfToken="csrf-1d" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: '冻结周报快照' })).toBeTruthy();
    const cellButton = await screen.findByRole('button', { name: /提及 3\/5/ });
    fireEvent.click(cellButton);

    expect(await screen.findByText('推荐参考 PartSignal 的 OPA2333 运放方案。')).toBeTruthy();
  });
});
