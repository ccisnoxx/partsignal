import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { contentRequestError } from './content.api';

type ContentTaskList = components['schemas']['ContentTaskList'];
type ContentTaskListItem = components['schemas']['ContentTaskListItem'];
type PlatformProfileList = components['schemas']['PlatformProfileList'];

const admin: AuthUser = {
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
};

const auth: AuthContextValue = {
  user: admin,
  csrfToken: 'content-component-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

const task = {
  id: '00000000-0000-4000-8000-000000000001',
  identifier: 'CT-00000000',
  product_id: '00000000-0000-4000-8000-000000000002',
  fact_version_id: '00000000-0000-4000-8000-000000000003',
  platform_profile_id: '00000000-0000-4000-8000-000000000004',
  query_topic_id: null,
  source_published_content_issue_id: null,
  current_content_version_id: '00000000-0000-4000-8000-000000000006',
  workflow_stage: 'GENERATION_FAILED',
  primary_task: 'REVIEW_CONTENT',
  available_actions: ['CANCEL', 'DELETE', 'CREATE_GENERATION_JOB', 'CREATE_MANUAL_VERSION'],
  deletion: { blockers: [] },
  status: 'OPEN',
  revision: 7,
  created_by: '00000000-0000-4000-8000-000000000005',
  created_at: '2026-08-08T00:00:00Z',
  archived_at: null,
  product: {
    id: '00000000-0000-4000-8000-000000000002',
    brand: 'PartSignal',
    part_number: 'PS-001',
  },
  platform: {
    id: '00000000-0000-4000-8000-000000000004',
    name: '工程师社区',
    website_url: null,
    logo: null,
  },
  current_content: {
    id: '00000000-0000-4000-8000-000000000006',
    version: 3,
    source_type: 'HUMAN',
  },
  latest_generation_status: 'FAILED',
  updated_at: '2026-08-09T00:00:00Z',
} satisfies ContentTaskListItem;

const emptyPlatforms = {
  items: [],
  page: 1,
  page_size: 0,
  total: 0,
  summary: {
    platform_total: 0,
    enabled_total: 0,
    missing_prompt_total: 0,
    configuration_complete_total: 0,
    readiness_complete_total: 0,
    missing_account_total: 0,
  },
  platform_type_options: [],
} satisfies PlatformProfileList;

function taskList(items: ContentTaskListItem[], total = items.length): ContentTaskList {
  return { items, page: 1, page_size: 20, total };
}

function renderContentTasks(
  entry = '/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20',
) {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
    context: { queryClient, auth },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, view };
}

