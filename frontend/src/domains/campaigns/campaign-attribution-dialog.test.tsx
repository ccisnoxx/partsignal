import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditActionLabel,
  parseAuditLogDetailResponse,
  projectAuditFacts,
} from '@/domains/audit/audit.model';
import { AIModelPricingButton } from '@/domains/configuration/ai-model-pricing-dialog';
import { WorkbenchOperationsMetricsButton } from '@/domains/workbench/workbench-operations-metrics-dialog';
import { api } from '@/shared/api/client';
import { CampaignAttributionDialogButton } from './campaign-attribution-dialog';

const campaignId = '90000000-0000-4000-8000-000000000011';
const modelId = '90000000-0000-4000-8000-000000000022';
const channelId = '90000000-0000-4000-8000-000000000023';
const entryId = '90000000-0000-4000-8000-000000000033';
const userId = '90000000-0000-4000-8000-000000000044';

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Slice 4C 看板、定价弹窗与 Phase 4 审计投影', () => {
  it('归因与成本看板保持懒加载，打开后展示非强因果、多币种成本与运营台账登记/作废', async () => {
    const getSpy = vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/campaigns/{campaign_id}/attribution-dashboard') {
        return {
          data: {
            campaign_id: campaignId,
            campaign_name: 'TPS5430 国产替代活动',
            campaign_status: 'ACTIVE',
            causal_claim: 'NOT_ESTABLISHED',
            window_days: 30,
            generated_at: '2026-11-27T12:00:00Z',
            production: {
              task_count: 4,
              approved_task_count: 3,
              published_article_count: 2,
              first_pass_review_rate: 0.75,
              avg_draft_to_approval_hours: 3.5,
              avg_approval_to_publish_hours: 1.5,
              avg_publish_to_verify_hours: 0.5,
              near_duplicate_version_count: 1,
              overdue_fact_product_count: 1,
            },
            publishing_health: {
              published_article_count: 2,
              healthy_articles: 1,
              fetch_blocked_articles: 0,
              confirmed_anomaly_articles: 1,
              unchecked_articles: 0,
              open_issues: 1,
              resolved_issues: 0,
              avg_issue_resolution_hours: null,
            },
            geo_attribution: {
              causal_claim: 'NOT_ESTABLISHED',
              sample_count: 10,
              completed_run_count: 8,
              missing_data_rate: 0.2,
              mention_rate: 0.5,
              recommendation_rate: 0.25,
              citation_rate: 0.375,
              accuracy_rate: 1.0,
              open_opportunity_count: 1,
              resolved_opportunity_count: 0,
              linked_intervention_count: 1,
              concluded_intervention_count: 0,
            },
            cost_coverage: {
              total_ai_jobs: 4,
              priced_ai_jobs: 2,
              unpriced_ai_jobs: 2,
              missing_price_rate: 0.5,
              total_geo_runs: 10,
              priced_geo_runs: 8,
              missing_geo_price_rate: 0.2,
            },
            costs_by_currency: [
              {
                currency: 'CNY',
                ai_generation_cost: '0',
                ai_semantic_check_cost: '0',
                geo_collection_cost: '0',
                labor_cost: '600',
                external_placement_cost: '0',
                other_operating_cost: '0',
                total_ai_cost: '0',
                total_operating_cost: '600',
                total_cost: '600',
              },
              {
                currency: 'USD',
                ai_generation_cost: '0.12',
                ai_semantic_check_cost: '0.03',
                geo_collection_cost: '0.5',
                labor_cost: '0',
                external_placement_cost: '0',
                other_operating_cost: '0',
                total_ai_cost: '0.65',
                total_operating_cost: '0',
                total_cost: '0.65',
              },
            ],
            unit_economics_by_currency: [
              {
                currency: 'CNY',
                cost_per_approved_content: '200',
                cost_per_published_article: '300',
                cost_per_geo_sample: '0',
                cost_per_resolved_opportunity: null,
              },
            ],
          },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items: [], total: 0, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/cost-entries') {
        return {
          data: {
            items: [
              {
                id: entryId,
                campaign_id: campaignId,
                campaign_name: 'TPS5430 国产替代活动',
                geo_intervention_id: null,
                geo_intervention_title: null,
                category: 'LABOR',
                amount: '600',
                currency: 'CNY',
                incurred_on: '2026-11-27',
                note: 'FAE 技术校对',
                is_voided: false,
                voided_at: null,
                voided_by: null,
                voided_by_name: null,
                void_reason: null,
                created_by: userId,
                created_by_name: '管理员',
                created_at: '2026-11-27T10:00:00Z',
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
          },
          response: new Response(null, { status: 200 }),
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    }) as typeof api.GET);

    const postSpy = vi.spyOn(api, 'POST').mockResolvedValue({
      data: {
        id: entryId,
        campaign_id: campaignId,
        campaign_name: 'TPS5430 国产替代活动',
        geo_intervention_id: null,
        geo_intervention_title: null,
        category: 'LABOR',
        amount: '600',
        currency: 'CNY',
        incurred_on: '2026-11-27',
        note: 'FAE 技术校对',
        is_voided: true,
        voided_at: '2026-11-27T12:10:00Z',
        voided_by: userId,
        voided_by_name: '管理员',
        void_reason: '重复录入',
        created_by: userId,
        created_by_name: '管理员',
        created_at: '2026-11-27T10:00:00Z',
      },
      response: new Response(null, { status: 200 }),
    } as never);

    const user = userEvent.setup();
    wrap(
      <CampaignAttributionDialogButton
        campaignId={campaignId}
        campaignName="TPS5430 国产替代活动"
        campaignStatus="ACTIVE"
        csrfToken="csrf-4c"
      />,
    );

    // 懒加载：点击前零请求
    expect(getSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '归因与成本看板' }));

    await waitFor(() => {
      expect(screen.getByText('非强因果 · NOT_ESTABLISHED')).toBeInTheDocument();
    });
    expect(screen.getByText('CNY 汇总：600')).toBeInTheDocument();
    expect(screen.getByText('USD 汇总：0.65')).toBeInTheDocument();
    expect(screen.getByText(/AI 作业未定价率：50.0%/)).toBeInTheDocument();

    // 作废费用台账
    await user.click(screen.getByRole('button', { name: '作废' }));
    await user.type(screen.getByLabelText('作废原因'), '重复录入');
    await user.click(screen.getByRole('button', { name: '确认作废' }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/cost-entries/{entry_id}/void',
        expect.objectContaining({
          params: expect.objectContaining({
            header: { 'X-CSRF-Token': 'csrf-4c' },
          }),
          body: { reason: '重复录入' },
        }),
      );
    });
  });

  it('工作台经营指标弹窗展示内容衰退预警与跳转链接', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: {
        causal_claim: 'NOT_ESTABLISHED',
        window_days: 30,
        generated_at: '2026-11-27T12:00:00Z',
        active_campaign_count: 2,
        production: {
          task_count: 5,
          approved_task_count: 4,
          published_article_count: 3,
          first_pass_review_rate: 0.8,
          avg_draft_to_approval_hours: 2.0,
          avg_approval_to_publish_hours: 1.0,
          avg_publish_to_verify_hours: 0.5,
          near_duplicate_version_count: 0,
          overdue_fact_product_count: 1,
        },
        publishing_health: {
          published_article_count: 3,
          healthy_articles: 2,
          fetch_blocked_articles: 0,
          confirmed_anomaly_articles: 1,
          unchecked_articles: 0,
          open_issues: 1,
          resolved_issues: 1,
          avg_issue_resolution_hours: 4.0,
        },
        geo_attribution: {
          causal_claim: 'NOT_ESTABLISHED',
          sample_count: 12,
          completed_run_count: 12,
          missing_data_rate: 0,
          mention_rate: 0.5,
          recommendation_rate: 0.25,
          citation_rate: 0.25,
          accuracy_rate: 0.9,
          open_opportunity_count: 1,
          resolved_opportunity_count: 2,
          linked_intervention_count: 2,
          concluded_intervention_count: 1,
        },
        cost_coverage: {
          total_ai_jobs: 2,
          priced_ai_jobs: 2,
          unpriced_ai_jobs: 0,
          missing_price_rate: 0,
          total_geo_runs: 12,
          priced_geo_runs: 12,
          missing_geo_price_rate: 0,
        },
        costs_by_currency: [],
        unit_economics_by_currency: [],
        decay_alerts: [
          {
            kind: 'OVERDUE_FACT',
            severity: 'HIGH',
            target_type: 'Product',
            target_id: campaignId,
            title: 'PartSignal TPS5430 事实复核已逾期',
            detail: '原定复核时间已超期',
            navigation_path: `/products/${campaignId}/facts`,
          },
        ],
      },
      response: new Response(null, { status: 200 }),
    } as never);

    const user = userEvent.setup();
    wrap(<WorkbenchOperationsMetricsButton />);
    await user.click(screen.getByRole('button', { name: '经营指标与衰退预警' }));

    await waitFor(() => {
      expect(screen.getByText('PartSignal TPS5430 事实复核已逾期')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: '前往处理' })).toHaveAttribute(
      'href',
      `/products/${campaignId}/facts`,
    );
  });

  it('AI 模型定价弹窗支持携带 expected_revision 保存单价', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: {
        model_id: modelId,
        channel_id: channelId,
        display_name: 'GPT-4o Mini',
        provider_model_id: 'gpt-4o-mini',
        input_price_per_1m_tokens: null,
        output_price_per_1m_tokens: null,
        price_currency: null,
        pricing_configured: false,
        revision: 3,
        updated_at: '2026-11-27T10:00:00Z',
      },
      response: new Response(null, { status: 200 }),
    } as never);

    const patchSpy = vi.spyOn(api, 'PATCH').mockResolvedValue({
      data: {
        model_id: modelId,
        channel_id: channelId,
        display_name: 'GPT-4o Mini',
        provider_model_id: 'gpt-4o-mini',
        input_price_per_1m_tokens: '1.5',
        output_price_per_1m_tokens: '6',
        price_currency: 'USD',
        pricing_configured: true,
        revision: 4,
        updated_at: '2026-11-27T10:05:00Z',
      },
      response: new Response(null, { status: 200 }),
    } as never);

    const user = userEvent.setup();
    wrap(
      <AIModelPricingButton
        csrfToken="csrf-price"
        modelDisplayName="GPT-4o Mini"
        modelId={modelId}
      />,
    );
    await user.click(screen.getByRole('button', { name: '定价' }));

    await waitFor(() => {
      expect(screen.getByText('当前模型版本：r3')).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('如 2.5'), '1.5');
    await user.type(screen.getByPlaceholderText('如 10.0'), '6');
    await user.click(screen.getByRole('button', { name: '保存单价' }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        '/api/v1/ai-models/{model_id}/pricing',
        expect.objectContaining({
          params: expect.objectContaining({
            header: { 'X-CSRF-Token': 'csrf-price' },
          }),
          body: {
            input_price_per_1m_tokens: '1.5',
            output_price_per_1m_tokens: '6',
            price_currency: 'USD',
            expected_revision: 3,
          },
        }),
      );
    });
  });

  it('Phase 4 全部 7 个新增审计动作与全部事实字段均可通过前端安全投影', () => {
    const cases: Array<{
      module: 'GEO_OBSERVATION' | 'CONFIGURATION' | 'CONTENT_PLANNING';
      action: string;
      targetType: string;
      facts: Record<string, string | number | boolean | null>;
      relatedStatus: 'AVAILABLE' | 'UNSUPPORTED';
      parentId?: string | null;
    }> = [
      {
        module: 'GEO_OBSERVATION',
        action: 'geo_intervention.created',
        targetType: 'GeoIntervention',
        facts: { opportunity_id: campaignId, campaign_id: campaignId, status: 'PLANNED', revision: 0 },
        relatedStatus: 'UNSUPPORTED',
      },
      {
        module: 'GEO_OBSERVATION',
        action: 'geo_intervention.updated',
        targetType: 'GeoIntervention',
        facts: { opportunity_id: campaignId, campaign_id: null, status: 'ACTIVE', revision: 1 },
        relatedStatus: 'UNSUPPORTED',
      },
      {
        module: 'GEO_OBSERVATION',
        action: 'geo_intervention.concluded',
        targetType: 'GeoIntervention',
        facts: {
          opportunity_id: campaignId,
          campaign_id: campaignId,
          status: 'CONCLUDED',
          outcome_verdict: 'TARGET_MET',
          revision: 2,
        },
        relatedStatus: 'UNSUPPORTED',
      },
      {
        module: 'GEO_OBSERVATION',
        action: 'geo_intervention.cancelled',
        targetType: 'GeoIntervention',
        facts: { opportunity_id: campaignId, campaign_id: null, status: 'CANCELLED', revision: 1 },
        relatedStatus: 'UNSUPPORTED',
      },
      {
        module: 'CONFIGURATION',
        action: 'ai_model.pricing_updated',
        targetType: 'AIModel',
        facts: { channel_id: channelId, price_currency: 'USD', pricing_configured: true, revision: 4 },
        relatedStatus: 'AVAILABLE',
        parentId: channelId,
      },
      {
        module: 'CONTENT_PLANNING',
        action: 'operating_cost_entry.created',
        targetType: 'OperatingCostEntry',
        facts: { campaign_id: campaignId, geo_intervention_id: null, category: 'LABOR', currency: 'CNY' },
        relatedStatus: 'UNSUPPORTED',
      },
      {
        module: 'CONTENT_PLANNING',
        action: 'operating_cost_entry.voided',
        targetType: 'OperatingCostEntry',
        facts: {
          campaign_id: campaignId,
          geo_intervention_id: null,
          category: 'LABOR',
          currency: 'CNY',
          reason: '误录作废',
        },
        relatedStatus: 'UNSUPPORTED',
      },
    ];

    for (const item of cases) {
      expect(auditActionLabel(item.action).length).toBeGreaterThan(0);
      const logId = '20000000-0000-4000-8000-000000000099';
      const parsed = parseAuditLogDetailResponse({
        id: logId,
        actor_id: userId,
        actor: { id: userId, display_name: '管理员', account_type: 'ADMIN' },
        business_module: item.module,
        action: item.action,
        target_type: item.targetType,
        target_id: modelId,
        outcome: 'SUCCESS',
        primary_task: 'VIEW_LOG_DETAIL',
        request_id: 'req-phase4-audit',
        created_at: '2026-11-27T12:00:00Z',
        changes: [],
        facts: item.facts,
        result_message: 'ok',
        error_code: null,
        related_entry:
          item.relatedStatus === 'AVAILABLE'
            ? { status: 'AVAILABLE', kind: item.targetType, parent_id: item.parentId ?? null }
            : { status: 'UNSUPPORTED', kind: null, parent_id: null },
      }, logId);
      const projected = projectAuditFacts(parsed.facts);
      expect(projected.length).toBe(Object.keys(item.facts).length);
    }
  });
});
