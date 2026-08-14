/** AI Channel Workspace production-artifact fixture；在 List 严格边界上只补 Core 实际请求。 */
import { expect, test as aiChannelsTest } from './ai-channels.fixture';
import type { components } from '../../../src/shared/api/generated/schema';

type AIChannel = components['schemas']['AIChannel'];
type AIChannelCreate = components['schemas']['AIChannelCreate'];
type AIChannelUpdate = components['schemas']['AIChannelUpdate'];

type WorkspaceRequest = {
  body?: unknown;
  csrfToken: string | null;
  method: string;
  path: string;
  revision?: number;
};

type AIChannelWorkspaceApiController = {
  conflictNextUpdate: () => void;
  createRequests: AIChannelCreate[];
  detailRequests: string[];
  mutationRequests: WorkspaceRequest[];
  responsePayloads: string[];
};

type WorkspaceFixtures = { aiChannelWorkspaceApi: AIChannelWorkspaceApiController };

const channelId = 'a0000000-0000-4000-8000-000000000001';

function createWorkspaceChannel(overrides: Partial<AIChannel> = {}): AIChannel {
  return {
    id: channelId,
    name: 'Workspace OpenAI',
    description: 'Core 渠道',
    protocol_type: 'openai-compatible-chat-completions',
    provider_brand: 'OPENAI',
    base_url: 'https://provider.example.invalid/v1',
    timeout_seconds: 60,
    is_enabled: false,
    api_key_configured: true,
    api_key_updated_at: '2026-08-14T00:00:00Z',
    headers: [{
      id: '91000000-0000-4000-8000-000000000001',
      name: 'X-Workspace',
      is_sensitive: false,
      is_configured: true,
      available_actions: ['UPDATE', 'DELETE'],
      primary_task: 'EDIT_HEADER',
    }],
    enabled_models: [],
    latest_test_status: 'UNTESTED',
    last_tested_at: null,
    workflow_stage: 'INCOMPLETE',
    primary_task: 'COMPLETE_CONFIGURATION',
    available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'CREATE_HEADER', 'DISCOVER_MODELS', 'CREATE_MODEL'],
    revision: 4,
    created_by: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

const test = aiChannelsTest.extend<WorkspaceFixtures>({
  aiChannelWorkspaceApi: [async ({ page }, use) => {
    let channel = createWorkspaceChannel();
    let nextUpdateConflict = false;
    const createRequests: AIChannelCreate[] = [];
    const detailRequests: string[] = [];
    const mutationRequests: WorkspaceRequest[] = [];
    const responsePayloads: string[] = [];

    await page.route('**/api/v1/**', async (route, request) => {
      const url = new URL(request.url());
      const csrfToken = request.headers()['x-csrf-token'] ?? null;

      if (request.method() === 'POST' && url.pathname === '/api/v1/ai-channels') {
        const body = request.postDataJSON() as AIChannelCreate;
        createRequests.push(body);
        channel = createWorkspaceChannel({
          name: body.name,
          description: body.description,
          protocol_type: body.protocol_type,
          provider_brand: body.provider_brand,
          base_url: body.base_url,
          timeout_seconds: body.timeout_seconds,
          headers: [],
          revision: 0,
        });
        mutationRequests.push({ body, csrfToken, method: 'POST', path: url.pathname });
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 201, json: channel });
        return;
      }

      const detailMatch = url.pathname.match(/^\/api\/v1\/ai-channels\/([^/]+)$/);
      if (request.method() === 'GET' && detailMatch) {
        detailRequests.push(detailMatch[1]!);
        if (detailMatch[1] !== channel.id) {
          await route.fulfill({ status: 404, json: { error: { code: 'AI_CHANNEL_NOT_FOUND', message: 'AI 渠道不存在', details: {}, request_id: 'req-ai-workspace-404' } } });
          return;
        }
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 200, json: channel });
        return;
      }

      if (request.method() === 'PATCH' && detailMatch && detailMatch[1] === channel.id) {
        const body = request.postDataJSON() as AIChannelUpdate;
        mutationRequests.push({ body, csrfToken, method: 'PATCH', path: url.pathname, revision: body.expected_revision });
        if (nextUpdateConflict) {
          nextUpdateConflict = false;
          channel = { ...channel, name: '服务端最新渠道', revision: channel.revision + 1 };
          await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'AI 渠道已被其他请求修改', details: {}, request_id: 'req-ai-workspace-conflict' } } });
          return;
        }
        channel = { ...channel, ...body, revision: channel.revision + 1, updated_at: '2026-08-14T01:00:00Z' };
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 200, json: channel });
        return;
      }

      if (request.method() === 'PUT' && url.pathname === `/api/v1/ai-channels/${channel.id}/api-key`) {
        const body = request.postDataJSON() as components['schemas']['AIChannelApiKeyReplace'];
        mutationRequests.push({ body, csrfToken, method: 'PUT', path: url.pathname, revision: body.expected_revision });
        channel = { ...channel, api_key_configured: true, revision: channel.revision + 1 };
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 200, json: channel });
        return;
      }

      if (request.method() === 'POST' && url.pathname === `/api/v1/ai-channels/${channel.id}/headers`) {
        const body = request.postDataJSON() as components['schemas']['AIChannelHeaderCreate'];
        mutationRequests.push({ body, csrfToken, method: 'POST', path: url.pathname, revision: body.expected_channel_revision });
        channel = {
          ...channel,
          revision: channel.revision + 1,
          headers: [...channel.headers, {
            id: '91000000-0000-4000-8000-000000000099',
            name: body.name,
            is_sensitive: body.is_sensitive,
            is_configured: true,
            available_actions: ['UPDATE', 'DELETE'],
            primary_task: body.is_sensitive ? 'RECONFIGURE_HEADER' : 'EDIT_HEADER',
          }],
        };
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 201, json: channel });
        return;
      }

      const headerMatch = url.pathname.match(/^\/api\/v1\/ai-channel-headers\/([^/]+)$/);
      if (request.method() === 'DELETE' && headerMatch) {
        const revision = Number(url.searchParams.get('expected_channel_revision'));
        mutationRequests.push({ csrfToken, method: 'DELETE', path: url.pathname, revision });
        channel = {
          ...channel,
          revision: channel.revision + 1,
          headers: channel.headers.filter((header) => header.id !== headerMatch[1]),
        };
        await route.fulfill({ status: 204 });
        return;
      }

      await route.fallback();
    });

    await use({
      conflictNextUpdate: () => { nextUpdateConflict = true; },
      createRequests,
      detailRequests,
      mutationRequests,
      responsePayloads,
    });
  }, { auto: true }],
});

export { channelId, expect, test };
export type { AIChannelWorkspaceApiController };
