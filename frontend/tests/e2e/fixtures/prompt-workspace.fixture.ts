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
type GenerationRequest = {
  body: components['schemas']['OriginalGenerationJobCreate'];
  csrfToken: string | null;
  idempotencyKey: string | null;
  taskId: string;
};
type PromptWorkspaceApiController = {
  generationRequests: GenerationRequest[];
  requests: PromptMutationRequest[];
  setJobOutcome: (outcome: 'SUCCEEDED' | 'FAILED') => void;
  setPreviewMode: (mode: 'normal' | 'empty' | 'error') => void;
};
type PromptFixtures = { promptWorkspaceApi: PromptWorkspaceApiController };

const actorId = '00000000-0000-4000-8000-000000000099';
const firstPromptId = '20000000-0000-4000-8000-000000000001';
const secondPromptId = '20000000-0000-4000-8000-000000000002';
const createdPromptId = '20000000-0000-4000-8000-000000000003';
const platformId = '00000000-0000-4000-8000-000000000001';
const previewTaskId = '30000000-0000-4000-8000-000000000001';
const previewFactVersionId = '40000000-0000-4000-8000-000000000001';
const previewProductId = '50000000-0000-4000-8000-000000000001';
const previewChannelId = '60000000-0000-4000-8000-000000000001';
const previewModelId = '70000000-0000-4000-8000-000000000001';
const previewJobId = '80000000-0000-4000-8000-000000000001';
const previewVersionId = '90000000-0000-4000-8000-000000000001';

function previewOptions(prompt: PromptDetail): components['schemas']['PlatformPromptPreviewOptions'] {
  return {
    platform_prompt: { id: prompt.id, name: prompt.name, revision: prompt.revision },
    contexts: prompt.id === firstPromptId ? [{
      content_task_id: previewTaskId,
      identifier: 'CT-30000000',
      product_id: previewProductId,
      brand: 'PartSignal',
      part_number: 'PS-PREVIEW',
      platform_profile_id: platformId,
      platform_profile_name: '工程师社区 001',
      fact_version_id: previewFactVersionId,
      fact_version: 2,
    }] : [],
    models: prompt.id === firstPromptId ? [{
      id: previewModelId,
      channel_id: previewChannelId,
      channel_name: 'Fixture 渠道',
      display_name: 'Fixture Preview 模型',
      model_id: 'fixture-preview-model',
    }] : [],
  };
}

function generationJob(
  status: components['schemas']['GenerationJobStatus'],
): components['schemas']['GenerationJob'] {
  return {
    id: previewJobId,
    content_task_id: previewTaskId,
    job_type: 'GENERATE',
    source_content_version_id: null,
    status,
    workflow_stage: status === 'SUCCEEDED' ? 'SUCCEEDED' : status === 'FAILED' ? 'HISTORICAL_FAILURE' : 'IN_PROGRESS',
    primary_task: status === 'SUCCEEDED' ? 'VIEW_GENERATED_CONTENT' : status === 'FAILED' ? 'VIEW_FAILURE' : 'VIEW_EXECUTION_PROGRESS',
    available_actions: [],
    attempt_count: status === 'PENDING' ? 0 : 1,
    content_version_id: status === 'SUCCEEDED' ? previewVersionId : null,
    retry_of_id: null,
    error_code: status === 'FAILED' ? 'PROVIDER_ERROR' : null,
    error_summary: status === 'FAILED' ? 'Fixture 供应商拒绝请求' : null,
    provider_request_id: null,
    response_duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    created_at: '2026-08-14T08:00:00Z',
    started_at: status === 'PENDING' ? null : '2026-08-14T08:00:01Z',
    finished_at: status === 'PENDING' || status === 'RUNNING' ? null : '2026-08-14T08:00:02Z',
  };
}

function previewVersion(): components['schemas']['ContentVersion'] {
  return {
    id: previewVersionId,
    task_id: previewTaskId,
    fact_version_id: previewFactVersionId,
    source_job_id: previewJobId,
    based_on_id: null,
    version: 1,
    source_type: 'AI',
    title: 'Fixture Preview 标题',
    summary: 'Fixture Preview 摘要',
    body_markdown: '# Fixture Preview 正文\n\n这是不可变 AI DRAFT。',
    tags: ['fixture', 'preview'],
    content_hash: 'a'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['SUBMIT_REVIEW'],
    revision: 0,
    quality_issues: [],
    created_by: actorId,
    created_at: '2026-08-14T08:00:02Z',
  };
}

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
    const generationRequests: GenerationRequest[] = [];
    let jobOutcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED';
    let jobPolls = 0;
    let previewMode: 'normal' | 'empty' | 'error' = 'normal';

    await page.route('**/api/v1/platform-prompts**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const detailMatch = url.pathname.match(/^\/api\/v1\/platform-prompts\/([^/]+)$/);
      const previewMatch = url.pathname.match(/^\/api\/v1\/platform-prompts\/([^/]+)\/preview-options$/);

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
      if (request.method() === 'GET' && previewMatch) {
        const prompt = prompts.find((item) => item.id === previewMatch[1]);
        if (!prompt) {
          await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Prompt 不存在', details: {}, request_id: 'req-preview-404' } } });
          return;
        }
        if (previewMode === 'error') {
          await route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Preview 选项暂时不可用', details: {}, request_id: 'req-preview-503' } } });
          return;
        }
        const options = previewOptions(prompt);
        await route.fulfill({
          status: 200,
          json: previewMode === 'empty' ? { ...options, contexts: [], models: [] } : options,
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

    await page.route('**/api/v1/content-tasks/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const createMatch = url.pathname.match(/^\/api\/v1\/content-tasks\/([^/]+)\/generation-jobs$/);
      if (!createMatch) {
        await route.fallback();
        return;
      }
      if (request.method() === 'POST') {
        generationRequests.push({
          body: request.postDataJSON() as components['schemas']['OriginalGenerationJobCreate'],
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          idempotencyKey: request.headers()['idempotency-key'] ?? null,
          taskId: createMatch[1]!,
        });
        jobPolls = 0;
        await route.fulfill({ status: 202, json: generationJob('PENDING') });
        return;
      }
      if (request.method() === 'GET') {
        jobPolls += 1;
        await route.fulfill({
          status: 200,
          json: { items: [generationJob(jobPolls === 1 ? 'PENDING' : jobOutcome)] },
        });
        return;
      }
      await route.fallback();
    });

    await page.route('**/api/v1/content-versions/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() === 'GET'
        && url.pathname === `/api/v1/content-versions/${previewVersionId}`
      ) {
        await route.fulfill({ status: 200, json: previewVersion() });
        return;
      }
      await route.fallback();
    });

    await use({
      generationRequests,
      requests,
      setJobOutcome: (outcome) => { jobOutcome = outcome; },
      setPreviewMode: (mode) => { previewMode = mode; },
    });
  }, { auto: true }],
});

export {
  createdPromptId,
  expect,
  firstPromptId,
  platformId,
  previewJobId,
  previewModelId,
  previewTaskId,
  previewVersionId,
  secondPromptId,
  test,
};
export type { GenerationRequest, PromptMutationRequest, PromptWorkspaceApiController };
