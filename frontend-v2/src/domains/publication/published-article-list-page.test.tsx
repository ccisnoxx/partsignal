import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { PublishedArticleListPage } from './published-article-list-page';
import { publishedArticle } from './published-article.test-fixtures';

afterEach(() => vi.restoreAllMocks());

function renderList(onSearchChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PublishedArticleListPage
        onSearchChange={onSearchChange}
        search={{ page: 1, pageSize: 20 }}
      />
    </QueryClientProvider>,
  );
  return onSearchChange;
}

function response(value: unknown, status = 200) {
  return {
    data: status < 400 ? value : undefined,
    error: status >= 400 ? value : undefined,
    response: Response.json(value, { status }),
  } as never;
}

describe('PublishedArticleListPage', () => {
  it('单请求绘制五列只读成果并把标题链接到 canonical detail', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response({
      items: [publishedArticle],
      page: 1,
      page_size: 20,
      total: 1,
    }));
    renderList();

    expect(await screen.findByRole('heading', { name: '发布成果' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '发布内容', '平台 / 账号', '发布时间', '首次核验', '内容健康',
    ]);
    expect(await screen.findByRole('link', { name: publishedArticle.actual_title })).toHaveAttribute(
      'href',
      `/publishing/articles/${publishedArticle.id}`,
    );
    expect(screen.getByRole('link', { name: 'community.example.invalid' })).toHaveAttribute(
      'href',
      publishedArticle.final_url,
    );
    expect(screen.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除|核验|问题/ })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/published-articles', {
      params: { query: { page: 1, page_size: 20, search: undefined, sort: 'VERIFIED_DESC' } },
    });
  });

  it('搜索提交回到第一页，服务端空结果显示 filtered empty', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [], page: 1, page_size: 20, total: 0 }));
    const onSearchChange = renderList();

    await user.type(screen.getByLabelText('搜索发布成果'), '  MCU  ');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: 1, pageSize: 20, q: 'MCU' });
    expect(await screen.findByText('暂无发布成果')).toBeInTheDocument();
  });

  it('structured error 提供重试且不渲染伪成功行', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      error: { code: 'PUBLICATION_CONTEXT_INCOMPLETE', message: '发布成果上下文不完整', details: {}, request_id: 'req-list' },
    }, 409));
    renderList();

    expect(await screen.findByText('发布成果列表加载失败')).toBeInTheDocument();
    expect(screen.getByText(/req-list/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: publishedArticle.actual_title })).not.toBeInTheDocument();
  });
});
