/** AI Channel List production artifact fixture；响应类型不包含敏感连接配置。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type AIChannelSummary = components['schemas']['AIChannelSummary'];
type AIChannelList = components['schemas']['AIChannelList'];
type AccountType = components['schemas']['AccountType'];

type AIChannelCommandRequest = {
  command: 'enable' | 'disable' | 'delete';
  csrfToken: string | null;
  expectedRevision: number | null;
  channelId: string;
};

type AIChannelsApiController = {
  allowHttpError: (status: number) => void;
  commandRequests: AIChannelCommandRequest[];
  conflictNext: (command: AIChannelCommandRequest['command']) => void;
  listRequests: URL[];
  responsePayloads: string[];
  setAccountType: (accountType: AccountType) => void;
};

type AIChannelFixtures = { aiChannelsApi: AIChannelsApiController };

const adminUser = {
  id: '00000000-0000-4000-8000-000000000099',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
} satisfies components['schemas']['User'];

const providers = [
  'OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE_OPENAI', 'ZHIPU', 'QWEN', 'CUSTOM',
] as const;

function createAIChannels(count = 45): AIChannelSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const common = {
      id,
      name: index === 0
        ? '生产 OpenAI 超长渠道名称用于响应式验证'
        : `AI 渠道 ${String(index + 1).padStart(3, '0')}`,
      description: `内容生成渠道 ${index + 1}`,
      protocol_type: 'openai-compatible-chat-completions',
      provider_brand: providers[index % providers.length],
      api_key_configured: true,
      header_count: index % 3,
      model_count: 3,
      enabled_model_count: 2,
      revision: index + 1,
    } as const;
    if (index === 1) {
      return {
        ...common,
        is_enabled: false,
        api_key_configured: false,
        model_count: 0,
        enabled_model_count: 0,
        latest_test_status: 'UNTESTED',
        last_tested_at: null,
        configuration_status: 'NEEDS_SETUP',
        workflow_stage: 'INCOMPLETE',
        primary_task: 'COMPLETE_CONFIGURATION',
        available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
      } satisfies AIChannelSummary;
    }
    if (index === 2) {
      return {
        ...common,
        is_enabled: false,
        latest_test_status: 'PASSED',
        last_tested_at: '2026-08-14T08:00:00Z',
        configuration_status: 'READY',
        workflow_stage: 'READY_TO_ENABLE',
        primary_task: 'ENABLE_CHANNEL',
        available_actions: ['UPDATE', 'REPLACE_API_KEY', 'ENABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
      } satisfies AIChannelSummary;
    }
    if (index === 3) {
      return {
        ...common,
        is_enabled: false,
        enabled_model_count: 0,
        latest_test_status: 'FAILED',
        last_tested_at: '2026-08-14T07:00:00Z',
        configuration_status: 'READY',
        workflow_stage: 'UNVERIFIED',
        primary_task: 'TEST_MODEL',
        available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
      } satisfies AIChannelSummary;
    }
    return {
      ...common,
      is_enabled: true,
      latest_test_status: 'PASSED',
      last_tested_at: new Date(Date.UTC(2026, 7, 14) - index * 60_000).toISOString(),
      configuration_status: 'READY',
      workflow_stage: 'RUNNING',
      primary_task: 'VIEW_RUNTIME',
      available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DISABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
    } satisfies AIChannelSummary;
  });
}

function listAIChannels(items: AIChannelSummary[], url: URL): AIChannelList {
  const query = url.searchParams.get('q')?.toLocaleLowerCase('zh-CN');
  const status = url.searchParams.get('status');
  const provider = url.searchParams.get('provider_brand');
  const sort = url.searchParams.get('sort') ?? 'CREATED_DESC';
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('page_size') ?? 20);
  const base = items.filter((item) => {
    const text = `${item.name} ${item.description}`.toLocaleLowerCase('zh-CN');
    return (!query || text.includes(query)) && (!provider || item.provider_brand === provider);
  });
  const filtered = base.filter((item) => (
    !status || (item.is_enabled ? 'ENABLED' : 'DISABLED') === status
  ));
  if (sort !== 'CREATED_DESC') filtered.sort((left, right) => {
    if (sort === 'NAME_ASC') return left.name.localeCompare(right.name, 'zh-CN');
    if (sort === 'NAME_DESC') return right.name.localeCompare(left.name, 'zh-CN');
    if (sort === 'LAST_TESTED_DESC') {
      return (right.last_tested_at ?? '').localeCompare(left.last_tested_at ?? '');
    }
    return right.revision - left.revision;
  });
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    page_size: pageSize as 10 | 20 | 50,
    total: filtered.length,
    counts: {
      all: base.length,
      enabled: base.filter((item) => item.is_enabled).length,
      disabled: base.filter((item) => !item.is_enabled).length,
    },
  };
}

const test = base.extend<AIChannelFixtures>({
  aiChannelsApi: [async ({ page }, use) => {
    let items = createAIChannels();
    let accountType: AccountType = 'ADMIN';
    let nextConflict: AIChannelCommandRequest['command'] | undefined;
    const listRequests: URL[] = [];
    const commandRequests: AIChannelCommandRequest[] = [];
    const responsePayloads: string[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];
    const allowedHttpErrors: number[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const expectedIndex = allowedHttpErrors.findIndex((status) => text.includes(`status of ${status}`));
      if (expectedIndex >= 0) {
        allowedHttpErrors.splice(expectedIndex, 1);
        return;
      }
      runtimeErrors.push(`console.error: ${text}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        const body = { ...adminUser, account_type: accountType } satisfies components['schemas']['User'];
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        const body = { csrf_token: 'ai-channels-e2e-csrf' } satisfies components['schemas']['CsrfToken'];
        await route.fulfill({ status: 200, json: body });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/ai-channels') {
        listRequests.push(url);
        if (accountType !== 'ADMIN') {
          await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: '仅管理员可访问', details: {}, request_id: 'req-ai-forbidden' } } });
          return;
        }
        const body = listAIChannels(items, url);
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }

      const match = url.pathname.match(/^\/api\/v1\/ai-channels\/([^/]+)(?:\/(enable|disable))?$/);
      if (match && (request.method() === 'POST' || request.method() === 'DELETE')) {
        const channelId = match[1];
        const command = (request.method() === 'DELETE' ? 'delete' : match[2]) as AIChannelCommandRequest['command'];
        const requestBody = request.method() === 'POST'
          ? request.postDataJSON() as components['schemas']['RevisionRequest']
          : null;
        const expectedRevision = requestBody?.expected_revision
          ?? (url.searchParams.has('expected_revision') ? Number(url.searchParams.get('expected_revision')) : null);
        commandRequests.push({
          command,
          channelId,
          expectedRevision,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        const index = items.findIndex((item) => item.id === channelId);
        if (nextConflict === command) {
          nextConflict = undefined;
          await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'AI 渠道已被其他请求修改', details: {}, request_id: 'req-ai-conflict' } } });
          return;
        }
        if (index < 0) {
          await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'AI 渠道不存在', details: {}, request_id: 'req-ai-missing' } } });
          return;
        }
        const current = items[index];
        if (expectedRevision !== current.revision) {
          await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'AI 渠道已被其他请求修改', details: {}, request_id: 'req-ai-stale' } } });
          return;
        }
        if (command === 'delete') {
          items = items.filter((item) => item.id !== channelId);
          await route.fulfill({ status: 204 });
          return;
        }
        const enabled = command === 'enable';
        items[index] = {
          ...current,
          is_enabled: enabled,
          revision: current.revision + 1,
          workflow_stage: enabled ? 'RUNNING' : 'READY_TO_ENABLE',
          primary_task: enabled ? 'VIEW_RUNTIME' : 'ENABLE_CHANNEL',
          available_actions: enabled
            ? current.available_actions.filter((action) => action !== 'ENABLE').concat('DISABLE')
            : current.available_actions.filter((action) => action !== 'DISABLE').concat('ENABLE'),
        };
        responsePayloads.push(JSON.stringify(items[index]));
        await route.fulfill({ status: 200, json: items[index] });
        return;
      }

      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 501, json: { error: { code: 'AI_CHANNEL_FIXTURE_UNEXPECTED_API', message: 'AI 渠道列表发起了未声明的 API 请求' } } });
    });

    await use({
      allowHttpError: (status) => allowedHttpErrors.push(status),
      commandRequests,
      conflictNext: (command) => { nextConflict = command; },
      listRequests,
      responsePayloads,
      setAccountType: (next) => { accountType = next; },
    });
    expect(unexpectedRequests, 'AI 渠道列表不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, 'AI 渠道列表不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { createAIChannels, expect, test };
export type { AIChannelSummary, AIChannelsApiController };