function mockList(items: ContentTaskListItem[]) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/content-tasks') {
      const data = taskList(items);
      return { data, response: Response.json(data) } as never;
    }
    if (path === '/api/v1/platform-profiles') {
      return { data: emptyPlatforms, response: Response.json(emptyPlatforms) } as never;
    }
    throw new Error(`未声明 GET：${path}`);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('ContentTaskListPage', () => {
  it.each([
    [403, 'PERMISSION_DENIED'],
    [404, 'CONTENT_TASK_NOT_FOUND'],
    [422, 'VALIDATION_ERROR'],
  ])('映射 HTTP %s structured error 与 request ID', (status, code) => {
    const error = contentRequestError('执行内容任务命令', {
      error: {
        error: {
          code,
          message: '内容任务命令失败',
          details: {},
          request_id: `req-content-${status}`,
        },
      },
      response: Response.json({}, { status }),
    });
    expect(error).toMatchObject({ status, message: `内容任务命令失败（请求 ID：req-content-${status}）` });
  });

  it('单次列表投影绘制固定六列与服务端阶段、primary 和 overflow', async () => {
    const get = mockList([task]);
    renderContentTasks();

    expect(await screen.findByRole('heading', { name: '内容任务' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建内容任务' })).toHaveAttribute(
      'href',
      '/content/tasks/new',
    );
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '任务', '目标平台', '当前阶段', '当前内容', '最近更新', '操作',
    ]);
    expect(screen.getByRole('link', { name: task.product.part_number })).toHaveAttribute(
      'href',
      `/content/tasks/${task.id}`,
    );
    expect(screen.getByText(task.identifier)).toBeInTheDocument();
    expect(screen.getByText('生成失败')).toBeInTheDocument();
    expect(screen.getByText('v3 · HUMAN')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审核内容' })).toHaveAttribute(
      'href',
      `/content/tasks/${task.id}/review`,
    );
    expect(screen.queryByText('OPEN')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `更多操作：${task.identifier}` }));
    expect(await screen.findByRole('menuitem', { name: '使用 AI 创建初稿' })).toHaveAttribute(
      'href',
      `/content/tasks/${task.id}/editor`,
    );
    expect(screen.getByRole('menuitem', { name: '手动创建初稿' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/content-tasks', {
      params: {
        query: {
          q: undefined,
          workflow_stage: undefined,
          archive_status: 'ACTIVE',
          platform_profile_id: undefined,
          page: 1,
          page_size: 20,
        },
      },
    });
  });

  it('区分 loading、空态、筛选空态与 error retry', async () => {
    let resolveLoading: ((value: unknown) => void) | undefined;
    const get = vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/platform-profiles') {
        return Promise.resolve({
          data: emptyPlatforms,
          response: Response.json(emptyPlatforms),
        }) as never;
      }
      return new Promise((resolve) => { resolveLoading = resolve; }) as never;
    });
    const loading = renderContentTasks();
    expect(await screen.findByRole('rowgroup', { name: '正在加载表格' }))
      .toHaveAttribute('aria-busy', 'true');
    resolveLoading?.({ data: taskList([]), response: Response.json(taskList([])) });
    expect(await screen.findByText('暂无内容任务')).toBeInTheDocument();
    loading.queryClient.clear();
    loading.view.unmount();
    get.mockRestore();

    const filteredGet = mockList([]);
    const filtered = renderContentTasks(
      '/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20&q=missing',
    );
    expect(await screen.findByText('未找到匹配任务')).toBeInTheDocument();
    filtered.view.unmount();
    filteredGet.mockRestore();

    let failList = true;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/platform-profiles') {
        return { data: emptyPlatforms, response: Response.json(emptyPlatforms) } as never;
      }
      if (failList) {
        return {
          error: {
            error: {
              code: 'CONTENT_TASKS_UNAVAILABLE',
              message: '内容任务服务暂不可用',
              details: {},
              request_id: 'req-content-list',
            },
          },
          response: Response.json({}, { status: 503 }),
        } as never;
      }
      return {
        data: taskList([task]),
        response: Response.json(taskList([task])),
      } as never;
    });
    renderContentTasks('/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20&q=error');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '内容任务服务暂不可用（请求 ID：req-content-list）',
    );
    failList = false;
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: task.product.part_number })).toBeInTheDocument();
  });

  it('CANCEL Dialog 发送真实 comment/revision 并返回 overflow 触发点', async () => {
    mockList([task]);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: task,
      response: Response.json(task),
    } as never);
    renderContentTasks();

    const more = await screen.findByRole('button', { name: `更多操作：${task.identifier}` });
    await userEvent.click(more);
    await userEvent.click(await screen.findByRole('menuitem', { name: '取消任务' }));
    const dialog = await screen.findByRole('dialog', { name: `取消任务“${task.identifier}”` });
    await userEvent.type(within(dialog).getByLabelText('取消说明'), '需求已撤销');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认取消' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/content-tasks/{content_task_id}/cancel',
      {
        body: { expected_revision: task.revision, comment: '需求已撤销' },
        params: {
          path: { content_task_id: task.id },
          header: { 'X-CSRF-Token': auth.csrfToken },
        },
      },
    ));
    expect(await screen.findByText('内容任务已取消。')).toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('DELETE 409 不自动重放，显示 request ID 并刷新 projection', async () => {
    const deletable = { ...task, available_actions: ['DELETE'] } satisfies ContentTaskListItem;
    const get = mockList([deletable]);
    const remove = vi.spyOn(api, 'DELETE').mockResolvedValue({
      error: {
        error: {
          code: 'REVISION_CONFLICT',
          message: '内容任务已被其他请求修改',
          details: {},
          request_id: 'req-content-conflict',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderContentTasks();

    await userEvent.click(await screen.findByRole('button', {
      name: `更多操作：${task.identifier}`,
    }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除任务' }));
    const dialog = await screen.findByRole('dialog', {
      name: `确认删除任务“${task.identifier}”`,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '内容任务已被其他请求修改（请求 ID：req-content-conflict）',
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('/api/v1/content-tasks/{content_task_id}', {
      params: {
        path: { content_task_id: task.id },
        query: { expected_revision: task.revision },
        header: { 'X-CSRF-Token': auth.csrfToken },
      },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it('PERMANENT_DELETE 使用实时 preview 和精确确认文本', async () => {
    const archived = {
      ...task,
      archived_at: '2026-08-10T00:00:00Z',
      available_actions: ['RESTORE', 'PERMANENT_DELETE'],
      deletion: null,
    } satisfies ContentTaskListItem;
    const preview = {
      task_id: task.id,
      revision: 9,
      counts: {
        content_versions: 3,
        content_review_records: 1,
        generation_jobs: 2,
        publication_works: 1,
        publication_events: 2,
        publication_verifications: 1,
        published_articles: 1,
        published_content_issues: 0,
        geo_article_relations: 0,
        exclusive_geo_observation_chains: 0,
        attachment_relations: 1,
      },
      external_urls: ['https://community.example.invalid/article/1'],
      confirmation_text: '永久删除',
    } satisfies components['schemas']['ContentTaskPermanentDeletionPreview'];
    const get = mockList([archived]);
    get.mockImplementation(async (path) => {
      if (path === '/api/v1/content-tasks') {
        const data = taskList([archived]);
        return { data, response: Response.json(data) } as never;
      }
      if (path === '/api/v1/platform-profiles') {
        return { data: emptyPlatforms, response: Response.json(emptyPlatforms) } as never;
      }
      if (path === '/api/v1/content-tasks/{content_task_id}/permanent-deletion-preview') {
        return { data: preview, response: Response.json(preview) } as never;
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    renderContentTasks('/content/tasks?archiveStatus=ARCHIVED&page=1&pageSize=20');

    const more = await screen.findByRole('button', { name: `更多操作：${task.identifier}` });
    await userEvent.click(more);
    await userEvent.click(await screen.findByRole('menuitem', { name: '永久删除' }));
    const dialog = await screen.findByRole('dialog', {
      name: `永久删除任务“${task.identifier}”`,
    });
    expect(within(dialog).getByText('https://community.example.invalid/article/1'))
      .toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('输入“永久删除”确认永久删除'),
      '永久删除',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '永久删除' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/content-tasks/{content_task_id}/permanent-delete',
      {
        body: { expected_revision: preview.revision, confirmation_text: '永久删除' },
        params: {
          path: { content_task_id: task.id },
          header: { 'X-CSRF-Token': auth.csrfToken },
        },
      },
    ));
    await waitFor(() => expect(more).toHaveFocus());
  });
});
