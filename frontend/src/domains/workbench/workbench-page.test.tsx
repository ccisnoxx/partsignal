import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { WorkbenchPage } from './workbench-page';

const aggregate = {
  generated_at: '2026-08-23T08:00:00Z',
  actionable_counts: {
    fact_reviews: { value: 0, href: '/facts?source=server' },
    content_reviews: { value: 2, href: '/content?source=server' },
    publication_verifications: { value: 3, href: '/verifications?source=server' },
    publication_actions: { value: 4, links: [{ label: '处理发布失败', href: '/publication-failures?source=server' }] },
    content_issues: { value: 5, href: '/issues?source=server' },
    geo_accuracy_issues: { value: 6, links: [{ label: '检查 GEO 准确性', href: '/geo-accuracy?source=server' }] },
  },
  workflow_health: {
    product_facts: { status: 'CLEAR', summary: '产品事实流程正常' },
    content: { status: 'ATTENTION', summary: '内容审核存在积压' },
    publication: { status: 'CLEAR', summary: '发布流程正常' },
    geo: { status: 'ATTENTION', summary: 'GEO 准确性需要关注' },
  },
  geo_summary: {
    window: { date_from: '2026-07-25', date_to: '2026-08-23' },
    discovery_rate: { numerator: 1, denominator: 2, value: 0.5 },
    mention_rate: { numerator: 0, denominator: 2, value: 0 },
    accuracy_rate: { numerator: 0, denominator: 0, value: null },
  },
  recent_attention_items: [{
    category: 'CONTENT_ISSUE',
    resource_id: '10000000-0000-4000-8000-000000000001',
    title: '修复发布内容问题',
    summary: '服务端摘要',
    occurred_at: '2026-08-23T07:00:00Z',
    href: '/issues/10000000-0000-4000-8000-000000000001?source=server',
  }],
} satisfies components['schemas']['WorkbenchAggregate'];

const emptyAggregate = {
  ...aggregate,
  actionable_counts: {
    fact_reviews: { ...aggregate.actionable_counts.fact_reviews, value: 0 },
    content_reviews: { ...aggregate.actionable_counts.content_reviews, value: 0 },
    publication_verifications: { ...aggregate.actionable_counts.publication_verifications, value: 0 },
    publication_actions: { ...aggregate.actionable_counts.publication_actions, value: 0 },
    content_issues: { ...aggregate.actionable_counts.content_issues, value: 0 },
    geo_accuracy_issues: { ...aggregate.actionable_counts.geo_accuracy_issues, value: 0 },
  },
  recent_attention_items: [],
} satisfies components['schemas']['WorkbenchAggregate'];

afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorkbenchPage /></QueryClientProvider>);
}

describe('WorkbenchPage', () => {
  it('通过单一 aggregate 绘制所有区块并原样保留 canonical href', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: aggregate, response: Response.json(aggregate) } as never);
    renderPage();

    expect(await screen.findByRole('link', { name: '查看事实审核' })).toHaveAttribute('href', '/facts?source=server');
    expect(screen.getAllByText('事实审核').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '处理发布失败' })).toHaveAttribute('href', '/publication-failures?source=server');
    expect(screen.getByRole('link', { name: /修复发布内容问题/ })).toHaveAttribute(
      'href',
      '/issues/10000000-0000-4000-8000-000000000001?source=server',
    );
    expect(screen.getByText('内容审核存在积压')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/workbench');
  });

  it('把空队列、zero count 和 nullable rate 保持为成功状态', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: emptyAggregate,
      response: Response.json(emptyAggregate),
    } as never);
    renderPage();

    expect(await screen.findByText('当前没有需要关注的事项。')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(6);
    expect(screen.getByRole('link', { name: '查看事实审核' })).toHaveAttribute('href', '/facts?source=server');
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('fatal error 显示 request ID 并允许显式 retry', async () => {
    const error = {
      error: { code: 'WORKBENCH_UNAVAILABLE', message: '工作台暂不可用', details: {}, request_id: 'req-workbench' },
    } satisfies components['schemas']['ErrorEnvelope'];
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ error, response: Response.json(error, { status: 503 }) } as never)
      .mockResolvedValueOnce({ data: aggregate, response: Response.json(aggregate) } as never);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('工作台暂不可用（请求 ID：req-workbench）');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('内容审核存在积压')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
