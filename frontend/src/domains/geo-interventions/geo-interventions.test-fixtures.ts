import type { GeoInterventionOut } from './geo-intervention.model';

export const campaignId = '91000000-0000-4000-8000-000000000001';
export const archivedCampaignId = '91000000-0000-4000-8000-000000000002';
export const opportunityId = '91000000-0000-4000-8000-000000000010';
export const interventionId = '91000000-0000-4000-8000-000000000020';
export const baselineId = '91000000-0000-4000-8000-000000000030';
export const decisionId = '91000000-0000-4000-8000-000000000040';
export const userId = '91000000-0000-4000-8000-000000000050';

export function makeIntervention(overrides: Partial<GeoInterventionOut> = {}): GeoInterventionOut {
  return {
    id: interventionId,
    opportunity_id: opportunityId,
    opportunity_rule_code: 'RECOMMENDATION_DROP',
    opportunity_status: 'IN_PROGRESS',
    campaign_id: campaignId,
    campaign_name: 'TPS5430 国产替代活动',
    title: '补充热阻与效率对比文章',
    hypothesis: '增加知乎与官网的实测对比内容后，自有推荐率有望提升',
    planned_action_type: 'CONTENT_TASK',
    target_metrics: {
      target_discovery_rate: null,
      target_mention_rate: 0.5,
      target_recommendation_rate: 0.4,
      target_citation_rate: null,
      target_accuracy_rate: null,
    },
    status: 'ACTIVE',
    outcome_verdict: null,
    causal_claim: 'NOT_ESTABLISHED',
    baseline_id: baselineId,
    decision_id: null,
    assignee_id: userId,
    assignee_display_name: '运营甲',
    intervened_at: '2026-11-26T08:00:00Z',
    retest_window_start: '2026-11-27T00:00:00Z',
    retest_window_end: '2026-12-03T00:00:00Z',
    concluded_at: null,
    conclusion_note: '',
    revision: 2,
    created_by: userId,
    updated_by: userId,
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-26T10:00:00Z',
    available_actions: ['UPDATE', 'CONCLUDE', 'CANCEL'],
    attribution: {
      causal_claim: 'NOT_ESTABLISHED',
      comparable: true,
      comparability_reasons: [],
      baseline_batch_id: baselineId,
      retest_batch_id: decisionId,
      baseline_sample_count: 10,
      baseline_completed_run_count: 10,
      retest_sample_count: 10,
      retest_completed_run_count: 9,
      missing_data_rate: 0.05,
      metric_deltas: [
        {
          metric_code: 'recommendation_rate',
          baseline_value: 0.2,
          retest_value: 0.45,
          delta: 0.25,
          target_value: 0.4,
          target_met: true,
          baseline_sample_size: 10,
          retest_sample_size: 20,
          baseline_ci: {
            lower: 0.056682,
            upper: 0.509838,
            confidence_level: 0.95,
            method: 'WILSON_95',
            sample_size: 10,
          },
          retest_ci: {
            lower: 0.258246,
            upper: 0.657943,
            confidence_level: 0.95,
            method: 'WILSON_95',
            sample_size: 20,
          },
          delta_ci: {
            lower: -0.114084,
            upper: 0.505008,
            confidence_level: 0.95,
            method: 'NEWCOMBE_WILSON_95',
            excludes_zero: false,
          },
        },
      ],
      linked_actions: [],
      linked_content_task_ids: [],
      linked_published_article_ids: [],
    },
    ...overrides,
  };
}

export function makeComparisonPayload() {
  return {
    opportunity_id: opportunityId,
    opportunity_revision: 1,
    opportunity: {
      id: opportunityId,
      title: 'TPS5430 推荐率下降',
      status: 'IN_PROGRESS',
    },
    as_of: '2026-11-27T10:00:00Z',
    retests: [
      {
        batch_id: '91000000-0000-4000-8000-000000000031',
        baseline_id: baselineId,
        baseline_batch_id: '91000000-0000-4000-8000-000000000032',
        created_at: '2026-11-27T08:00:00Z',
        status: 'COMPLETED',
      },
    ],
    selected_retest_batch_id: '91000000-0000-4000-8000-000000000031',
    comparison: null,
    decisions: [
      {
        id: decisionId,
        opportunity_id: opportunityId,
        decision: 'RETEST_RESOLVE',
        reason_code: 'RECOVERED_IN_RETEST',
        reason_comment: '复测窗口达标',
        revision_before: 1,
        revision_after: 2,
        retest_batch_id: '91000000-0000-4000-8000-000000000031',
        comparison_fingerprint: null,
        comparison_snapshot: null,
        created_by: userId,
        created_at: '2026-11-27T09:00:00Z',
      },
    ],
  };
}

export function makeErrorResult(status: number, code: string, message: string) {
  return {
    error: { error: { code, message, details: {}, request_id: 'req-geo-int' } },
    response: new Response(null, { status }),
  } as never;
}
