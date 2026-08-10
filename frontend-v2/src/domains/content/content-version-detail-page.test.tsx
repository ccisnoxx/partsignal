import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { contentVersionDetailQueryOptions } from './content.api';

type ContentVersionDetail = components['schemas']['ContentVersionDetail'];
type ContentVersionStatus = components['schemas']['ContentVersionStatus'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

const versionId = '10000000-0000-4000-8000-000000000002';
const taskId = '20000000-0000-4000-8000-000000000003';
const factId = '30000000-0000-4000-8000-000000000004';
const productId = '40000000-0000-4000-8000-000000000005';
const actorId = '50000000-0000-4000-8000-000000000006';
const jobId = '60000000-0000-4000-8000-000000000007';
const detailPath = `/content/versions/${versionId}`;

const userAccount: AuthUser = {
  id: actorId,
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-09T00:00:00Z',
};

const auth: AuthContextValue = {
  user: userAccount,
  csrfToken: 'content-version-detail-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const aiDetail = {
  content: {
    id: versionId,
    task_id: taskId,
    fact_version_id: factId,
    source_job_id: jobId,
    based_on_id: null,
    version: 3,
    source_type: 'AI',
    status: 'APPROVED',
    is_current: false,
    title: '长生命周期器件选型指南',
    summary: '冻结摘要，只用于读取。',
    body_markdown: '# Canonical 正文\n\n<script>危险内容</script>\n\n- 工作电压：5V',
    tags: ['MCU', '长生命周期'],
    content_hash: 'a'.repeat(64),
    change_summary: '补充平台适配与审核反馈',
    creator: {
      id: actorId,
      username: 'engineer',
      display_name: '内容工程师',
    },
    created_at: '2026-08-09T01:00:00Z',
    updated_at: '2026-08-09T02:00:00Z',
  },
  fact_version: {
    id: factId,
    product_id: productId,
    version: 2,
    status: 'APPROVED',
    classification: 'PUBLIC',
  },
  generation_lineage: {
    original_generation: {
      job_id: jobId,
      job_type: 'GENERATE',
      source_content_version_id: null,
      contract_version: 'content-markdown-v3',
      channel: { name: '测试渠道' },
      model: { display_name: '测试模型', model_id: 'test-model' },
      prompt: {
        kind: 'PLATFORM',
        id: '70000000-0000-4000-8000-000000000008',
        name: '平台 Prompt',
        revision: 2,
        template_markdown: null,
        system_message: '系统 Prompt',
        user_message: '用户 Prompt',
      },
    },
    humanizations: [],
  },
  review_result: {
    id: '80000000-0000-4000-8000-000000000009',
    target_id: versionId,
    target_version: 3,
    action: 'approve',
    comment: '审核通过',
    actor: {
      id: actorId,
      username: 'engineer',
      display_name: '内容工程师',
    },
    created_at: '2026-08-09T02:00:00Z',
  },
  review_timeline: [{
    id: '80000000-0000-4000-8000-000000000009',
    target_id: versionId,
    target_version: 3,
    action: 'approve',
    comment: '审核通过',
    actor: {
      id: actorId,
      username: 'engineer',
      display_name: '内容工程师',
    },
    created_at: '2026-08-09T02:00:00Z',
  }],
} satisfies ContentVersionDetail;

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

afterEach(() => vi.restoreAllMocks());

function renderDetail(entry = detailPath) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider context={{ queryClient, auth }} router={router} />
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

function errorResponse(status: number, code: string, requestId: string) {
  return response({
    error: {
      code,
      message: '内容版本请求失败',
      details: {},
      request_id: requestId,
    },
  } satisfies ErrorEnvelope, status);
}

describe('ContentVersionDetailPage', () => {
  it('只请求 detail endpoint，展示 sanitized canonical 快照、lineage、审核与返回链接', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(aiDetail));
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: aiDetail.content.title })).toBeInTheDocument();
    expect(screen.getByText('只读 · 不可变快照')).toBeInTheDocument();
    expect(screen.getByLabelText('内容版本 v3 Markdown 快照')).toHaveTextContent('工作电压：5V');
    expect(screen.getByLabelText('内容版本 v3 Markdown 快照')).not.toHaveTextContent('危险内容');
    expect(screen.getByText('平台 Prompt')).toBeInTheDocument();
    expect(screen.getAllByText('批准内容')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '返回所属 Content Task' })).toHaveAttribute(
      'href',
      `/content/tasks/${taskId}`,
    );
    expect(screen.getByRole('link', { name: 'FactVersion v2' })).toHaveAttribute(
      'href',
      `/products/${productId}/facts/versions/${factId}`,
    );
    expect(document.querySelector('.cm-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存|删除|批准|退回|放弃/ })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(
      '/api/v1/content-versions/{content_version_id}/detail',
      { params: { path: { content_version_id: versionId } } },
    );
  });

  it.each([
    ['DRAFT', 'AI', true, '草稿'],
    ['PENDING_REVIEW', 'HUMAN', false, '待审核'],
    ['CHANGES_REQUESTED', 'AI', true, '已退回修改'],
    ['APPROVED', 'HUMAN', false, '已批准'],
    ['SUPERSEDED', 'AI', false, '历史版本'],
    ['ABANDONED', 'HUMAN', true, '已放弃'],
  ] as const)('状态 %s、来源 %s、current=%s 始终只读', async (status, source, current, label) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...aiDetail,
      content: {
        ...aiDetail.content,
        status: status satisfies ContentVersionStatus,
        source_type: source,
        is_current: current,
      },
    } satisfies ContentVersionDetail));
    renderDetail();

    expect(await screen.findAllByText(label)).not.toHaveLength(0);
    expect(screen.getAllByText(source === 'AI' ? 'AI 生成' : '人工创作')).not.toHaveLength(0);
    expect(screen.getAllByText(current ? '当前主线' : '历史版本', {
      selector: '[data-slot="badge"]',
    })).not.toHaveLength(0);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存|删除|批准|退回|放弃/ })).not.toBeInTheDocument();
  });

  it('明确展示 HUMAN legacy 缺失 snapshot、review 与更新时间，并保留长内容', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...aiDetail,
      content: {
        ...aiDetail.content,
        source_type: 'HUMAN',
        status: 'DRAFT',
        body_markdown: `# 长正文\n\n${'可读内容 '.repeat(200)}`,
        tags: ['超长标签'.repeat(20), '人工'],
        change_summary: '变更摘要'.repeat(60),
        source_job_id: null,
        updated_at: null,
      },
      generation_lineage: null,
      review_result: null,
      review_timeline: [],
    } satisfies ContentVersionDetail));
    renderDetail();

    expect(await screen.findByText('该版本没有生成、Prompt 或模型快照。')).toBeInTheDocument();
    expect(screen.getByText('该版本没有审核结果。')).toBeInTheDocument();
    expect(screen.getByText('该版本时点没有审核记录。')).toBeInTheDocument();
    expect(screen.getByText('历史记录未记录')).toBeInTheDocument();
    expect(screen.getByLabelText('内容版本 v3 Markdown 快照')).toHaveTextContent('可读内容');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it.each([
    [404, 'NOT_FOUND', '未找到内容版本'],
    [403, 'PASSWORD_CHANGE_REQUIRED', '无法访问内容版本'],
  ] as const)('处理 %s 错误且不提供无效 retry', async (status, code, title) => {
    vi.spyOn(api, 'GET').mockResolvedValue(errorResponse(status, code, `req-${status}`));
    renderDetail();

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(`请求 ID：req-${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('展示 loading、通用错误与 retry，并在后台刷新失败时保留快照', async () => {
    const user = userEvent.setup();
    let releaseLoading: (() => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementationOnce(() => new Promise((resolve) => {
      releaseLoading = () => resolve(errorResponse(503, 'CONTENT_VERSION_UNAVAILABLE', 'req-error'));
    }));
    const { queryClient } = renderDetail();

    expect(await screen.findByRole('heading', { name: '正在加载内容版本' })).toBeInTheDocument();
    releaseLoading?.();
    expect(await screen.findByRole('heading', { name: '内容版本加载失败' })).toBeInTheDocument();

    get.mockResolvedValueOnce(response(aiDetail));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: aiDetail.content.title })).toBeInTheDocument();

    get.mockResolvedValueOnce(errorResponse(503, 'CONTENT_VERSION_UNAVAILABLE', 'req-refresh'));
    await queryClient.refetchQueries({ queryKey: contentVersionDetailQueryOptions(versionId).queryKey });
    expect(await screen.findByText('刷新内容版本失败，已保留当前不可变快照')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: aiDetail.content.title })).toBeInTheDocument();
  });

  it('URL 与响应 ID 不一致时不泄漏快照', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response({
      ...aiDetail,
      content: { ...aiDetail.content, id: '90000000-0000-4000-8000-000000000010' },
    } satisfies ContentVersionDetail));
    renderDetail();

    expect(await screen.findByRole('heading', { name: '未找到该内容版本' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(aiDetail.content.title)).not.toBeInTheDocument());
    expect(screen.queryByText('补充平台适配与审核反馈')).not.toBeInTheDocument();
  });
});
