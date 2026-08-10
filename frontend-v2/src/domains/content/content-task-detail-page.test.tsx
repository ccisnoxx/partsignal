import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type Detail = components['schemas']['ContentTaskDetail'];

const ids = {
  task: '00000000-0000-4000-8000-000000000001',
  product: '00000000-0000-4000-8000-000000000002',
  fact: '00000000-0000-4000-8000-000000000003',
  platform: '00000000-0000-4000-8000-000000000004',
  content: '00000000-0000-4000-8000-000000000005',
  job: '00000000-0000-4000-8000-000000000006',
  work: '00000000-0000-4000-8000-000000000007',
  topic: '00000000-0000-4000-8000-000000000008',
  issue: '00000000-0000-4000-8000-000000000009',
  actor: '00000000-0000-4000-8000-000000000099',
} as const;

const admin: AuthUser = {
  id: ids.actor,
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
};
const auth: AuthContextValue = {
  user: admin,
  csrfToken: 'detail-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const detail = {
  task: {
    id: ids.task,
    identifier: 'CT-00000000',
    status: 'OPEN',
    workflow_stage: 'PUBLISHING',
    primary_task: 'CONTINUE_PUBLICATION',
    available_actions: ['CANCEL'],
    deletion: null,
    revision: 7,
    created_by: ids.actor,
    created_at: '2026-08-08T00:00:00Z',
    archived_at: null,
  },
  product: { id: ids.product, brand: 'PartSignal', part_number: 'PS-001', status: 'ACTIVE' },
  platform: {
    id: ids.platform,
    name: '工程师社区',
    website_url: 'https://community.example.invalid',
    logo: null,
  },
  fact: { id: ids.fact, version: 3, status: 'APPROVED', classification: 'PUBLIC' },
  current_content: {
    id: ids.content,
    version: 4,
    source_type: 'HUMAN',
    status: 'CHANGES_REQUESTED',
    title: 'PS-001 选型指南',
    summary: '基于已批准事实的内容摘要',
  },
  generation: {
    id: ids.job,
    job_type: 'GENERATE',
    status: 'FAILED',
    attempt_count: 2,
    error_code: 'MODEL_TIMEOUT',
    error_summary: '模型响应超时',
    created_at: '2026-08-08T01:00:00Z',
    started_at: '2026-08-08T01:01:00Z',
    finished_at: '2026-08-08T01:02:00Z',
  },
  review: {
    content_version_id: ids.content,
    status: 'CHANGES_REQUESTED',
    latest_result: {
      action: 'request-changes',
      actor: { id: ids.actor, username: 'admin', display_name: '系统管理员' },
      created_at: '2026-08-08T02:00:00Z',
    },
  },
  publishing: {
    work: { id: ids.work, status: 'ACTION_REQUIRED', updated_at: '2026-08-08T03:00:00Z' },
    result: null,
  },
  source: {
    query_topic: { id: ids.topic, canonical_question: '如何选择 PS-001？' },
    geo_optimization: {
      rule_code: 'QUESTION_COVERAGE_GAP',
      date_from: '2026-08-01',
      date_to: '2026-08-08',
      published_article_id: null,
      geo_platform: 'DeepSeek',
      basis: {
        rule_code: 'QUESTION_COVERAGE_GAP',
        item: {
          canonical_question: '如何选择 PS-001？',
          geo_platform: 'DeepSeek',
        },
      },
    },
    published_content_issue: {
      id: ids.issue,
      kind: 'CONTENT_CHANGED',
      status: 'OPEN',
      published_article_id: ids.work,
      opened_at: '2026-08-08T04:00:00Z',
    },
  },
  activity: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      kind: 'TASK',
      timestamp: '2026-08-08T00:00:00Z',
      actor: { id: ids.actor, username: 'admin', display_name: '系统管理员' },
      summary: 'API 顺序第一项',
      target: { kind: 'CONTENT_TASK', id: ids.task, label: '内容任务' },
    },
    {
      id: '00000000-0000-4000-8000-000000000012',
      kind: 'GENERATION',
      timestamp: '2026-08-09T00:00:00Z',
      actor: { id: ids.actor, username: 'admin', display_name: '系统管理员' },
      summary: 'API 顺序第二项',
      target: { kind: 'GENERATION_JOB', id: ids.job, label: '生成作业' },
    },
  ],
} satisfies Detail;

