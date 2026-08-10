import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ContentReviewContext = components['schemas']['ContentReviewContext'];
type ContentVersion = components['schemas']['ContentVersion'];

const taskId = '00000000-0000-4000-8000-000000000001';
const contentVersionId = '00000000-0000-4000-8000-000000000002';
const factVersionId = '00000000-0000-4000-8000-000000000003';
const actorId = '00000000-0000-4000-8000-000000000099';
const auth: AuthContextValue = {
  user: {
    id: actorId,
    username: 'reviewer',
    display_name: '内容审核员',
    account_type: 'ENGINEER',
    is_active: true,
    must_change_password: false,
    workflow_stage: 'ACTIVE',
    primary_task: 'MANAGE_USER',
    available_actions: [],
    deletion: null,
    revision: 1,
    created_at: '2026-08-09T00:00:00Z',
  } satisfies AuthUser,
  csrfToken: 'content-review-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const pendingContent = {
  id: contentVersionId,
  task_id: taskId,
  fact_version_id: factVersionId,
  source_job_id: '00000000-0000-4000-8000-000000000010',
  based_on_id: '00000000-0000-4000-8000-000000000011',
  version: 2,
  source_type: 'AI',
  title: '平台适配内容',
  summary: '内容摘要',
  body_markdown: '# Canonical 内容\n\n新参数',
  tags: ['review'],
  content_hash: 'content-hash',
  status: 'PENDING_REVIEW',
  workflow_stage: 'CURRENT_REVIEW_PENDING',
  primary_task: 'REVIEW_CONTENT',
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  revision: 3,
  quality_issues: [
    { code: 'LONG_TITLE', severity: 'WARNING', message: '标题可能过长' },
  ],
  created_by: actorId,
  created_at: '2026-08-09T01:00:00Z',
} satisfies ContentVersion;

