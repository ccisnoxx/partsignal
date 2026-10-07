import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '@/shared/api/generated/schema';
import { CitationInsights, FactRisks, InsightDataQuality } from './evidence-sections';
import type { AnswerInsights } from './insights.model';

type Schema = components['schemas'];
const filters: AnswerInsights['filters'] = {
  date_from: '2026-09-01T00:00:00Z', date_to: '2026-10-01T00:00:00Z', review_policy: 'REVIEWED_ONLY',
  subject_ids: ['subject-a', 'subject-b'], product_ids: ['product-a'], query_topic_ids: ['topic-a'],
  prompt_variant_ids: ['prompt-a'], engine_surface_ids: ['surface-a'], collection_profile_ids: ['profile-a'],
  collection_modes: ['MANUAL'], login_states: ['ANONYMOUS'], intent_types: ['PRODUCT'],
  language_codes: ['zh-CN'], region_codes: ['CN'], mention_mode: 'UNBRANDED',
};
function cell(cellKey = 'cell-a', language = 'zh-CN'): AnswerInsights['current_cells'][number] {
  return {
    cell_key: cellKey, subject_id: 'subject-a', product_id: 'product-a', display_name: '监测产品',
    selected_subject: true, sov_subject_ids: ['subject-a', 'subject-b'], metrics: [],
    dimensions: {
      query_topic_id: 'topic-a', query_topic_revision: 2, prompt_variant_id: 'prompt-a', prompt_revision: 3,
      collection_profile_id: 'profile-a', profile_revision: 4, engine_surface_id: 'surface-a', surface_revision: 5,
      collection_mode: 'MANUAL', language_code: language, region_code: 'CN', login_state: 'ANONYMOUS',
      mention_mode: 'UNBRANDED', intent_type: 'PRODUCT', source_model: null, source_product: 'provider-product',
      model_version: null, product_version: 'product-v3', rule_set_version: 'rules-v2',
      analysis_configuration_key: 'analysis-fingerprint', subject_versions: [['subject-a', 7], ['subject-b', 4]],
      fact_version_bindings: [['subject-a', 'fact-v8']], window_key: `window:${cellKey}`,
    },
  };
}
function citationDescriptor(cellKey = 'cell-a'): Schema['GeoInsightCitationDrilldown'] {
  return { operation_id: 'listGeoInsightCitations', filters, cell_key: cellKey, hostname: null, normalized_url: null, source_category: null };
}
function qualityDescriptor(qualityCode: Schema['GeoInsightQualityDrilldown']['quality_code']): Schema['GeoInsightQualityDrilldown'] {
  return { operation_id: 'listGeoInsightQualityRuns', filters, quality_code: qualityCode, cohort: 'CANDIDATE', exclusion_reason: null, version_key: null, currency: null };
}
function bucket(key = 'example.com', descriptor = citationDescriptor()): Schema['GeoInsightCitationBucket'] {
  return { key, citation_count: 2, run_count: 1, coverage_value: 0.888, coverage_denominator: 13,
    share_value: null, share_denominator: 0, query_topic_ids: ['topic-a'], engine_surface_ids: ['surface-a'], drilldown: descriptor };
}
function insights(): AnswerInsights {
  return {
    as_of: '2026-10-01T00:00:00Z', filters,
    current_window: { date_from: filters.date_from, date_to: filters.date_to },
    previous_window: { date_from: '2026-08-02T00:00:00Z', date_to: filters.date_from },
    current_cells: [cell()], previous_cells: [], trends: [], product_matrix_cell_keys: [], question_coverage: [],
    platform_performance: [], competitor_sov_cell_keys: [], unavailable_sections: [],
    citation_insights: [{ cell_key: 'cell-a', subject_id: 'subject-a', citation_count: 2, domains: [bucket()],
      urls: [], source_categories: [bucket('UNKNOWN')], drilldown: citationDescriptor() }],
    fact_risks: [{ cell_key: 'cell-a', subject_id: 'subject-a', claim_count: 3,
      verdict_counts: { ACCURATE: 0, PARTIAL: 1, INCORRECT: 1, UNJUDGEABLE: 1 },
      incorrect_severity_counts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
      groups: [{ claim_kind: 'PARAMETER', verdict: 'UNJUDGEABLE', severity: 'HIGH', claim_count: 1, run_count: 1,
        drilldown: { operation_id: 'listGeoInsightClaims', filters, cell_key: 'cell-a', claim_kind: 'PARAMETER', verdict: 'UNJUDGEABLE', severity: 'HIGH' } }],
      drilldown: { operation_id: 'listGeoInsightClaims', filters, cell_key: 'cell-a', verdict: null, severity: null, claim_kind: null } }],
    data_quality: {
      overview: { candidate_run_count: 8, eligible_run_count: 3, excluded_run_count: 5, dimension_count: 2,
        status_counts: { COMPLETED: 6, FAILED: 2 }, exclusion_reason_counts: [{ code: 'CURRENT_REVIEW_REQUIRED', run_count: 5 }, { code: 'CURRENT_ANALYSIS_UNAVAILABLE', run_count: 2 }],
        cards: [{ metric_code: 'review_backlog', formula_version: 'geo-quality-v1', value: null, numerator: 0, denominator: 0,
          sample_level: 'NONE', eligible_run_count: 3, excluded_run_count: 5, exclusion_reason_counts: [], unjudgeable_claim_count: 1,
          unavailable_reason: 'NO_DENOMINATOR', drilldown: { operation_id: 'listGeoOverviewRuns', filters, metric_code: 'review_backlog', cell_key: null, cohort: 'DENOMINATOR', batch_id: null } }],
      },
      shared_domain_run_count: 2, shared_domain_citation_count: 4, shared_domain_drilldown: qualityDescriptor('shared_domain'),
      excluded_drilldown: { ...qualityDescriptor('eligible_runs'), cohort: 'EXCLUDED' },
      known_costs: [{ currency: 'USD', known_run_count: 2, total_amount: '9007199254740993.123400', average_amount: '4503599627370496.561700',
        drilldown: { ...qualityDescriptor('cost_coverage'), currency: 'USD', cohort: 'NUMERATOR' } },
      { currency: 'CNY', known_run_count: 1, total_amount: '0.000000', average_amount: '0.000000',
        drilldown: { ...qualityDescriptor('cost_coverage'), currency: 'CNY', cohort: 'NUMERATOR' } }],
      collection_versions: [{ version_key: 'collection-unknown', source_model: null, source_product: 'provider-product', source_version: null,
        analyzer_version: null, rule_set_version: null, analysis_configuration_key: null, run_count: 2,
        drilldown: { ...qualityDescriptor('collection_version'), version_key: 'collection-unknown' } }],
      analysis_versions: [{ version_key: 'analysis-v2', source_model: null, source_product: null, source_version: null,
        analyzer_version: 'analyzer-v2', rule_set_version: 'rules-v2', analysis_configuration_key: 'analysis-fingerprint', run_count: 4,
        drilldown: { ...qualityDescriptor('analysis_version'), version_key: 'analysis-v2' } }],
      notes: ['SHARED_DOMAIN', 'REVIEW_BACKLOG', 'COST_UNKNOWN', 'MODEL_VERSION_UNKNOWN', 'MIXED_COLLECTION_VERSIONS', 'MIXED_ANALYSIS_VERSIONS', 'MULTIPLE_DIMENSIONS'],
    },
  };
}

