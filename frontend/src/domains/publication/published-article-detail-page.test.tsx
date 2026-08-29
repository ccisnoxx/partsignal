import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { PublishedArticleDetailPage } from './published-article-detail-page';
import { articleIds, publishedArticle } from './published-article.test-fixtures';

afterEach(() => vi.restoreAllMocks());

function renderDetail(articleId = articleIds.article, onIssueOpened = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PublishedArticleDetailPage
        articleId={articleId}
        csrfToken="csrf-token-for-published-article-tests"
        onIssueOpened={onIssueOpened}
      />
    </QueryClientProvider>,
  );
}

function response(value: unknown, status = 200) {
  return {
    data: status < 400 ? value : undefined,
    error: status >= 400 ? value : undefined,
    response: Response.json(value, { status }),
  } as never;
}

function errorResponse(status: number) {
  return response({
    error: {
      code: `PUBLICATION_${status}`,
      message: '发布成果请求失败',
      details: {},
      request_id: `req-${status}`,
    },
  }, status);
}

describe('PublishedArticleDetailPage', () => {
  it('只请求 Article detail 并展示 sanitized 来源、成功核验、lineage 与时间线', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(publishedArticle));
    renderDetail();

    expect(await screen.findByRole('heading', { name: publishedArticle.actual_title })).toBeInTheDocument();
    expect(screen.getByText('只读 · 不可变快照')).toBeInTheDocument();
    expect(screen.getByLabelText('发布成果来源内容 v3 Markdown 快照')).toHaveTextContent('典型工作电压为 3.3 V');
    expect(screen.getByLabelText('发布成果来源内容 v3 Markdown 快照')).not.toHaveTextContent('危险内容');
    expect(screen.getByRole('heading', { name: '首次成功核验快照' })).toBeInTheDocument();
    expect(screen.getByText(/Prompt：平台 Prompt/)).toBeInTheDocument();
    expect(screen.getAllByText('首次核验通过')).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: '打开公开页面' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'v3' })).toHaveAttribute('href', `/content/versions/${articleIds.content}`);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登记内容问题' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除|编辑|核验/ })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/published-articles/{article_id}', {
      params: { path: { article_id: articleIds.article } },
    });
  });

  it('只按 OPEN_ISSUE token 提交两字段问题并交接 canonical response', async () => {
    const user = userEvent.setup();
    const onIssueOpened = vi.fn();
    const issue = {
      id: 'b0000000-0000-4000-8000-00000000000b',
      kind: 'PAGE_UNAVAILABLE',
      description: '公开页面返回 404',
    };
    vi.spyOn(api, 'GET').mockResolvedValue(response(publishedArticle));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(issue, 201));
    renderDetail(articleIds.article, onIssueOpened);

    await user.click(await screen.findByRole('button', { name: '登记内容问题' }));
    await user.type(screen.getByRole('textbox', { name: '问题描述' }), issue.description);
    await user.click(screen.getByRole('button', { name: '确认登记' }));

    expect(post).toHaveBeenCalledWith('/api/v1/published-articles/{article_id}/issues', {
      body: { kind: 'PAGE_UNAVAILABLE', description: issue.description },
      params: {
        header: { 'X-CSRF-Token': 'csrf-token-for-published-article-tests' },
        path: { article_id: articleIds.article },
      },
    });
    expect(onIssueOpened).toHaveBeenCalledWith(issue);
  });

  it('OPEN_ISSUE 409 保留输入且不重放，显式重载后只消费最新 Article 投影', async () => {
    const user = userEvent.setup();
    const issueId = 'b0000000-0000-4000-8000-00000000000b';
    const refreshedArticle = {
      ...publishedArticle,
      has_open_issue: true,
      open_issue_id: issueId,
      workflow_stage: 'OPEN_ISSUE',
      primary_task: 'HANDLE_CONTENT_ISSUE',
      available_actions: [],
    };
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(publishedArticle))
      .mockResolvedValueOnce(response(refreshedArticle));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(errorResponse(409));
    renderDetail();

    await user.click(await screen.findByRole('button', { name: '登记内容问题' }));
    const description = screen.getByRole('textbox', { name: '问题描述' });
    await user.type(description, '保留这段问题描述');
    await user.click(screen.getByRole('button', { name: '确认登记' }));

    expect(await screen.findByText('请求 ID：req-409')).toBeInTheDocument();
    expect(description).toHaveValue('保留这段问题描述');
    expect(screen.getByRole('button', { name: '确认登记' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '显式重载发布成果' }));

    expect(get).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('link', { name: '处理内容问题' }))
      .toHaveAttribute('href', `/publishing/issues/${issueId}#issue`);
    expect(screen.queryByRole('dialog', { name: /登记/ })).not.toBeInTheDocument();
  });

  it.each([
    [404, '未找到发布成果'],
    [403, '无法访问发布成果'],
    [409, '发布成果加载失败'],
  ] as const)('处理 %s structured error 与 request ID', async (status, title) => {
    vi.spyOn(api, 'GET').mockResolvedValue(errorResponse(status));
    renderDetail();

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    if (status === 409) expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('URL、verification 或 source identity 不一致时不泄漏快照', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...publishedArticle,
      source_content: {
        ...publishedArticle.source_content,
        content: { ...publishedArticle.source_content.content, id: articleIds.fact },
      },
    }));
    renderDetail();

    expect(await screen.findByRole('heading', { name: '未找到该发布成果' })).toBeInTheDocument();
    expect(screen.queryByText(publishedArticle.actual_title)).not.toBeInTheDocument();
  });
});
