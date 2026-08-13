/** Prompt Workspace production artifact fixture；未声明请求必须暴露为失败。 */
import { test as base, expect } from './platforms.fixture';

import type { components } from '../../../src/shared/api/generated/schema';

type PromptDetail = components['schemas']['PlatformPromptDetail'];
type PromptMutationRequest = {
  body?: unknown;
  csrfToken: string | null;
  expectedRevision?: number;
  method: 'POST' | 'PUT' | 'DELETE';
  promptId?: string;
};
type PromptWorkspaceApiController = {
  requests: PromptMutationRequest[];
};
type PromptFixtures = { promptWorkspaceApi: PromptWorkspaceApiController };

const actorId = '00000000-0000-4000-8000-000000000099';
const firstPromptId = '20000000-0000-4000-8000-000000000001';
const secondPromptId = '20000000-0000-4000-8000-000000000002';
const createdPromptId = '20000000-0000-4000-8000-000000000003';
const platformId = '00000000-0000-4000-8000-000000000001';

function initialPrompts(): PromptDetail[] {
  return [
    {
      id: firstPromptId,
      name: '技术文章 Prompt',
      template_markdown: '# 写作约束',
      revision: 4,
      updated_at: '2026-08-12T00:00:00Z',
      updated_by: actorId,
      created_at: '2026-08-01T00:00:00Z',
      bound_platform_count: 1,
      bound_platforms: [{ id: platformId, name: '工程师社区 001', slug: 'engineer-community-1' }],
      available_actions: ['UPDATE', 'DELETE'],
    },
    {
      id: secondPromptId,
      name: '产品简报 Prompt',
      template_markdown: '# 简报约束',
      revision: 2,
      updated_at: '2026-08-11T00:00:00Z',
      updated_by: actorId,
      created_at: '2026-08-02T00:00:00Z',
      bound_platform_count: 0,
      bound_platforms: [],
      available_actions: ['UPDATE', 'DELETE'],
    },
  ];
}

function listItem(prompt: PromptDetail): components['schemas']['PlatformPromptListItem'] {
  return {
    id: prompt.id,
    name: prompt.name,
    revision: prompt.revision,
    updated_at: prompt.updated_at,
    updated_by: prompt.updated_by,
    bound_platform_count: prompt.bound_platform_count,
    available_actions: prompt.available_actions,
  };
}

const test = base.extend<PromptFixtures>({
  promptWorkspaceApi: [async ({ page, platformsApi }, use) => {
    void platformsApi;
    let prompts = initialPrompts();
    const requests: PromptMutationRequest[] = [];

    await page.route('**/api/v1/platform-prompts**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const detailMatch = url.pathname.match(/^\/api\/v1\/platform-prompts\/([^/]+)$/);

      if (request.method() === 'GET' && url.pathname === '/api/v1/platform-prompts') {
        await route.fulfill({
          status: 200,
          json: {
            items: [...prompts]
              .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
              .map(listItem),
          } satisfies components['schemas']['PlatformPromptList'],
        });
        return;
      }
      if (request.method() === 'GET' && detailMatch) {
        const prompt = prompts.find((item) => item.id === detailMatch[1]);
        if (!prompt) {
          await route.fulfill({
            status: 404,
            json: { error: { code: 'PLATFORM_PROMPT_NOT_FOUND', message: 'Prompt 不存在', details: {}, request_id: 'req-prompt-404' } },
          });
          return;
        }
        await route.fulfill({ status: 200, json: prompt });
        return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/platform-prompts') {
        const body = request.postDataJSON() as components['schemas']['PlatformPromptCreate'];
        requests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          method: 'POST',
        });
        const created: PromptDetail = {
          ...body,
          id: createdPromptId,
          revision: 0,
          updated_at: '2026-08-14T00:00:00Z',
          updated_by: actorId,
          created_at: '2026-08-14T00:00:00Z',
          bound_platform_count: 0,
          bound_platforms: [],
          available_actions: ['UPDATE', 'DELETE'],
        };
        prompts.push(created);
        await route.fulfill({ status: 201, json: created });
        return;
      }
      if (request.method() === 'PUT' && detailMatch) {
        const body = request.postDataJSON() as components['schemas']['PlatformPromptUpdate'];
        const index = prompts.findIndex((item) => item.id === detailMatch[1]);
        if (index < 0) throw new Error(`fixture 未找到 Prompt：${detailMatch[1]}`);
        requests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision: body.expected_revision,
          method: 'PUT',
          promptId: detailMatch[1],
        });
        prompts[index] = {
          ...prompts[index]!,
          name: body.name,
          template_markdown: body.template_markdown,
          revision: prompts[index]!.revision + 1,
          updated_at: '2026-08-14T00:01:00Z',
        };
        await route.fulfill({ status: 200, json: prompts[index] });
        return;
      }
      if (request.method() === 'DELETE' && detailMatch) {
        const expectedRevision = Number(url.searchParams.get('expected_revision'));
        requests.push({
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          expectedRevision,
          method: 'DELETE',
          promptId: detailMatch[1],
        });
        prompts = prompts.filter((item) => item.id !== detailMatch[1]);
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fallback();
    });

    await use({ requests });
  }, { auto: true }],
});

export { createdPromptId, expect, firstPromptId, platformId, test };
export type { PromptMutationRequest, PromptWorkspaceApiController };
