import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { PublishedContentIssueListPage } from './published-content-issue-list-page';
import { issueListItem } from './published-content-issue.test-fixtures';

afterEach(() => vi.restoreAllMocks());

describe('PublishedContentIssueListPage', () => {
  it('单次读取六列表格并按服务端动作投影 canonical 入口', async () => {
    const data = { items: [issueListItem], page: 1, page_size: 20, total: 1 };
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PublishedContentIssueListPage
          onSearchChange={vi.fn()}
          search={{ status: 'OPEN', page: 1, pageSize: 20 }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: issueListItem.actual_title })).toHaveAttribute(
      'href',
      `/publishing/issues/${issueListItem.id}#issue`,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getAllByText('待处理')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '创建修复任务' })).toHaveAttribute(
      'href',
      `/publishing/issues/${issueListItem.id}#repair`,
    );
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/published-content-issues', {
      params: { query: { page: 1, page_size: 20, status: 'OPEN' } },
    });
  });
});
