import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  mapPublicationStartError,
  PublicationRequestError,
  publicationPackageQueryOptions,
  publicationWorkspaceContextQueryOptions,
  publishedArticleListQueryOptions,
  publishedArticleQueryOptions,
  publishedContentIssueListQueryOptions,
  publishedContentIssueWorkspaceQueryOptions,
} from './publication.api';
import { articleIds, publishedArticle } from './published-article.test-fixtures';
import { workspaceContext } from './publication-work.test-fixtures';

afterEach(() => vi.restoreAllMocks());

describe('Publication API errors', () => {
  it.each([401, 403, 404, 409, 422])('保留 HTTP %s structured error 与 request ID', (status) => {
    const detail = {
      code: `PUBLICATION_${status}`,
      message: '发布命令失败',
      details: {},
      request_id: `req-publication-${status}`,
    };
    expect(mapPublicationStartError(new PublicationRequestError(detail.message, status, detail)))
      .toEqual({
        message: detail.message,
        requestId: detail.request_id,
        code: detail.code,
        status,
      });
  });

  it('Context 与 Package 使用独立 query key，Package 仅由调用方按需 fetch', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/publication-works/{work_id}/workspace-context') {
        return { data: workspaceContext, response: Response.json(workspaceContext) } as never;
      }
      if (path === '/api/v1/content-versions/{content_version_id}/publication-package') {
        const data = {
          content_version_id: workspaceContext.content.id,
          fact_version_id: '40000000-0000-4000-8000-000000000001',
          title: workspaceContext.content.title,
          body_markdown: workspaceContext.content.body_markdown,
          body_html: '<h1>已批准内容</h1>',
          body_text: '已批准内容',
          tags: workspaceContext.content.tags,
          content_hash: workspaceContext.content.content_hash,
        };
        return { data, response: Response.json(data) } as never;
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await client.fetchQuery(publicationWorkspaceContextQueryOptions(workspaceContext.work.id));
    expect(get).toHaveBeenCalledTimes(1);
    await client.fetchQuery(publicationPackageQueryOptions(workspaceContext.content.id));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('Article list/detail 使用独立 GET endpoint 且 list 参数来自 canonical search', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/published-articles') {
        const data = { items: [publishedArticle], page: 2, page_size: 10, total: 11 };
        return { data, response: Response.json(data) } as never;
      }
      if (path === '/api/v1/published-articles/{article_id}') {
        return { data: publishedArticle, response: Response.json(publishedArticle) } as never;
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await client.fetchQuery(publishedArticleListQueryOptions({
      q: '工程师社区',
      page: 2,
      pageSize: 10,
      sort: 'PUBLISHED_DESC',
    }));
    await client.fetchQuery(publishedArticleQueryOptions(articleIds.article));

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/published-articles', {
      params: {
        query: {
          page: 2,
          page_size: 10,
          search: '工程师社区',
          sort: 'PUBLISHED_DESC',
        },
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/published-articles/{article_id}', {
      params: { path: { article_id: articleIds.article } },
    });
  });

  it('Issue list 与 Workspace 各自只使用一个 canonical GET', async () => {
    const issue = {
      id: 'b0000000-0000-4000-8000-00000000000b',
      published_article_id: articleIds.article,
    };
    const workspace = { issue, article: publishedArticle, repair_task: null };
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/published-content-issues') {
        const data = { items: [issue], page: 3, page_size: 50, total: 101 };
        return { data, response: Response.json(data) } as never;
      }
      if (path === '/api/v1/published-content-issues/{issue_id}/workspace-context') {
        return { data: workspace, response: Response.json(workspace) } as never;
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await client.fetchQuery(publishedContentIssueListQueryOptions({
      status: 'ALL', page: 3, pageSize: 50,
    }));
    await client.fetchQuery(publishedContentIssueWorkspaceQueryOptions(issue.id));

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/published-content-issues', {
      params: { query: { page: 3, page_size: 50, status: undefined } },
    });
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/published-content-issues/{issue_id}/workspace-context',
      { params: { path: { issue_id: issue.id } } },
    );
  });
});
