import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { ContentCampaignDetail } from './campaign.model';
import { CampaignDetailPage } from './campaign-detail-page';

const campaignId = '90000000-0000-4000-8000-000000000001';
const ownerId = '90000000-0000-4000-8000-000000000002';

const baseCampaign: ContentCampaignDetail = {
  id: campaignId,
  name: 'TPS5430 国产替代 GEO 提升',
  description: '覆盖电源选型核心问题',
  target_audience: '工业电源工程师',
  owner: { id: ownerId, username: 'ops', display_name: '运营负责人' },
  priority: 'HIGH',
  status: 'DRAFT',
  start_date: '2026-11-01',
  end_date: '2026-12-31',
  target_metrics: {
    target_content_count: 9,
    target_discovery_rate: null,
    target_mention_rate: null,
    target_recommendation_rate: 0.4,
    target_citation_rate: null,
  },
  budget_amount: '20000',
  budget_currency: 'CNY',
  counts: {
    product_count: 1,
    topic_count: 1,
    platform_count: 1,
    monitoring_plan_count: 0,
    task_count: 0,
    published_article_count: 0,
  },
  workflow_stage: 'DRAFT',
  primary_task: 'ACTIVATE_CAMPAIGN',
  available_actions: ['UPDATE', 'ACTIVATE', 'PLAN_TASKS', 'ARCHIVE', 'DELETE'],
  deletion: { blockers: [] },
  revision: 0,
  created_by: ownerId,
  updated_by: ownerId,
  created_at: '2026-11-27T00:00:00Z',
  updated_at: '2026-11-27T00:00:00Z',
  products: [
    {
      id: '90000000-0000-4000-8000-000000000010',
      brand: 'PartSignal',
      part_number: 'PS-DC36',
      status: 'ACTIVE',
      has_approved_fact: true,
      facts_freshness: 'FRESH',
    },
  ],
  topics: [
    {
      id: '90000000-0000-4000-8000-000000000020',
      canonical_question: 'TPS5430 有哪些国产替代型号？',
      intent_type: 'REPLACEMENT',
      is_active: true,
      description: '',
    },
  ],
  platforms: [
    {
      id: '90000000-0000-4000-8000-000000000030',
      name: '官网',
      is_active: true,
      configuration_complete: true,
    },
  ],
  monitoring_plans: [],
};

afterEach(() => vi.restoreAllMocks());

describe('CampaignDetailPage', () => {
  it('按服务端 available_actions 渲染动作，并执行激活状态转换', async () => {
    const activated: ContentCampaignDetail = {
      ...baseCampaign,
      status: 'ACTIVE',
      workflow_stage: 'ACTIVE',
      primary_task: 'MANAGE_CAMPAIGN',
      available_actions: ['UPDATE', 'PLAN_TASKS', 'PAUSE', 'COMPLETE', 'ARCHIVE'],
      deletion: null,
      revision: 1,
    };
    let current = baseCampaign;
    vi.spyOn(api, 'GET').mockImplementation(async () => ({
      data: current,
      response: Response.json(current),
    }) as never);
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => {
      current = activated;
      return { data: activated, response: Response.json(activated) } as never;
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CampaignDetailPage campaignId={campaignId} csrfToken="csrf-token" onDeleted={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: baseCampaign.name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '批量规划任务' })).toHaveAttribute(
      'href',
      `/content/tasks/batch?campaignId=${campaignId}`,
    );
    expect(screen.getByRole('link', { name: '新建单个任务' })).toHaveAttribute(
      'href',
      `/content/tasks/new?campaignId=${campaignId}`,
    );
    await userEvent.click(screen.getByRole('button', { name: '激活活动' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/content-campaigns/{campaign_id}/activate',
      {
        body: { expected_revision: 0 },
        params: { path: { campaign_id: campaignId }, header: { 'X-CSRF-Token': 'csrf-token' } },
      },
    ));
    expect(await screen.findByRole('button', { name: '暂停活动' })).toBeInTheDocument();
  });
});
