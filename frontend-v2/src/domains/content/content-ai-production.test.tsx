import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { ContentAiProduction } from './content-ai-production';

type ContentEditorContext = components['schemas']['ContentEditorContext'];
type ContentVersion = components['schemas']['ContentVersion'];
type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobDetail = components['schemas']['GenerationJobDetail'];

const ids = {
  task: '30000000-0000-4000-8000-000000000001',
  product: '30000000-0000-4000-8000-000000000002',
  fact: '30000000-0000-4000-8000-000000000003',
  content: '30000000-0000-4000-8000-000000000004',
  job: '30000000-0000-4000-8000-000000000005',
  retry: '30000000-0000-4000-8000-000000000006',
  model: '30000000-0000-4000-8000-000000000007',
  channel: '30000000-0000-4000-8000-000000000008',
  prompt: '30000000-0000-4000-8000-000000000009',
  user: '30000000-0000-4000-8000-000000000010',
} as const;

const generationOptions: components['schemas']['GenerationOptions'] = {
  platform_profile_id: '30000000-0000-4000-8000-000000000011',
  platform_profile_name: '工程师社区',
  platform_prompt: {
    id: ids.prompt,
    name: '技术文章 Prompt',
    revision: 7,
    template_markdown: '# 平台 Prompt\n\n只使用批准事实。',
  },
  humanization_prompt_configured: true,
  models: [{
    id: ids.model,
    channel_id: ids.channel,
    channel_name: 'Fixture Channel',
    display_name: 'Fixture Model',
    model_id: 'fixture-model',
  }],
};

function version(): ContentVersion {
  return {
    id: ids.content,
    task_id: ids.task,
    fact_version_id: ids.fact,
    source_job_id: ids.job,
    based_on_id: null,
    version: 1,
    source_type: 'AI',
    title: 'AI 草稿',
    summary: '摘要',
    body_markdown: '# 正文',
    tags: ['AI'],
    content_hash: 'a'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['CREATE_REVISION', 'CREATE_HUMANIZATION_JOB', 'SUBMIT_REVIEW'],
    revision: 0,
    quality_issues: [],
    created_by: ids.user,
    created_at: '2026-08-10T00:00:00Z',
  };
}

function context({
  current = null,
  latest = null,
}: {
  current?: ContentVersion | null;
  latest?: ContentEditorContext['latest_generation'];
} = {}): ContentEditorContext {
  return {
    task: {
      id: ids.task,
      identifier: 'CT-A1B2C3D4',
      status: 'OPEN',
      workflow_stage: current ? 'DRAFT' : latest?.status === 'FAILED' ? 'GENERATION_FAILED' : 'NO_DRAFT',
      primary_task: current
        ? 'EDIT_AND_SUBMIT_REVIEW'
        : latest?.status === 'FAILED'
          ? 'HANDLE_GENERATION_FAILURE'
          : latest
            ? 'VIEW_GENERATION_PROGRESS'
            : 'CREATE_FIRST_DRAFT',
      available_actions: current ? ['CANCEL'] : ['CANCEL', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
      deletion: null,
      revision: 1,
      created_by: ids.user,
      created_at: '2026-08-10T00:00:00Z',
      archived_at: null,
    },
    product: {
      id: ids.product,
      brand: 'PartSignal',
      part_number: 'PS-AI',
      category: 'MCU',
      status: 'ACTIVE',
    },
    platform: {
      id: generationOptions.platform_profile_id,
      name: generationOptions.platform_profile_name,
      website_url: null,
      logo: null,
    },
    locked_fact_version: {
      id: ids.fact,
      version: 2,
      status: 'APPROVED',
      classification: 'PUBLIC',
      body_markdown: '# 批准事实',
    },
    current_content: current,
    comparison_content: null,
    diff: null,
    latest_generation: latest,
    current_lineage: null,
    source: null,
  };
}

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: ids.job,
    content_task_id: ids.task,
    job_type: 'GENERATE',
    source_content_version_id: null,
    status: 'PENDING',
    workflow_stage: 'IN_PROGRESS',
    primary_task: 'VIEW_EXECUTION_PROGRESS',
    available_actions: [],
    attempt_count: 0,
    content_version_id: null,
    retry_of_id: null,
    error_code: null,
    error_summary: null,
    provider_request_id: null,
    response_duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    created_at: '2026-08-10T00:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function renderProduction(editorContext: ContentEditorContext) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ContentAiProduction
        context={editorContext}
        csrfToken="ai-production-csrf"
        taskId={ids.task}
      />
    </QueryClientProvider>,
  );
  return queryClient;
}

