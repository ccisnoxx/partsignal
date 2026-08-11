import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import {
  mapPublicationStartError,
  PublicationRequestError,
  publicationPackageQueryOptions,
  publicationWorkspaceContextQueryOptions,
} from './publication.api';
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
});
