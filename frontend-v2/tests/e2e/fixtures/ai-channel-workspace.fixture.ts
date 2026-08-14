/** AI Channel Workspace production-artifact fixture；在 List 严格边界上声明已交付请求。 */
import { expect, test as aiChannelsTest } from './ai-channels.fixture';
import type { components } from '../../../src/shared/api/generated/schema';

type AIChannel = components['schemas']['AIChannel'];
type AIChannelCreate = components['schemas']['AIChannelCreate'];
type AIChannelUpdate = components['schemas']['AIChannelUpdate'];
type AIModel = components['schemas']['AIModel'];
type AIModelCreate = components['schemas']['AIModelCreate'];
type AIModelUpdate = components['schemas']['AIModelUpdate'];
type AIChannelUsageSummary = components['schemas']['AIChannelUsageSummary'];
type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];
type AIChannelCreateRecord = Omit<AIChannelCreate, 'api_key'> & { api_key_present: boolean };

type WorkspaceRequest = {
  body?: unknown;
  csrfToken: string | null;
  method: string;
  path: string;
  revision?: number;
};

type RuntimeRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
};

type AIChannelWorkspaceApiController = {
  conflictNextUpdate: () => void;
  conflictNextModelMutation: () => void;
  createRequests: AIChannelCreateRecord[];
  detailRequests: string[];
  failNextRuntimeRequest: (path: 'usage' | 'logs' | 'detail', status?: number) => void;
  mutationRequests: WorkspaceRequest[];
  responsePayloads: string[];
  runtimeRequests: RuntimeRequest[];
  setRuntimePrimaryTasks: () => void;
  setUnsafeAuditDetail: (unsafe: boolean) => void;
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

function createWorkspaceModel(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: '92000000-0000-4000-8000-000000000001',
    channel_id: channelId,
    display_name: 'Workspace Model',
    model_id: 'workspace-model',
    request_parameters: { temperature: 0 },
    is_enabled: false,
    test_status: 'UNTESTED',
    last_tested_at: null,
    last_test_error_summary: null,
    workflow_stage: 'UNTESTED',
    primary_task: 'TEST_CONNECTION',
    available_actions: ['UPDATE', 'TEST', 'DELETE'],
    revision: 2,
    created_by: '00000000-0000-4000-8000-000000000099',
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

function createUsageSummary(period: components['schemas']['AIUsagePeriod']): AIChannelUsageSummary {
  return {
    channel_id: channelId,
    period,
    period_started_at: period === 'all' ? null : '2026-07-15T00:00:00Z',
    period_ended_at: '2026-08-14T00:00:00Z',
    total_jobs: period === '7d' ? 7 : 0,
    succeeded_jobs: period === '7d' ? 6 : 0,
    failed_jobs: period === '7d' ? 1 : 0,
    success_rate: period === '7d' ? 6 / 7 : null,
    average_response_duration_ms: period === '7d' ? 1200 : null,
    prompt_tokens: period === '7d' ? 700 : null,
    completion_tokens: period === '7d' ? 350 : null,
    total_tokens: period === '7d' ? 1050 : null,
    last_used_at: period === '7d' ? '2026-08-13T23:00:00Z' : null,
  };
}

function createAuditLogs(): AuditLog[] {
  return Array.from({ length: 21 }, (_, index) => ({
    id: `93000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    actor_id: index === 1 ? null : '00000000-0000-4000-8000-000000000099',
    actor: index === 1 ? null : {
      id: '00000000-0000-4000-8000-000000000099',
      display_name: '系统管理员',
      account_type: 'ADMIN',
    },
    business_module: 'CONFIGURATION',
    action: index % 2 === 0 ? 'ai_channel.updated' : 'ai_model.enabled',
    target_type: index % 2 === 0 ? 'AIChannel' : 'AIModel',
    target_id: index % 2 === 0 ? channelId : '92000000-0000-4000-8000-000000000001',
    outcome: 'SUCCESS',
    change_summary: index % 2 === 0
      ? { revision: index + 5, changes: [{ field: 'revision', before: index + 4, after: index + 5 }] }
      : { channel_id: channelId, status: 'ENABLED' },
    primary_task: 'VIEW_LOG_DETAIL',
    request_id: `req-runtime-${index + 1}`,
    created_at: new Date(Date.UTC(2026, 7, 14, 9) - index * 60_000).toISOString(),
  }));
}

function createAuditDetail(log: AuditLog, unsafe: boolean): AuditLogDetail {
  return {
    ...log,
    changes: unsafe
      ? [{ field: 'revision', before: 4, after: { nested: true } }]
      : [{ field: 'revision', before: 4, after: 5 }],
    facts: { revision: 5 },
    result_message: '配置变更已记录',
    error_code: null,
    related_entry: {
      status: 'AVAILABLE',
      kind: log.target_type,
      parent_id: log.target_type === 'AIModel' ? channelId : null,
    },
  };
}

const test = aiChannelsTest.extend<WorkspaceFixtures>({
  aiChannelWorkspaceApi: [async ({ page }, use) => {
    let channel = createWorkspaceChannel();
    let models = [createWorkspaceModel()];
    let nextUpdateConflict = false;
    let nextModelMutationConflict = false;
    let nextRuntimeFailure: { path: 'usage' | 'logs' | 'detail'; status: number } | undefined;
    let unsafeAuditDetail = false;
    const auditLogs = createAuditLogs();
    const createRequests: AIChannelCreateRecord[] = [];
    const detailRequests: string[] = [];
    const mutationRequests: WorkspaceRequest[] = [];
    const responsePayloads: string[] = [];
    const runtimeRequests: RuntimeRequest[] = [];

    await page.route('**/api/v1/**', async (route, request) => {
      const url = new URL(request.url());
      const csrfToken = request.headers()['x-csrf-token'] ?? null;

      if (request.method() === 'POST' && url.pathname === '/api/v1/ai-channels') {
        const body = request.postDataJSON() as AIChannelCreate;
        createRequests.push({
          name: body.name,
          description: body.description,
          protocol_type: body.protocol_type,
          provider_brand: body.provider_brand,
          base_url: body.base_url,
          timeout_seconds: body.timeout_seconds,
          api_key_present: body.api_key.length > 0,
        });
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
        mutationRequests.push({
          body: { api_key_present: body.api_key.length > 0 },
          csrfToken,
          method: 'POST',
          path: url.pathname,
        });
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

      if (request.method() === 'GET' && url.pathname === `/api/v1/ai-channels/${channel.id}/usage-summary`) {
        runtimeRequests.push({ method: 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams) });
        if (nextRuntimeFailure?.path === 'usage') {
          const status = nextRuntimeFailure.status;
          nextRuntimeFailure = undefined;
          await route.fulfill({ status, json: { error: { code: 'RUNTIME_FAILED', message: '使用统计暂时不可用', details: {}, request_id: 'req-runtime-usage-failed' } } });
          return;
        }
        const period = (url.searchParams.get('period') ?? '30d') as components['schemas']['AIUsagePeriod'];
        const body = createUsageSummary(period);
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }

      if (request.method() === 'GET' && url.pathname === `/api/v1/ai-channels/${channel.id}/audit-logs`) {
        runtimeRequests.push({ method: 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams) });
        if (nextRuntimeFailure?.path === 'logs') {
          const status = nextRuntimeFailure.status;
          nextRuntimeFailure = undefined;
          await route.fulfill({ status, json: { error: { code: 'RUNTIME_FAILED', message: '操作日志暂时不可用', details: {}, request_id: 'req-runtime-logs-failed' } } });
          return;
        }
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 20);
        const body = {
          items: auditLogs.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          page: pageNumber,
          page_size: pageSize,
          total: auditLogs.length,
        } satisfies components['schemas']['AuditLogList'];
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
        return;
      }

      const auditDetailMatch = url.pathname.match(/^\/api\/v1\/audit-logs\/([^/]+)$/);
      if (request.method() === 'GET' && auditDetailMatch) {
        runtimeRequests.push({ method: 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams) });
        if (nextRuntimeFailure?.path === 'detail') {
          const status = nextRuntimeFailure.status;
          nextRuntimeFailure = undefined;
          await route.fulfill({ status, json: { error: { code: 'RUNTIME_FAILED', message: '日志详情暂时不可用', details: {}, request_id: 'req-runtime-detail-failed' } } });
          return;
        }
        const log = auditLogs.find((item) => item.id === auditDetailMatch[1]);
        if (!log) {
          await route.fulfill({ status: 404, json: { error: { code: 'AUDIT_LOG_NOT_FOUND', message: '审计日志不存在', details: {}, request_id: 'req-runtime-detail-404' } } });
          return;
        }
        const body = createAuditDetail(log, unsafeAuditDetail);
        responsePayloads.push(JSON.stringify(body));
        await route.fulfill({ status: 200, json: body });
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
        mutationRequests.push({
          body: { expected_revision: body.expected_revision, api_key_present: body.api_key.length > 0 },
          csrfToken,
          method: 'PUT',
          path: url.pathname,
          revision: body.expected_revision,
        });
        channel = { ...channel, api_key_configured: true, revision: channel.revision + 1 };
        responsePayloads.push(JSON.stringify(channel));
        await route.fulfill({ status: 200, json: channel });
        return;
      }

      if (request.method() === 'POST' && url.pathname === `/api/v1/ai-channels/${channel.id}/headers`) {
        const body = request.postDataJSON() as components['schemas']['AIChannelHeaderCreate'];
        mutationRequests.push({
          body: {
            expected_channel_revision: body.expected_channel_revision,
            name: body.name,
            is_sensitive: body.is_sensitive,
            value_present: body.value.length > 0,
          },
          csrfToken,
          method: 'POST',
          path: url.pathname,
          revision: body.expected_channel_revision,
        });
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

      if (url.pathname === `/api/v1/ai-channels/${channel.id}/models`) {
        if (request.method() === 'GET') {
          responsePayloads.push(JSON.stringify({ items: models }));
          await route.fulfill({ status: 200, json: { items: models } });
          return;
        }
        if (request.method() === 'POST') {
          const body = request.postDataJSON() as AIModelCreate;
          const model = createWorkspaceModel({
            id: `92000000-0000-4000-8000-${String(models.length + 1).padStart(12, '0')}`,
            display_name: body.display_name,
            model_id: body.model_id,
            request_parameters: body.request_parameters,
            revision: 0,
          });
          models = [...models, model];
          mutationRequests.push({ body, csrfToken, method: 'POST', path: url.pathname });
          await route.fulfill({ status: 201, json: model });
          return;
        }
      }

      if (request.method() === 'POST' && url.pathname === `/api/v1/ai-channels/${channel.id}/discover-models`) {
        const body = request.postDataJSON() as components['schemas']['RevisionRequest'];
        mutationRequests.push({ body, csrfToken, method: 'POST', path: url.pathname, revision: body.expected_revision });
        await route.fulfill({ status: 200, json: { items: [
          { model_id: 'workspace-model', configured: true, primary_task: 'VIEW_CONFIGURED_MODEL' },
          { model_id: 'remote-new-model', configured: false, primary_task: 'ADD_MODEL' },
        ] } });
        return;
      }

      const modelMatch = url.pathname.match(/^\/api\/v1\/ai-models\/([^/]+)(?:\/(test|enable|disable))?$/);
      if (modelMatch) {
        const modelIndex = models.findIndex((item) => item.id === modelMatch[1]);
        if (modelIndex < 0) {
          await route.fulfill({ status: 404, json: { error: { code: 'AI_MODEL_NOT_FOUND', message: 'AI 模型不存在', details: {}, request_id: 'req-ai-model-404' } } });
          return;
        }
        const current = models[modelIndex]!;
        const operation = modelMatch[2];
        if (request.method() === 'PATCH' && !operation) {
          const body = request.postDataJSON() as AIModelUpdate;
          mutationRequests.push({ body, csrfToken, method: 'PATCH', path: url.pathname, revision: body.expected_revision });
          if (nextModelMutationConflict) {
            nextModelMutationConflict = false;
            models[modelIndex] = { ...current, display_name: '服务端最新模型', revision: current.revision + 1 };
            await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'AI 模型已被其他请求修改', details: {}, request_id: 'req-ai-model-conflict' } } });
            return;
          }
          const updated = { ...current, ...body, display_name: body.display_name, model_id: body.model_id, request_parameters: body.request_parameters, revision: current.revision + 1 };
          models[modelIndex] = updated;
          await route.fulfill({ status: 200, json: updated });
          return;
        }
        if (request.method() === 'POST' && operation) {
          const body = request.postDataJSON() as components['schemas']['RevisionRequest'];
          mutationRequests.push({ body, csrfToken, method: 'POST', path: url.pathname, revision: body.expected_revision });
          const updated = operation === 'test'
            ? { ...current, test_status: 'PASSED' as const, workflow_stage: 'READY_TO_ENABLE' as const, primary_task: 'ENABLE_MODEL' as const, available_actions: ['UPDATE', 'TEST', 'ENABLE', 'DELETE'] as AIModel['available_actions'], is_enabled: false, last_tested_at: '2026-08-14T02:00:00Z', revision: current.revision + 1 }
            : { ...current, is_enabled: operation === 'enable', workflow_stage: operation === 'enable' ? 'CHANNEL_DISABLED' as const : 'READY_TO_ENABLE' as const, primary_task: operation === 'enable' ? 'ENABLE_CHANNEL' as const : 'ENABLE_MODEL' as const, available_actions: operation === 'enable' ? ['UPDATE', 'TEST', 'DISABLE', 'DELETE'] as AIModel['available_actions'] : ['UPDATE', 'TEST', 'ENABLE', 'DELETE'] as AIModel['available_actions'], revision: current.revision + 1 };
          models[modelIndex] = updated;
          await route.fulfill({ status: 200, json: updated });
          return;
        }
        if (request.method() === 'DELETE' && !operation) {
          const revision = Number(url.searchParams.get('expected_revision'));
          mutationRequests.push({ csrfToken, method: 'DELETE', path: url.pathname, revision });
          models = models.filter((item) => item.id !== current.id);
          await route.fulfill({ status: 204 });
          return;
        }
      }

      await route.fallback();
    });

    await use({
      conflictNextUpdate: () => { nextUpdateConflict = true; },
      conflictNextModelMutation: () => { nextModelMutationConflict = true; },
      createRequests,
      detailRequests,
      failNextRuntimeRequest: (path, status = 500) => { nextRuntimeFailure = { path, status }; },
      mutationRequests,
      responsePayloads,
      runtimeRequests,
      setRuntimePrimaryTasks: () => {
        channel = {
          ...channel,
          is_enabled: true,
          primary_task: 'VIEW_RUNTIME',
          available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DISABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'],
        };
        models = models.map((model) => ({
          ...model,
          primary_task: 'VIEW_MODEL_RUNTIME',
          available_actions: ['UPDATE', 'DELETE'],
        }));
      },
      setUnsafeAuditDetail: (unsafe) => { unsafeAuditDetail = unsafe; },
    });
  }, { auto: true }],
});

export { channelId, expect, test };
export type { AIChannelWorkspaceApiController };
