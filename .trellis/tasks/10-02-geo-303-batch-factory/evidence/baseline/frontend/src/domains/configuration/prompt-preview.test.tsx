import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { promptKeys } from './prompt.api';
import { PromptPreview } from './prompt-preview';

type ContentVersion = components['schemas']['ContentVersion'];
type GenerationJob = components['schemas']['GenerationJob'];
type PlatformPromptDetail = components['schemas']['PlatformPromptDetail'];
type PreviewOptions = components['schemas']['PlatformPromptPreviewOptions'];

const promptId = '10000000-0000-4000-8000-000000000001';
const firstTaskId = '20000000-0000-4000-8000-000000000001';
const secondTaskId = '20000000-0000-4000-8000-000000000002';
const firstModelId = '30000000-0000-4000-8000-000000000001';
const secondModelId = '30000000-0000-4000-8000-000000000002';
const firstJobId = '40000000-0000-4000-8000-000000000001';
const secondJobId = '40000000-0000-4000-8000-000000000002';
const otherJobId = '40000000-0000-4000-8000-000000000099';
const versionId = '50000000-0000-4000-8000-000000000001';

function prompt(): PlatformPromptDetail {
  return {
    id: promptId,
    name: 'Preview Prompt',
    template_markdown: '# Prompt',
    revision: 4,
    updated_at: '2026-09-25T00:00:00Z',
    updated_by: '60000000-0000-4000-8000-000000000001',
    created_at: '2026-09-24T00:00:00Z',
    bound_platform_count: 1,
    bound_platforms: [{
      id: '70000000-0000-4000-8000-000000000001',
      name: '工程师社区',
      slug: 'engineer-community',
    }],
    available_actions: ['UPDATE', 'DELETE'],
  };
}

function previewOptions(): PreviewOptions {
  return {
    platform_prompt: { id: promptId, name: 'Preview Prompt', revision: 4 },
    contexts: [
      {
        content_task_id: firstTaskId,
        identifier: 'CT-FIRST',
        product_id: '80000000-0000-4000-8000-000000000001',
        brand: 'PartSignal',
        part_number: 'PS-FIRST',
        platform_profile_id: '70000000-0000-4000-8000-000000000001',
        platform_profile_name: '工程师社区',
        fact_version_id: '90000000-0000-4000-8000-000000000001',
        fact_version: 1,
      },
      {
        content_task_id: secondTaskId,
        identifier: 'CT-SECOND',
        product_id: '80000000-0000-4000-8000-000000000002',
        brand: 'PartSignal',
        part_number: 'PS-SECOND',
        platform_profile_id: '70000000-0000-4000-8000-000000000002',
        platform_profile_name: '采购社区',
        fact_version_id: '90000000-0000-4000-8000-000000000002',
        fact_version: 2,
      },
    ],
    models: [
      {
        id: firstModelId,
        channel_id: 'a0000000-0000-4000-8000-000000000001',
        channel_name: '主渠道',
        display_name: '模型 A',
        model_id: 'model-a',
      },
      {
        id: secondModelId,
        channel_id: 'a0000000-0000-4000-8000-000000000002',
        channel_name: '备用渠道',
        display_name: '模型 B',
        model_id: 'model-b',
      },
    ],
  };
}

function generationJob(
  id: string,
  taskId: string,
  status: components['schemas']['GenerationJobStatus'],
): GenerationJob {
  return {
    id,
    content_task_id: taskId,
    job_type: 'GENERATE',
    source_content_version_id: null,
    status,
    workflow_stage: status === 'SUCCEEDED'
      ? 'SUCCEEDED'
      : status === 'FAILED' ? 'HISTORICAL_FAILURE' : 'IN_PROGRESS',
    primary_task: status === 'SUCCEEDED'
      ? 'VIEW_GENERATED_CONTENT'
      : status === 'FAILED' ? 'VIEW_FAILURE' : 'VIEW_EXECUTION_PROGRESS',
    available_actions: [],
    attempt_count: status === 'PENDING' ? 0 : 1,
    content_version_id: status === 'SUCCEEDED' ? versionId : null,
    retry_of_id: null,
    error_code: status === 'FAILED' ? 'PROVIDER_ERROR' : null,
    error_summary: status === 'FAILED' ? '供应商拒绝请求' : null,
    provider_request_id: null,
    response_duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    created_at: '2026-09-25T00:00:00Z',
    started_at: status === 'PENDING' ? null : '2026-09-25T00:00:01Z',
    finished_at: status === 'PENDING' || status === 'RUNNING'
      ? null
      : '2026-09-25T00:00:02Z',
  };
}

