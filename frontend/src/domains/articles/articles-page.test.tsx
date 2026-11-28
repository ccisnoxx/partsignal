import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { ArticlesListPage } from './articles-list-page';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

afterEach(() => vi.restoreAllMocks());

describe('ArticlesListPage', () => {
  it('展示外部粘贴文章与多 URL 发布统计，只读角色隐藏写入按钮', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path: string) => {
      if (path === '/api/v1/articles') {
        return {
          data: {
            items: [
              {
                id: '10000000-0000-4000-8000-000000000001',
                product_id: '20000000-0000-4000-8000-000000000001',
                product_label: 'PartSignal PS-OPA2333',
                parent_article_id: null,
                title: '低功耗运放选型指南',
                summary: '静态电流与失调电压对比',
                body_markdown: '# 正文',
                target_keywords: ['低功耗运放'],
                origin_type: 'EXTERNAL_AI',
                external_model_name: 'DeepSeek-R1',
                status: 'PUBLISHED',
                current_revision: 1,
                revision: 0,
                owner_id: '30000000-0000-4000-8000-000000000001',
                owner_name: '运营同学',
                created_by: '30000000-0000-4000-8000-000000000001',
                updated_by: '30000000-0000-4000-8000-000000000001',
                source_content_task_id: null,
                source_content_version_id: null,
                publication_count: 2,
                verified_publication_count: 0,
                created_at: '2026-11-28T00:00:00Z',
                updated_at: '2026-11-28T00:00:00Z',
              },
            ],
            page: 1,
            page_size: 20,
            total: 1,
          },
          response: new Response(null, { status: 200 }),
        } as never;
      }
      return {
        data: { items: [], page: 1, page_size: 100, total: 0 },
        response: new Response(null, { status: 200 }),
      } as never;
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ArticlesListPage canOperate={false} csrfToken="csrf-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('低功耗运放选型指南')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek-R1')).toBeInTheDocument();
    expect(screen.getByText('2 条')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '粘贴 / 录入文章' })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={qc}>
        <ArticlesListPage canOperate csrfToken="csrf-1" />
      </QueryClientProvider>,
    );
    const openBtn = await screen.findByRole('button', { name: '粘贴 / 录入文章' });
    await userEvent.click(openBtn);
    await waitFor(() => expect(screen.getByText('关联产品 *')).toBeInTheDocument());
  });
});