function renderDetail(entry = `/content/tasks/${ids.task}`) {
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

function detailResponse(value: Detail) {
  return { data: value, response: Response.json(value) } as never;
}

afterEach(() => vi.restoreAllMocks());

describe('ContentTaskDetailPage', () => {
  it('只用一个 Detail GET 绘制 compact sections、canonical links 与服务端 Activity 顺序', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(detail));
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'CT-00000000', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('CONTINUE_PUBLICATION')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '继续发布' })).toHaveAttribute(
      'href',
      `/publishing/work/${ids.work}`,
    );
    expect(screen.getByRole('link', { name: 'PartSignal · PS-001' })).toHaveAttribute(
      'href',
      `/products/${ids.product}`,
    );
    expect(screen.getByRole('link', { name: 'v3 · 已批准' })).toHaveAttribute(
      'href',
      `/products/${ids.product}/facts/versions/${ids.fact}`,
    );
    expect(screen.getByRole('link', { name: 'v4' })).toHaveAttribute(
      'href',
      `/content/versions/${ids.content}`,
    );
    expect(screen.getByText('模型响应超时')).toBeInTheDocument();
    expect(screen.getByText('要求修订')).toBeInTheDocument();
    expect(screen.getByText('问题覆盖缺口')).toBeInTheDocument();
    expect(screen.getByText('内容发生变化 · OPEN')).toBeInTheDocument();

    const activityHeading = screen.getByRole('heading', { name: 'Activity Timeline' });
    const activitySection = activityHeading.closest('section');
    expect(activitySection).not.toBeNull();
    const activityItems = within(activitySection!).getAllByRole('listitem');
    expect(activityItems[0]).toHaveTextContent('API 顺序第一项');
    expect(activityItems[1]).toHaveTextContent('API 顺序第二项');
    const activityText = activitySection!.textContent ?? '';
    expect(activityText.indexOf('API 顺序第一项')).toBeLessThan(activityText.indexOf('API 顺序第二项'));
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/content-tasks/{content_task_id}/detail', {
      params: { path: { content_task_id: ids.task } },
    });
  });

  it('所有 compact 空摘要显式显示“暂无”', async () => {
    const empty = {
      ...detail,
      task: {
        ...detail.task,
        workflow_stage: 'NO_DRAFT',
        primary_task: 'CREATE_FIRST_DRAFT',
      },
      current_content: null,
      generation: null,
      review: null,
      publishing: null,
      source: null,
      activity: [],
    } satisfies Detail;
    vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(empty));
    renderDetail();

    await screen.findByRole('heading', { name: 'CT-00000000' });
    expect(screen.getAllByText('暂无').length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    [404, '未找到内容任务'],
    [403, '无法访问内容任务详情'],
  ])('区分 HTTP %s 预期错误', async (status, heading) => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: {
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'PERMISSION_DENIED',
          message: heading,
          details: {},
          request_id: `req-${status}`,
        },
      },
      response: Response.json({}, { status }),
    } as never);
    renderDetail();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('普通错误支持 retry，成功后只重新读取 Detail endpoint', async () => {
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({
        error: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: '详情服务暂不可用',
            details: {},
            request_id: 'req-retry',
          },
        },
        response: Response.json({}, { status: 503 }),
      } as never)
      .mockResolvedValueOnce(detailResponse(detail));
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: 'CT-00000000' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('409 command 不重放并刷新 canonical detail/list cache', async () => {
    const deletable = {
      ...detail,
      task: {
        ...detail.task,
        available_actions: ['DELETE'],
        deletion: { blockers: [] },
      },
    } satisfies Detail;
    const get = vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(deletable));
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: {
        error: {
          code: 'REVISION_CONFLICT',
          message: '内容任务已被其他请求修改',
          details: {},
          request_id: 'req-detail-conflict',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '更多操作：CT-00000000' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除任务' }));
    const confirm = await screen.findByRole('dialog', { name: '确认删除任务“CT-00000000”' });
    await userEvent.click(within(confirm).getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('req-detail-conflict');
    expect(remove).toHaveBeenCalledOnce();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('deletion blocker 显示真实计数，关闭后焦点返回 overflow trigger', async () => {
    const blocked = {
      ...detail,
      task: {
        ...detail.task,
        deletion: { blockers: [{ type: 'GENERATION_JOB', count: 2 }] },
      },
    } satisfies Detail;
    vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(blocked));
    renderDetail();

    const trigger = await screen.findByRole('button', { name: '更多操作：CT-00000000' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: '查看删除条件' }));
    const dialog = await screen.findByRole('dialog', { name: '任务“CT-00000000”暂不可删除' });
    expect(within(dialog).getByText('运行中的生成作业')).toBeInTheDocument();
    expect(within(dialog).getByText('2')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '返回' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('archived verified state 明确只读，并保持服务端 primary_task', async () => {
    const archived = {
      ...detail,
      task: {
        ...detail.task,
        status: 'COMPLETED',
        workflow_stage: 'VERIFIED',
        primary_task: 'VIEW_FULL_LINEAGE',
        available_actions: ['RESTORE'],
        archived_at: '2026-08-10T00:00:00Z',
      },
    } satisfies Detail;
    vi.spyOn(api, 'GET').mockResolvedValue(detailResponse(archived));
    renderDetail();

    expect(await screen.findByText('只读')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看完整链路' })).toHaveAttribute('href', '#activity');
    expect(screen.getByText('VIEW_FULL_LINEAGE')).toBeInTheDocument();
  });
});