function contentVersion(): ContentVersion {
  return {
    id: versionId,
    task_id: firstTaskId,
    fact_version_id: '90000000-0000-4000-8000-000000000001',
    source_job_id: firstJobId,
    based_on_id: null,
    version: 1,
    source_type: 'AI',
    title: '终态 Preview 标题',
    summary: '终态 Preview 摘要',
    body_markdown: '# 终态正文',
    tags: ['preview'],
    content_hash: 'a'.repeat(64),
    status: 'DRAFT',
    workflow_stage: 'CURRENT_DRAFT',
    primary_task: 'EDIT_AND_SUBMIT_REVIEW',
    available_actions: ['SUBMIT_REVIEW'],
    revision: 0,
    quality_issues: [],
    created_by: '60000000-0000-4000-8000-000000000001',
    created_at: '2026-09-25T00:00:02Z',
  };
}

function response<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function renderPreview() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PromptPreview csrfToken="csrf" dirty={false} prompt={prompt()} />
    </QueryClientProvider>,
  );
  return { queryClient, view };
}

async function selectAndRun(contextName: RegExp, modelName: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: 'Test Context' }));
  await user.click(await screen.findByRole('option', { name: contextName }));
  await user.click(screen.getByRole('combobox', { name: '模型' }));
  await user.click(await screen.findByRole('option', { name: modelName }));
  await user.click(screen.getByRole('button', { name: '运行真实 Preview' }));
  const dialog = await screen.findByRole('dialog', { name: '确认创建真实首稿？' });
  await user.click(within(dialog).getByRole('button', { name: '确认创建真实首稿' }));
  return user;
}

afterEach(() => vi.restoreAllMocks());