function response<T>(value: T, status = 200) {
  return { data: value, response: Response.json(value, { status }) } as never;
}

function apiError(code: string, message: string, requestId: string, status: number) {
  return {
    error: { error: { code, message, details: {}, request_id: requestId } },
    response: Response.json({}, { status }),
  } as never;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ContentAiProduction', () => {
  it('按需加载完整 Prompt，并为同一生成命令复用稳定 Idempotency-Key', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(generationOptions));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(
      apiError('AI_PROVIDER_UNAVAILABLE', '模型暂不可用', 'req-ai-create', 503),
    );
    const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const user = userEvent.setup();
    renderProduction(context());

    expect(get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'AI 生成首稿' }));
    const dialog = await screen.findByRole('dialog', { name: '确认 Prompt 与模型' });
    expect(within(dialog).getByText('技术文章 Prompt')).toBeInTheDocument();
    expect(within(dialog).getByText('Revision 7')).toBeInTheDocument();
    expect(within(dialog).getByText('只使用批准事实。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认 Prompt 与模型并开始生成' })).toBeDisabled();

    await user.click(within(dialog).getByRole('combobox', { name: '模型' }));
    await user.click(await screen.findByRole('option', { name: /Fixture Model/ }));
    const submit = within(dialog).getByRole('button', { name: '确认 Prompt 与模型并开始生成' });
    await user.click(submit);
    expect(await within(dialog).findByText(/模型暂不可用/)).toBeInTheDocument();
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const postCalls = post.mock.calls as unknown as Array<[
      string,
      { params: { header: Record<string, string> } },
    ]>;
    const firstHeaders = postCalls[0]?.[1].params.header;
    const secondHeaders = postCalls[1]?.[1].params.header;
    expect(firstHeaders).toEqual(secondHeaders);
    expect(firstHeaders).toMatchObject({
      'X-CSRF-Token': 'ai-production-csrf',
      'Idempotency-Key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: {
        ai_model_id: ids.model,
        platform_prompt_id: ids.prompt,
        platform_prompt_revision: 7,
      },
    });
    expect(randomUuid).toHaveBeenCalledOnce();
  });

  it('只轮询活动 job，terminal 后停止并刷新 Editor Context', async () => {
    vi.useFakeTimers();
    const pending = job();
    const succeeded = job({
      status: 'SUCCEEDED',
      workflow_stage: 'SUCCEEDED',
      primary_task: 'VIEW_GENERATED_CONTENT',
      content_version_id: ids.content,
      finished_at: '2026-08-10T00:00:02Z',
    });
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response({ items: [pending] }))
      .mockResolvedValue(response({ items: [succeeded] }));
    const editorContext = context({
      latest: {
        id: ids.job,
        job_type: 'GENERATE',
        status: 'PENDING',
        attempt_count: 0,
        error_code: null,
        error_summary: null,
        created_at: pending.created_at,
        started_at: null,
        finished_at: null,
      },
    });
    const queryClient = renderProduction(editorContext);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.getByText(/生成作业成功/)).toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({
      exact: true,
      queryKey: contentKeysForEditor(),
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('完整 detail 仅显式加载，retry 只发送 job ID 和幂等键', async () => {
    const failed = job({
      status: 'FAILED',
      workflow_stage: 'RETRYABLE_FAILURE',
      primary_task: 'HANDLE_FAILURE',
      available_actions: ['RETRY'],
      error_code: 'MODEL_TIMEOUT',
      error_summary: '模型响应超时',
      finished_at: '2026-08-10T00:00:10Z',
    });
    const detail: GenerationJobDetail = {
      ...failed,
      input_snapshot: {
        adapter_name: 'openai-compatible-chat-completions',
        contract_version: 'content-markdown-v3',
        channel: { id: ids.channel, timeout_seconds: 10 },
        model: { id: ids.model, model_id: 'fixture-model', request_parameters: {} },
        platform_profile: { id: generationOptions.platform_profile_id, name: '工程师社区', slug: 'forum' },
        platform_prompt: { id: ids.prompt, name: '技术文章 Prompt', revision: 7 },
        fact_version: { id: ids.fact, product_id: ids.product, version: 2, classification: 'PUBLIC' },
        system_message: '# 平台 Prompt',
        user_message: '# 批准事实',
      },
    };
    const retried = job({ id: ids.retry, retry_of_id: ids.job });
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        return response({ items: [failed] });
      }
      if (path === '/api/v1/generation-jobs/{generation_job_id}') return response(detail);
      throw new Error(`未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(retried, 202));
    const user = userEvent.setup();
    renderProduction(context({ latest: {
      id: ids.job,
      job_type: 'GENERATE',
      status: 'FAILED',
      attempt_count: 1,
      error_code: 'MODEL_TIMEOUT',
      error_summary: '模型响应超时',
      created_at: failed.created_at,
      started_at: failed.started_at ?? null,
      finished_at: failed.finished_at ?? null,
    } }));

    expect(await screen.findByRole('button', { name: '查看完整作业快照' })).toBeInTheDocument();
    const getCalls = get.mock.calls as unknown as Array<[string]>;
    expect(getCalls.filter(([path]) => path === '/api/v1/generation-jobs/{generation_job_id}')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '查看完整作业快照' }));
    const detailDialog = await screen.findByRole('dialog', { name: '完整生成作业快照' });
    expect(await within(detailDialog).findByText(/content-markdown-v3/)).toBeInTheDocument();
    await user.click(within(detailDialog).getAllByRole('button', { name: '关闭' })[0]!);

    await user.click(screen.getByRole('button', { name: '按原快照重试' }));
    const retryDialog = await screen.findByRole('dialog', { name: '按原快照重试？' });
    await user.click(within(retryDialog).getByRole('button', { name: '确认按原快照重试' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith(
      '/api/v1/generation-jobs/{generation_job_id}/retry',
      {
        params: {
          path: { generation_job_id: ids.job },
          header: {
            'X-CSRF-Token': 'ai-production-csrf',
            'Idempotency-Key': expect.any(String),
          },
        },
      },
    );
  });

  it('CREATE_HUMANIZATION_JOB 只提交源版本、模型和稳定幂等键', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') {
        return response(generationOptions);
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        return response({ items: [job({ job_type: 'HUMANIZE', source_content_version_id: ids.content })] });
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const humanization = job({
      job_type: 'HUMANIZE',
      source_content_version_id: ids.content,
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(humanization, 202));
    const user = userEvent.setup();
    renderProduction(context({ current: version() }));

    await user.click(screen.getByRole('button', { name: '创建自然化版本' }));
    const dialog = await screen.findByRole('dialog', { name: '创建自然化作业' });
    expect(within(dialog).getByText(/源版本保持不变/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('combobox', { name: '模型' }));
    await user.click(await screen.findByRole('option', { name: /Fixture Model/ }));
    await user.click(within(dialog).getByRole('button', { name: '确认创建自然化版本' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith(
      '/api/v1/content-versions/{content_version_id}/humanization-jobs',
      {
        body: { ai_model_id: ids.model },
        params: {
          path: { content_version_id: ids.content },
          header: {
            'X-CSRF-Token': 'ai-production-csrf',
            'Idempotency-Key': expect.any(String),
          },
        },
      },
    );
  });
});

function contentKeysForEditor() {
  return ['content', 'tasks', 'editor-context', ids.task] as const;
}