const initialContext = {
  content: pendingContent,
  task: {
    id: taskId,
    product_id: '00000000-0000-4000-8000-000000000004',
    fact_version_id: factVersionId,
    platform_profile_id: '00000000-0000-4000-8000-000000000005',
    query_topic_id: null,
    source_published_content_issue_id: null,
    current_content_version_id: contentVersionId,
    workflow_stage: 'REVIEW_PENDING',
    primary_task: 'REVIEW_CONTENT',
    available_actions: [],
    deletion: null,
    status: 'OPEN',
    revision: 2,
    created_by: actorId,
    created_at: '2026-08-09T00:30:00Z',
    archived_at: null,
  },
  fact_version: {
    id: factVersionId,
    product_id: '00000000-0000-4000-8000-000000000004',
    version: 4,
    status: 'APPROVED',
    body_markdown: '# 批准事实\n\n参数来源明确',
    classification: 'INTERNAL',
    change_summary: '审核批准',
    primary_task: 'CREATE_CONTENT_TASK',
    available_actions: ['RETIRE'],
    deletion: null,
    revision: 1,
    created_by: actorId,
    approved_by: actorId,
    created_at: '2026-08-08T01:00:00Z',
    approved_at: '2026-08-08T02:00:00Z',
  },
  diff: {
    left_id: pendingContent.based_on_id,
    right_id: contentVersionId,
    lines: [
      { kind: 'EQUAL', old_line: 1, new_line: 1, text: '# Canonical 内容' },
      { kind: 'DELETE', old_line: 3, new_line: null, text: '旧参数' },
      { kind: 'ADD', old_line: null, new_line: 3, text: '新参数' },
    ],
  },
  generation_trace: {
    job_id: pendingContent.source_job_id,
    input_snapshot: {
      adapter_name: 'openai-compatible-chat-completions',
      contract_version: 'content-markdown-v3',
      channel: { name: 'internal' },
      model: { id: 'review-model' },
      platform_profile: { name: 'Docs', max_title_length: 60 },
      platform_prompt: {
        id: '00000000-0000-4000-8000-000000000012',
        name: 'Docs Prompt',
        revision: 2,
      },
      fact_version: {
        id: factVersionId,
        product_id: '00000000-0000-4000-8000-000000000004',
        version: 4,
        classification: 'INTERNAL',
      },
      system_message: 'system',
      user_message: 'user',
    },
  },
  humanization_traces: [],
  available_actions: ['APPROVE', 'REQUEST_CHANGES'],
  review_history: [{
    id: '00000000-0000-4000-8000-000000000020',
    target_id: contentVersionId,
    target_version: 2,
    action: 'submit-review',
    comment: '请审核平台适配',
    actor: { id: actorId, username: 'author', display_name: '内容作者' },
    created_at: '2026-08-09T01:30:00Z',
  }],
} satisfies ContentReviewContext;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(min-width: 1280px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderReview(entry = `/content/tasks/${taskId}/review`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

function response<T>(value: T, status = 200) {
  return {
    data: status < 400 ? value : undefined,
    error: status >= 400 ? value : undefined,
    response: Response.json(value, { status }),
  } as never;
}

function reviewedContext(canonical: ContentVersion): ContentReviewContext {
  return {
    ...initialContext,
    content: canonical,
    task: {
      ...initialContext.task,
      workflow_stage: canonical.status === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED',
    },
    available_actions: [],
    review_history: [
      ...initialContext.review_history,
      {
        id: '00000000-0000-4000-8000-000000000021',
        target_id: contentVersionId,
        target_version: 2,
        action: canonical.status === 'APPROVED' ? 'approve' : 'request-changes',
        comment: canonical.status === 'APPROVED' ? '' : '请补充平台限制',
        actor: { id: actorId, username: 'reviewer', display_name: '内容审核员' },
        created_at: '2026-08-09T02:00:00Z',
      },
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ContentReviewPage', () => {
  it('一次 GET 展示 canonical Markdown、issues、fact、snapshot、diff、timeline 与服务端动作', async () => {
    const snapshotContext = {
      ...initialContext,
      content: {
        ...initialContext.content,
        quality_issues: [
          { code: 'MISSING_SOURCE', severity: 'BLOCKING', message: '缺少来源说明' },
          ...initialContext.content.quality_issues,
        ],
      },
      available_actions: ['REQUEST_CHANGES'],
    } satisfies ContentReviewContext;
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(snapshotContext));
    renderReview();

    expect(await screen.findByRole('heading', { name: '平台适配内容', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('内容版本 v2 canonical Markdown')).toHaveTextContent('新参数');
    expect(document.querySelector('.cm-editor')).not.toBeInTheDocument();
    expect(screen.getByText('缺少来源说明')).toBeInTheDocument();
    expect(screen.getByText('标题可能过长')).toBeInTheDocument();
    expect(screen.getByLabelText('事实版本 v4 Markdown 核对依据')).toHaveTextContent('参数来源明确');
    expect(screen.getByText('content-markdown-v3')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '内容版本 canonical Markdown 差异' })).toHaveTextContent('旧参数');
    expect(screen.getByText('提交审核')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准内容' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退回修改' })).toBeEnabled();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/content-tasks/{content_task_id}/review-context', {
      params: { path: { content_task_id: taskId } },
    });
  });

  it.each([
    ['APPROVED', 'APPROVED'],
    ['CHANGES_REQUESTED', 'CHANGES_REQUESTED'],
    ['PENDING_REVIEW', 'REVIEW_PENDING'],
  ] as const)('%s 或无权限状态只读且不从 status 推导动作', async (status, workflowStage) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...initialContext,
      content: { ...pendingContent, status },
      task: { ...initialContext.task, workflow_stage: workflowStage },
      available_actions: [],
    } satisfies ContentReviewContext));
    renderReview();

    expect(await screen.findByText('当前为只读状态，没有可执行的审核动作')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准内容' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退回修改' })).not.toBeInTheDocument();
  });

  it('批准发送 CSRF 与 expected_revision，并重新读取 canonical task context', async () => {
    const user = userEvent.setup();
    const canonical = {
      ...pendingContent,
      status: 'APPROVED',
      workflow_stage: 'CURRENT_APPROVED',
      primary_task: 'START_PUBLICATION',
      available_actions: [],
      revision: 4,
    } satisfies ContentVersion;
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialContext))
      .mockResolvedValue(response(reviewedContext(canonical)));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(canonical));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '批准内容' }));
    const dialog = screen.getByRole('dialog', { name: '批准内容版本 v2？' });
    await user.click(within(dialog).getByRole('button', { name: '确认批准' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/content-versions/{content_version_id}/approve', {
      body: { expected_revision: 3, comment: '' },
      params: {
        path: { content_version_id: contentVersionId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText('内容版本 v2 已批准')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '批准内容' })).not.toBeInTheDocument();
  });

  it('退回 Dialog 校验空白意见，合法请求修剪后发送并恢复触发器焦点', async () => {
    const user = userEvent.setup();
    const canonical = {
      ...pendingContent,
      status: 'CHANGES_REQUESTED',
      workflow_stage: 'CURRENT_CHANGES_REQUESTED',
      primary_task: 'CREATE_REVISION',
      available_actions: ['CREATE_REVISION'],
      revision: 4,
    } satisfies ContentVersion;
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialContext))
      .mockResolvedValue(response(reviewedContext(canonical)));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(canonical));
    renderReview();

    const trigger = await screen.findByRole('button', { name: '退回修改' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '退回内容版本 v2' });
    const comment = within(dialog).getByRole('textbox', { name: '审核意见' });
    expect(comment).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '确认退回' }));
    expect(await within(dialog).findAllByText('退回意见不能为空')).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const reopenedDialog = screen.getByRole('dialog', { name: '退回内容版本 v2' });
    await user.type(
      within(reopenedDialog).getByRole('textbox', { name: '审核意见' }),
      '  请补充平台限制  ',
    );
    await user.click(within(reopenedDialog).getByRole('button', { name: '确认退回' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/content-versions/{content_version_id}/request-changes', {
      body: { expected_revision: 3, comment: '请补充平台限制' },
      params: {
        path: { content_version_id: contentVersionId },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('409 保留审核意见、展示 request ID、刷新 canonical context 且不重放命令', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(initialContext))
      .mockResolvedValue(response(initialContext));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'REVISION_CONFLICT',
        message: '内容版本已被其他请求更新',
        details: { errors: [] },
        request_id: 'req-content-conflict',
      },
    }, 409));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '退回修改' }));
    const dialog = screen.getByRole('dialog', { name: '退回内容版本 v2' });
    const comment = within(dialog).getByRole('textbox', { name: '审核意见' });
    await user.type(comment, '保留这条审核意见');
    await user.click(within(dialog).getByRole('button', { name: '确认退回' }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledOnce();
    expect(comment).toHaveValue('保留这条审核意见');
    expect(within(dialog).getByText('请求 ID：req-content-conflict')).toBeInTheDocument();
  });

  it('结构化 422 字段错误回到意见字段并保留输入', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'GET').mockResolvedValue(response(initialContext));
    vi.spyOn(api, 'POST').mockResolvedValue(response({
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数无效',
        details: { errors: [{ loc: ['body', 'comment'], msg: '审核意见至少需要 5 个字符' }] },
        request_id: 'req-content-validation',
      },
    }, 422));
    renderReview();

    await user.click(await screen.findByRole('button', { name: '退回修改' }));
    const dialog = screen.getByRole('dialog', { name: '退回内容版本 v2' });
    const comment = within(dialog).getByRole('textbox', { name: '审核意见' });
    await user.type(comment, '补充');
    await user.click(within(dialog).getByRole('button', { name: '确认退回' }));

    expect(await within(dialog).findAllByText('审核意见至少需要 5 个字符')).toHaveLength(2);
    expect(within(dialog).getByText('请求 ID：req-content-validation')).toBeInTheDocument();
    expect(comment).toHaveValue('补充');
  });

  it('初始读取失败展示 request ID 与 retry，重试后恢复页面', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response({
        error: {
          code: 'REVIEW_CONTEXT_INCOMPLETE',
          message: '审核上下文不完整',
          details: {},
          request_id: 'req-content-load',
        },
      }, 409))
      .mockResolvedValue(response(initialContext));
    renderReview();

    expect(await screen.findByRole('heading', { name: '内容审核工作台加载失败' })).toBeInTheDocument();
    expect(screen.getByText('请求 ID：req-content-load')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '平台适配内容', level: 1 })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