describe('PromptPreview', () => {
  it('服务端无 contexts/models 时禁用选择和真实 Preview 入口', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({ ...previewOptions(), contexts: [], models: [] }));
    const post = vi.spyOn(api, 'POST');
    renderPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: '运行真实 Preview' })).toBeDisabled());
    expect(screen.getByRole('combobox', { name: 'Test Context' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '模型' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: '运行真实 Preview' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('确认窗口打开后服务端清空候选，不能提交旧 context/model', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(previewOptions()));
    const post = vi.spyOn(api, 'POST');
    const { queryClient } = renderPreview();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Test Context' }));
    await user.click(await screen.findByRole('option', { name: /CT-FIRST/ }));
    await user.click(screen.getByRole('combobox', { name: '模型' }));
    await user.click(await screen.findByRole('option', { name: /模型 A/ }));
    await user.click(screen.getByRole('button', { name: '运行真实 Preview' }));
    const submit = screen.getByRole('button', { name: '确认创建真实首稿' });
    await act(async () => {
      queryClient.setQueryData(promptKeys.previewOptions(promptId), { ...previewOptions(), contexts: [], models: [] });
    });
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    expect(post).not.toHaveBeenCalled();
  });

  it('409 模式拒绝后刷新权威选项并保留公开错误，不重发命令', async () => {
    let closed = false;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
        return response(closed ? { ...previewOptions(), contexts: [], models: [] } : previewOptions());
      }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => {
      closed = true;
      return {
        error: { error: { code: 'AI_GENERATION_DISABLED', message: '当前运行模式已关闭业务 AI 生成', details: {}, request_id: 'preview-mode' } },
        response: Response.json({}, { status: 409 }),
      } as never;
    });
    renderPreview();
    await selectAndRun(/CT-FIRST/, /模型 A/);
    expect(await screen.findByText(/当前运行模式已关闭业务 AI 生成/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建真实首稿' })).toBeDisabled());
    expect(post).toHaveBeenCalledOnce();
  });

  it('POST 采用 Job 后立即释放命令锁，旧消费者刷新挂起时可提交新 Task/model intent', async () => {
    let releaseFirstRead: (() => void) | undefined;
    const firstRead = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefresh = new Promise<void>((resolve) => { releaseFirstRefresh = resolve; });
    vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
        return response(previewOptions());
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        const taskId = (options as unknown as { params: { path: { content_task_id: string } } })
          .params.path.content_task_id;
        if (taskId === firstTaskId) await firstRead;
        const job = taskId === firstTaskId
          ? generationJob(firstJobId, firstTaskId, 'PENDING')
          : generationJob(secondJobId, secondTaskId, 'PENDING');
        return response({ items: [job] });
      }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(response(generationJob(firstJobId, firstTaskId, 'PENDING')))
      .mockResolvedValueOnce(response(generationJob(secondJobId, secondTaskId, 'PENDING')));
    const { queryClient } = renderPreview();
    const invalidate = queryClient.invalidateQueries.bind(queryClient);
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters, options) => {
      if (
        filters?.exact
        && filters?.queryKey?.join('/') === `content/tasks/${firstTaskId}/generation-jobs`
      ) {
        return firstRefresh;
      }
      return invalidate(filters, options);
    });

    await selectAndRun(/CT-FIRST/, /模型 A/);
    expect(await screen.findByText(`Job ${firstJobId}`)).toBeInTheDocument();
    expect(screen.getByText('正在刷新 Preview 相关数据…')).toBeInTheDocument();

    await selectAndRun(/CT-SECOND/, /模型 B/);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(`Job ${secondJobId}`)).toBeInTheDocument();
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: { ai_model_id: secondModelId },
      params: { path: { content_task_id: secondTaskId } },
    });

    await act(async () => {
      releaseFirstRead?.();
      releaseFirstRefresh?.();
    });
  });

  it.each([
    ['缺失', []],
    ['仅含其他 Job', [generationJob(otherJobId, firstTaskId, 'SUCCEEDED')]],
  ])('列表%s时保留 POST Job identity 并显式失败，不切换到其他 Job', async (_case, items) => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
        return response(previewOptions());
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        return response({ items });
      }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValue(response(generationJob(firstJobId, firstTaskId, 'PENDING')));
    renderPreview();

    await selectAndRun(/CT-FIRST/, /模型 A/);
    expect(await screen.findByText(/生成作业列表未包含该作业/)).toBeInTheDocument();
    const result = screen.getByRole('region', { name: 'Preview 结果' });
    expect(within(result).getByText(`Job ${firstJobId}`)).toBeInTheDocument();
    expect(within(result).getByText('读取异常')).toBeInTheDocument();
    expect(within(result).queryByText(`Job ${otherJobId}`)).not.toBeInTheDocument();
    expect(within(result).queryByText('PENDING')).not.toBeInTheDocument();
    expect(within(result).getByRole('button', { name: '重试读取作业状态' })).toBeEnabled();
    expect(get.mock.calls.some((call) => (
      call[0] === '/api/v1/content-versions/{content_version_id}'
    ))).toBe(false);
    expect(post).toHaveBeenCalledOnce();
  });

  it('返回 Job 出现未知状态时显式暴露合同错误且不展示原始状态', async () => {
    const unknown = {
      ...generationJob(firstJobId, firstTaskId, 'PENDING'),
      status: 'PAUSED',
    } as unknown as GenerationJob;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
        return response(previewOptions());
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        return response({ items: [unknown] });
      }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValue(response(generationJob(firstJobId, firstTaskId, 'PENDING')));
    renderPreview();

    await selectAndRun(/CT-FIRST/, /模型 A/);
    expect(await screen.findByText(/服务端返回未知状态“PAUSED”/)).toBeInTheDocument();
    const result = screen.getByRole('region', { name: 'Preview 结果' });
    expect(within(result).getByText(`Job ${firstJobId}`)).toBeInTheDocument();
    expect(within(result).getByText('读取异常')).toBeInTheDocument();
    expect(within(result).queryByText('PAUSED')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledOnce();
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    '只在返回 Job 的 %s 终态展示对应成功内容或真实失败',
    async (status) => {
      const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
        if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
          return response(previewOptions());
        }
        if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
          return response({ items: [generationJob(firstJobId, firstTaskId, status)] });
        }
        if (path === '/api/v1/content-versions/{content_version_id}' && status === 'SUCCEEDED') {
          return response(contentVersion());
        }
        throw new Error(`测试收到未声明 GET：${path}`);
      });
      const post = vi.spyOn(api, 'POST')
        .mockResolvedValue(response(generationJob(firstJobId, firstTaskId, 'PENDING')));
      renderPreview();

      await selectAndRun(/CT-FIRST/, /模型 A/);
      if (status === 'SUCCEEDED') {
        expect(await screen.findByText('终态 Preview 标题')).toBeInTheDocument();
        expect(screen.getByText(`Version ${versionId}`)).toBeInTheDocument();
      } else {
        expect(await screen.findByText('PROVIDER_ERROR：供应商拒绝请求')).toBeInTheDocument();
        expect(screen.queryByText('终态 Preview 标题')).not.toBeInTheDocument();
        expect(get.mock.calls.some((call) => (
          call[0] === '/api/v1/content-versions/{content_version_id}'
        ))).toBe(false);
      }
      expect(post).toHaveBeenCalledOnce();
    },
  );

  it('消费者刷新失败可只读重试且不重发 POST', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-prompts/{platform_prompt_id}/preview-options') {
        return response(previewOptions());
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
        return response({ items: [generationJob(firstJobId, firstTaskId, 'PENDING')] });
      }
      throw new Error(`测试收到未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValue(response(generationJob(firstJobId, firstTaskId, 'PENDING')));
    const { queryClient } = renderPreview();
    const invalidate = queryClient.invalidateQueries.bind(queryClient);
    let failRefresh = true;
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters, options) => {
      if (
        failRefresh
        && filters?.queryKey?.join('/') === 'configuration/prompts/preview-options'
      ) {
        throw new Error('刷新连接断开');
      }
      return invalidate(filters, options);
    });

    const user = await selectAndRun(/CT-FIRST/, /模型 A/);
    expect(await screen.findByText(/Preview 命令已完成，刷新相关数据失败：刷新连接断开/))
      .toBeInTheDocument();
    failRefresh = false;
    await user.click(screen.getByRole('button', { name: '重试刷新 Preview 相关数据' }));
    await waitFor(() => expect(screen.queryByText(/刷新相关数据失败/)).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledOnce();
  });
});