describe('回答洞察证据区块', () => {
  it('引用表保留服务端比例、独立分母和 null，原样传递完整下钻 descriptor', async () => {
    const user = userEvent.setup();
    const data = insights();
    const descriptor = { ...citationDescriptor(), hostname: 'example.com', source_category: 'UNKNOWN' as const };
    data.citation_insights[0]!.domains[0]!.drilldown = descriptor;
    const onDrilldown = vi.fn();
    render(<CitationInsights insights={data} onDrilldown={onDrilldown} />);

    const region = screen.getByRole('region', { name: '域名 · cell-a' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table');
    expect(table).toHaveAccessibleName(/覆盖率分母为合格运行/);
    expect(within(table).getByRole('columnheader', { name: '不同运行数' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: /^88\.8%\s*分母：13$/ })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: /^不可计算 · 无可用样本\s*分母：0$/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '未知来源' })).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '引用明细：example.com' }));
    expect(onDrilldown).toHaveBeenCalledOnce();
    expect(onDrilldown.mock.calls[0]![0]).toBe(descriptor);
    expect(onDrilldown.mock.calls[0]![0].filters).toEqual(filters);
  });

  it('相同对象的不同 cell 分开展示并可读取全部维度身份', async () => {
    const user = userEvent.setup();
    const data = insights();
    data.current_cells.push(cell('cell-b', 'en-US'));
    data.citation_insights.push({ cell_key: 'cell-b', subject_id: 'subject-a', citation_count: 2,
      domains: [bucket('example.com', citationDescriptor('cell-b'))], urls: [], source_categories: [], drilldown: citationDescriptor('cell-b') });
    render(<CitationInsights insights={data} onDrilldown={vi.fn()} />);

    expect(screen.getByRole('region', { name: '域名 · cell-a' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '域名 · cell-b' })).toBeInTheDocument();
    for (const summary of screen.getAllByText('完整维度与版本')) await user.click(summary);
    expect(screen.getByText(/zh-CN \/ CN/)).toBeVisible();
    expect(screen.getByText(/en-US \/ CN/)).toBeVisible();
    expect(screen.getByText('window:cell-a')).toBeVisible();
    expect(screen.getByText('window:cell-b')).toBeVisible();
    expect(screen.getAllByText('[["subject-a",7],["subject-b",4]]')).toHaveLength(2);
    expect(screen.getAllByText('[["subject-a","fact-v8"]]')).toHaveLength(2);
    expect(screen.getAllByText('未知').length).toBeGreaterThan(0);
    expect(screen.getAllByText('引用事件数：2')).toHaveLength(2);
  });

  it('URL 仅允许无凭据的 http/https 链接，未知来源类别明确提示', async () => {
    const user = userEvent.setup();
    const data = insights();
    const urls = ['https://example.com/path?a=1&a=2', 'http://example.com/path', 'javascript:alert(1)', 'https://user:password@example.com/path', '无效 URL'];
    data.citation_insights[0]!.urls = urls.map((url) => bucket(url, { ...citationDescriptor(), normalized_url: url }));
    data.citation_insights[0]!.source_categories = [bucket('FUTURE_CATEGORY')];
    render(<CitationInsights insights={data} onDrilldown={vi.fn()} />);

    for (const url of urls) await user.click(screen.getByText(url, { selector: 'summary' }));
    expect(screen.getByRole('link', { name: urls[0] })).toHaveAttribute('href', urls[0]);
    expect(screen.getByRole('link', { name: urls[1] })).toHaveAttribute('href', urls[1]);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getAllByText('不支持打开此链接。')).toHaveLength(3);
    expect(screen.getByRole('rowheader', { name: '未支持的类型：FUTURE_CATEGORY' })).toBeInTheDocument();
  });

  it('风险保留不可判断、高严重度和真实计数，联合分组原样下钻', async () => {
    const user = userEvent.setup();
    const data = insights();
    const onDrilldown = vi.fn();
    render(<FactRisks insights={data} onDrilldown={onDrilldown} />);

    const verdictTable = within(screen.getByRole('region', { name: '判定分布 · cell-a' })).getByRole('table');
    const accurate = within(verdictTable).getByRole('rowheader', { name: '准确' }).closest('tr')!;
    expect(within(accurate).getByRole('cell')).toHaveTextContent('0');
    expect(within(verdictTable).getByRole('rowheader', { name: '不可判断' })).toBeInTheDocument();
    const groups = screen.getByRole('region', { name: '声明联合分组 · cell-a' });
    expect(within(groups).getByRole('cell', { name: '不可判断' })).toBeInTheDocument();
    expect(within(groups).getByRole('cell', { name: '高' })).toBeInTheDocument();
    expect(within(groups).getByRole('columnheader', { name: '不同运行数' })).toBeInTheDocument();
    await user.click(within(groups).getByRole('button', { name: '声明明细：参数 / 不可判断 / 高' }));
    expect(onDrilldown.mock.calls[0]![0]).toBe(data.fact_risks[0]!.groups[0]!.drilldown);
    await user.click(screen.getByRole('button', { name: '全部声明明细：cell-a' }));
    expect(onDrilldown.mock.calls[1]![0]).toBe(data.fact_risks[0]!.drilldown);
  });

  it('质量保留 Decimal 精度、币种与未知版本，全部明细保留原始筛选', async () => {
    const user = userEvent.setup();
    const data = insights();
    const quality = data.data_quality;
    const onDrilldown = vi.fn();
    render(<InsightDataQuality insights={data} onDrilldown={onDrilldown} />);

    const costs = screen.getByRole('region', { name: '已知费用' });
    expect(within(costs).getByText('9007199254740993.123400')).toBeInTheDocument();
    expect(within(costs).getByText('4503599627370496.561700')).toBeInTheDocument();
    expect(within(costs).getAllByText('0.000000')).toHaveLength(2);
    expect(within(costs).getByRole('rowheader', { name: 'USD' })).toBeInTheDocument();
    expect(within(costs).getByRole('rowheader', { name: 'CNY' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '采集版本' })).getAllByRole('cell', { name: '未知' })).toHaveLength(2);
    expect(screen.getByText('存在待复核运行；业务统计可能因必要复核未完成而排除这些运行。')).toBeInTheDocument();
    expect(screen.getByText(/共享候选不代表最终归属/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '质量指标' })).getByText('不可计算 · 无可用样本')).toBeInTheDocument();
    expect(screen.getByText('无样本')).toBeInTheDocument();

    const buttons = [
      ['排除运行明细', quality.excluded_drilldown], ['质量明细：待复核比例', quality.overview.cards[0]!.drilldown],
      ['共享域名运行明细', quality.shared_domain_drilldown], ['费用运行明细：USD', quality.known_costs[0]!.drilldown],
      ['采集版本明细：collection-unknown', quality.collection_versions[0]!.drilldown],
      ['分析版本明细：analysis-v2', quality.analysis_versions[0]!.drilldown],
    ] as const;
    for (const [name, descriptor] of buttons) {
      await user.click(screen.getByRole('button', { name }));
      expect(onDrilldown.mock.lastCall![0]).toBe(descriptor);
      expect(onDrilldown.mock.lastCall![0].filters).toEqual(filters);
    }
    for (const region of within(screen.getByRole('region', { name: '数据质量' })).getAllByRole('region')) {
      expect(region).toHaveAttribute('tabindex', '0');
      expect(within(region).getByRole('table')).toHaveAccessibleName();
    }
  });

  it('空摘要与服务端不可用区块提供明确状态，不伪造展示数据', () => {
    const data = insights();
    data.citation_insights = [];
    data.fact_risks = [];
    const { rerender } = render(<><CitationInsights insights={data} onDrilldown={vi.fn()} /><FactRisks insights={data} onDrilldown={vi.fn()} /></>);
    expect(screen.getByText('当前筛选暂无引用摘要。')).toHaveAttribute('role', 'status');
    expect(screen.getByText('当前筛选暂无事实风险摘要。')).toHaveAttribute('role', 'status');

    const unavailable = insights();
    unavailable.unavailable_sections = ['CITATION_INSIGHTS', 'FACT_RISKS', 'DATA_QUALITY'];
    rerender(<><CitationInsights insights={unavailable} onDrilldown={vi.fn()} /><FactRisks insights={unavailable} onDrilldown={vi.fn()} /><InsightDataQuality insights={unavailable} onDrilldown={vi.fn()} /></>);
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByText('服务端尚未支持引用分析区块。')).toBeInTheDocument();
    expect(screen.getByText('服务端尚未支持事实风险区块。')).toBeInTheDocument();
    expect(screen.getByText('服务端尚未支持数据质量区块。')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('缺少当前 cell 身份时显式要求重读而不隐藏维度缺口', () => {
    const data = insights();
    data.current_cells = [];
    render(<CitationInsights insights={data} onDrilldown={vi.fn()} />);
    expect(screen.getByText('当前响应缺少此 cell 的完整维度，请重新读取摘要。')).toHaveAttribute('role', 'status');
    expect(screen.getByText('对象 ID：subject-a · Cell：cell-a')).toBeInTheDocument();
    expect(screen.queryByText('完整维度与版本')).not.toBeInTheDocument();
  });
});
