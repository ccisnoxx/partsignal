import { describe, expect, it } from 'vitest';

import {
  campaignFormSchema,
  campaignsSearchSchema,
  defaultCampaignFormValues,
  toCampaignCreatePayload,
  toCampaignUpdatePayload,
} from './campaign.model';

const ownerId = '00000000-0000-4000-8000-000000000001';
const productId = '00000000-0000-4000-8000-000000000002';
const topicId = '00000000-0000-4000-8000-000000000003';
const platformId = '00000000-0000-4000-8000-000000000004';

describe('campaign.model', () => {
  it('校验预算成对出现与日期范围，并将百分比目标转为 0..1 比率', () => {
    const valid = campaignFormSchema.parse({
      ...defaultCampaignFormValues(ownerId),
      name: '  TPS5430 国产替代 GEO 活动  ',
      priority: 'HIGH',
      start_date: '2026-11-01',
      end_date: '2026-12-31',
      budget_amount: '15000.50',
      budget_currency: 'cny',
      target_content_count: '12',
      target_recommendation_pct: '40',
      product_ids: [productId],
      query_topic_ids: [topicId],
      platform_profile_ids: [platformId],
    });
    const payload = toCampaignCreatePayload(valid);
    expect(payload.name).toBe('TPS5430 国产替代 GEO 活动');
    expect(payload.budget_amount).toBe('15000.50');
    expect(payload.budget_currency).toBe('CNY');
    expect(payload.target_metrics).toEqual({
      target_content_count: 12,
      target_discovery_rate: null,
      target_mention_rate: null,
      target_recommendation_rate: 0.4,
      target_citation_rate: null,
    });
    expect(toCampaignUpdatePayload(valid, 3).expected_revision).toBe(3);

    expect(campaignFormSchema.safeParse({
      ...defaultCampaignFormValues(ownerId),
      name: '测试',
      budget_amount: '100',
      budget_currency: '',
    }).success).toBe(false);

    expect(campaignFormSchema.safeParse({
      ...defaultCampaignFormValues(ownerId),
      name: '测试',
      start_date: '2026-12-01',
      end_date: '2026-11-01',
    }).success).toBe(false);
  });

  it('规范化搜索参数默认值', () => {
    expect(campaignsSearchSchema.parse({ q: '  TPS5430  ', status: 'ACTIVE', priority: 'CRITICAL' }))
      .toEqual({ q: 'TPS5430', status: 'ACTIVE', priority: 'CRITICAL', page: 1, pageSize: 20 });
  });
});
