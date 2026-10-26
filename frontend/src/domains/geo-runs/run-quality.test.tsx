import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { insightSearchSchema } from '@/domains/geo-insights/drilldown.model';
import { opportunitySearchSchema } from '@/domains/geo-opportunities/opportunities.model';
import { RunQuality } from './run-quality';
import { detail, runId, batchId } from './runs.test-support';

describe('运行质量与真实后续导航', () => {
  it('依据服务端资格展示，保留各指标排除和未知覆盖，不由运行状态推断', async () => {
    const value = detail();
    value.data_quality = {
      ...value.data_quality, assessment: 'ELIGIBLE', metric_eligible: true, exclusion_reasons: [],
      current_analysis_status: 'COMPLETED', review_status: 'NOT_REQUIRED',
      subjects: [{ subject_id: runId, display_name: '冻结对象', metrics: [
        { metric_code: 'answer_coverage', eligible: true, exclusion_reasons: [] },
        { metric_code: 'accurate_claim_rate', eligible: false, exclusion_reasons: ['ASSESSABLE_CLAIM_UNAVAILABLE'] },
      ] }],
    };
    render(<RunQuality detail={value} />);
    expect(screen.getByText('通用资格：可纳入统计候选')).toBeVisible();
    expect(screen.getByText('费用覆盖').nextElementSibling).toHaveTextContent('未知，不计为零');
    expect(screen.getByText('模型版本覆盖').nextElementSibling).toHaveTextContent('未知');
    await userEvent.click(screen.getByText('冻结对象 · 各指标资格'));
    const table = screen.getByRole('region', { name: '冻结对象指标资格' });
    expect(within(table).getByText('无可判断声明')).toBeVisible();
    expect(within(table).getByText('可纳入')).toBeVisible();
    expect(screen.getByText(/单次运行不代表达到可报告/)).toBeVisible();
  });

  it('复核阻断、历史替代与无关联时均有解释，不产生猜测入口', () => {
    const value = detail();
    value.data_quality.exclusion_reasons = ['CURRENT_REVIEW_REQUIRED', 'SUPERSEDED_ATTEMPT'];
    value.data_quality.review_status = 'REQUIRED';
    render(<RunQuality detail={value} />);
    expect(screen.getByText('仍待人工复核')).toBeVisible();
    expect(screen.getByText('已被后续尝试替代')).toBeVisible();
    expect(screen.getByText('尚无与本运行关联的机会。')).toBeVisible();
    expect(screen.getByText('尚无与本运行批次关联的复测基线或复测。')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('洞察、机会与复测 URL 被实际目标路由识别，保留范围与身份', () => {
    const value = detail();
    const filters = {
      date_from: '2026-10-02T00:00:00Z', date_to: '2026-10-03T00:00:00Z',
      subject_ids: [runId, batchId], product_ids: [], query_topic_ids: [], prompt_variant_ids: [runId],
      engine_surface_ids: [], collection_profile_ids: [batchId], collection_modes: [], language_codes: [],
      region_codes: [], login_states: [], intent_types: [], mention_mode: null, review_policy: 'EFFECTIVE' as const,
    };
    value.navigation = { insights: filters, insights_unavailable_reason: null,
      opportunities: [{ opportunity_id: runId, source_roles: ['TRIGGER', 'SUPPORTING'] }],
      retests: [{ opportunity_id: runId, baseline_id: batchId, retest_batch_id: batchId }],
    };
    render(<RunQuality detail={value} />);
    const url = (name: string | RegExp) => new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'https://partsignal.test');
    const insight = url(/查看同问题与配置的回答洞察/);
    expect(insight.pathname).toBe('/geo/insights/answers');
    const parsed = insightSearchSchema.parse(Object.fromEntries(insight.searchParams));
    expect(parsed.subject_ids).toEqual([runId, batchId]);
    expect(parsed.collection_profile_ids).toEqual([batchId]);
    expect(parsed.date_from).toBe('2026-10-02T00:00:00.000Z');
    expect(parsed.date_to).toBe('2026-10-03T00:00:00.000Z');
    const opportunity = url(/关联机会/);
    expect(opportunitySearchSchema.parse(Object.fromEntries(opportunity.searchParams))).toEqual({ opportunity_id: runId });
    const retest = url(/查看关联复测/);
    expect(opportunitySearchSchema.parse(Object.fromEntries(retest.searchParams))).toEqual({ opportunity_id: runId, retest_batch_id: batchId });
  });
});
