import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DailyChecklistPage } from './daily-checklist-page';

vi.mock('@/shared/api/client', () => ({
  api: {
    GET: vi.fn().mockResolvedValue({
      data: {
        target_date: '2026-11-28',
        timezone: 'Asia/Shanghai',
        summary: {
          planned_total: 2,
          completed_count: 1,
          pending_count: 1,
          needs_review_count: 0,
          failed_count: 0,
          cancelled_count: 0,
        },
        items: [
          {
            run_id: '00000000-0000-0000-0000-000000000001',
            batch_id: '00000000-0000-0000-0000-000000000002',
            plan_id: null,
            plan_name: '核心基线-每日豆包',
            prompt_variant_id: '00000000-0000-0000-0000-000000000003',
            prompt_text: '工业控制用低功耗运放有哪些选择？',
            prompt_category: 'NATURAL_DEMAND',
            prompt_priority: 'CORE',
            collection_profile_id: '00000000-0000-0000-0000-000000000004',
            profile_name: '豆包网页端',
            platform_name: '豆包',
            web_search_policy: 'REQUIRED',
            require_screenshot: false,
            status: 'PENDING',
            revision: 0,
            entry_kind: 'PLAN_STANDARD',
            is_backfill: false,
            backfill_source: null,
            assignee_id: null,
            assignee_name: '日常运营',
            target_article_publication_id: null,
            effective_at: '2026-11-28T08:00:00Z',
            collected_at: null,
            query_modified: false,
            error_code: null,
            error_summary: null,
            has_answer: false,
            has_brand_or_product_mention: null,
            linked_article_count: 0,
            pending_candidate_link_count: 0,
          },
        ],
        core_plans: [],
        profiles: [],
        prompts: [],
        users: [],
        publications: [],
      },
      response: new Response(null, { status: 200 }),
    }),
    POST: vi.fn(),
    PATCH: vi.fn(),
  },
}));

describe('DailyChecklistPage', () => {
  it('renders checklist summary and pending row action without exposing UUIDs', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DailyChecklistPage csrfToken="csrf-1c" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('工业控制用低功耗运放有哪些选择？')).toBeTruthy();
    expect(screen.getByText('豆包')).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始录入' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成今日清单' })).toBeTruthy();
  });
});
