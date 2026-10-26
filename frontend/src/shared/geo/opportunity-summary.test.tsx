import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { filters, id, opportunitySummary } from '@/domains/geo-insights/insights.test-support';
import { isCanonicalOpportunitySearch, opportunitySearchSchema, opportunitySearchToParams } from '@/domains/geo-opportunities/opportunities.model';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { OpportunityFilters } from '@/domains/geo-opportunities/opportunity-filters';
import { OpportunitySummary, opportunitySummaryHref } from './opportunity-summary';

describe('总览和报告共用机会摘要', () => {
  it('显示服务端总数、状态、优先级和时点，链接保留来源与分组', () => {
    const value = opportunitySummary(); value.open_count = 3;
    value.by_status.forEach((group) => { group.count = 1; });
    value.by_priority[0]!.count = 2; value.by_priority[1]!.count = 1;
    render(<OpportunitySummary summary={value} />);
    expect(screen.getByText('待处理机会：3')).toBeVisible();
    expect(screen.getByText(/机会状态统计截止/)).toBeVisible();
    expect(screen.getByText(/包含历史及复测来源/)).toBeVisible();
    const link = screen.getByRole('link', { name: '查看已确认机会 1 项' });
    const url = new URL(link.getAttribute('href')!, 'https://partsignal.test');
    const search = opportunitySearchSchema.parse(Object.fromEntries(url.searchParams));
    const params = opportunitySearchToParams(search);
    expect(params).toMatchObject({ open_only: true, status: 'ACKNOWLEDGED' });
    expect(JSON.parse(params.source_scope!)).toMatchObject({ date_from: filters.date_from, subject_ids: filters.subject_ids, collection_modes: filters.collection_modes });
    const priority = new URL(screen.getByRole('link', { name: '查看严重优先级机会 2 项' }).getAttribute('href')!, 'https://partsignal.test');
    expect(priority.searchParams.get('priority')).toBe('CRITICAL');
    expect(document.querySelector('details')).toBeNull();
  });

  it('真实空集显示零，不再声称机会实体未实现', () => {
    render(<OpportunitySummary summary={opportunitySummary()} />);
    expect(screen.getByText('待处理机会：0')).toBeVisible();
    expect(screen.getByText('当前来源范围没有待处理机会。')).toBeVisible();
    expect(screen.queryByText(/NOT_IMPLEMENTED/)).not.toBeInTheDocument();
  });

  it('工作台说明来源日期与原创建时间的区别，翻页筛选保持上下文且可以显式清除', async () => {
    const scope = { ...filters, review_policy: 'REVIEWED_ONLY' as const, region_codes: ['CN'], subject_ids: [id] };
    const value = opportunitySummary(); value.drilldown.source_scope = scope;
    const url = new URL(opportunitySummaryHref(value.drilldown), 'https://partsignal.test');
    const search = opportunitySearchSchema.parse(Object.fromEntries(url.searchParams));
    const change = vi.fn();
    render(<OpportunityFilters search={search} onChange={change} />);
    const region = screen.getByRole('region', { name: '汇总来源范围' });
    expect(within(region).getByText(/以下日期按关联来源运行的创建时间/)).toBeVisible();
    expect(within(region).getByText('REVIEWED_ONLY')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(change.mock.lastCall?.[0]).toMatchObject({ source_scope: search.source_scope, open_only: true });
    expect(opportunitySearchToParams(opportunitySearchSchema.parse({ ...search, page: 2 }))).toMatchObject({ source_scope: JSON.stringify(search.source_scope), open_only: true, page: 2 });
    await userEvent.click(screen.getByRole('button', { name: '清除汇总来源范围' }));
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('source_scope');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('open_only');
  });

  it('非法来源 JSON、未知字段和超限对象不会静默变成全量查询，时间精度原样保留', () => {
    for (const source_scope of ['{', '{}', JSON.stringify({ ...filters, secret: 'unsupported' }), JSON.stringify({ ...filters, subject_ids: Array(51).fill(id) })]) {
      expect(opportunitySearchSchema.safeParse({ source_scope }).success).toBe(false);
    }
    const search = opportunitySearchSchema.parse({ source_scope: JSON.stringify({ ...filters,
      date_from: '2026-10-01T01:00:00+08:00', date_to: '2026-09-30T18:00:00Z',
    }) });
    expect(search.source_scope).toMatchObject({ date_from: '2026-10-01T01:00:00+08:00', date_to: '2026-09-30T18:00:00Z' });
    const precise = { ...filters, date_from: '2026-10-25T12:00:00.123456Z', date_to: '2026-10-25T12:00:00.123457Z' };
    const target = new URL(opportunitySummaryHref({ ...opportunitySummary().drilldown, source_scope: precise }), 'https://partsignal.test');
    const parsed = opportunitySearchSchema.parse(Object.fromEntries(target.searchParams));
    expect(JSON.parse(opportunitySearchToParams(parsed).source_scope!)).toMatchObject(precise);
    const raw = defaultParseSearch(defaultStringifySearch(parsed));
    const roundtrip = opportunitySearchSchema.parse(raw);
    expect(roundtrip).toEqual(parsed);
    expect(isCanonicalOpportunitySearch(raw, roundtrip)).toBe(true);
    expect(isCanonicalOpportunitySearch({ ...raw, source_scope: Object.fromEntries(Object.entries(roundtrip.source_scope!).reverse()) }, roundtrip)).toBe(true);
    expect(isCanonicalOpportunitySearch({ ...raw, source_scope: { ...roundtrip.source_scope, region_codes: ['US'] } }, roundtrip)).toBe(false);
    expect(JSON.parse(opportunitySearchToParams(roundtrip).source_scope!)).toMatchObject(precise);
  });
});
