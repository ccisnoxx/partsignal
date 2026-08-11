import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { workspaceContext } from './publication-work.test-fixtures';
import { PublicationWorkspacePage } from './publication-workspace-page';

const clipboardWrite = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  clipboardWrite.mockClear();
  vi.restoreAllMocks();
});

function PageRoute() {
  const router = useRouter();
  return (
    <PublicationWorkspacePage
      csrfToken="publication-csrf"
      onContentProjectionChange={vi.fn().mockResolvedValue(undefined)}
      onSectionChange={(section) => router.history.push(`/#${section}`)}
      workId={workspaceContext.work.id}
    />
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/', component: PageRoute });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/#summary'] }),
    routeTree: root.addChildren([route]),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function mockReads(
  context: components['schemas']['PublicationWorkspaceContext'] | (() => components['schemas']['PublicationWorkspaceContext']) = workspaceContext,
) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/publication-works/{work_id}/workspace-context') {
      const data = typeof context === 'function' ? context() : context;
      return { data, response: Response.json(data) } as never;
    }
    if (path === '/api/v1/content-versions/{content_version_id}/publication-package') {
      const data = {
        content_version_id: workspaceContext.content.id,
        fact_version_id: '40000000-0000-4000-8000-000000000001',
        title: workspaceContext.content.title,
        body_markdown: workspaceContext.content.body_markdown,
        body_html: '<h1>已批准内容</h1>',
        body_text: '已批准内容',
        tags: workspaceContext.content.tags,
        content_hash: workspaceContext.content.content_hash,
      };
      return { data, response: Response.json(data) } as never;
    }
    throw new Error(`未声明 GET：${path}`);
  });
}

function verificationContext(
  overrides: Partial<components['schemas']['PublicationWorkspaceContext']> = {},
) {
  return {
    ...workspaceContext,
    ...overrides,
    work: {
      ...workspaceContext.work,
      actual_title: '真实发布标题',
      final_url: 'https://community.example.com/articles/lna',
      published_at: '2026-08-11T03:00:00Z',
      status: 'AWAITING_VERIFICATION',
      workflow_stage: 'AWAITING_VERIFICATION',
      primary_task: 'RUN_FIRST_VERIFICATION',
      available_actions: ['VERIFY', 'REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
      revision: 4,
      ...overrides.work,
    },
  } satisfies components['schemas']['PublicationWorkspaceContext'];
}

describe('PublicationWorkspacePage', () => {
  it('首屏只请求 Context，点击后才请求并复制 Package', async () => {
    const get = mockReads();
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: workspaceContext.content.title })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByText(workspaceContext.content.body_markdown.replace('# ', ''))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '复制发布包' }));
    expect(await screen.findByText('发布包已复制。')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining(workspaceContext.content.body_markdown));
  });

  it('409 保留 RHF 输入并要求显式重载，不自动重放命令', async () => {
    const get = mockReads();
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({
      error: {
        error: {
          code: 'PUBLICATION_REVISION_CONFLICT',
          message: '发布工作已变化',
          details: {},
          request_id: 'req-workspace-conflict',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: '更新准备信息' }));
    const dialog = await screen.findByRole('dialog', { name: '更新准备信息' });
    const comment = within(dialog).getByRole('textbox', { name: '备注' });
    await userEvent.type(comment, '保留这段准备说明');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

    expect(await within(dialog).findByText('请求 ID：req-workspace-conflict')).toBeInTheDocument();
    expect(comment).toHaveValue('保留这段准备说明');
    expect(patch).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog).getByRole('button', { name: '显式重载最新工作' }));
    expect(get).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(comment).toHaveValue('保留这段准备说明');
  });

  it('FAILED 校验必选结论与失败说明，并提交一致 payload 后保留真实证据', async () => {
    let current = verificationContext();
    mockReads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path !== '/api/v1/publication-works/{work_id}/verifications') {
        throw new Error(`未声明 POST：${path}`);
      }
      const verification = {
        id: 'a0000000-0000-4000-8000-000000000002',
        content_version_id: current.content.id,
        outcome: 'FAILED',
        actual_title_snapshot: current.work.actual_title!,
        final_url_snapshot: current.work.final_url!,
        published_at_snapshot: current.work.published_at!,
        comment: '公开页正文缺少参数段落',
        actor_id: '80000000-0000-4000-8000-000000000001',
        created_at: '2026-08-11T04:00:00Z',
      } satisfies components['schemas']['PublicationVerification'];
      current = verificationContext({
        work: {
          ...current.work,
          status: 'ACTION_REQUIRED',
          workflow_stage: 'ACTION_REQUIRED',
          primary_task: 'FIX_AND_REVERIFY',
          revision: 5,
          verifications: [verification],
        },
      });
      return { data: current.work, response: Response.json(current.work) } as never;
    });
    renderPage();

    const trigger = await screen.findByRole('button', { name: '核验发布结果' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '核验发布结果' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
    expect(await within(dialog).findAllByText('请选择正文是否与批准内容一致')).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('radio', { name: '不一致，记录失败并进入内容修正' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
    expect(await within(dialog).findAllByText('核验失败必须填写说明')).toHaveLength(2);
    await userEvent.type(within(dialog).getByRole('textbox', { name: /核验说明/ }), '公开页正文缺少参数段落');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

    expect(post).toHaveBeenCalledWith(
      '/api/v1/publication-works/{work_id}/verifications',
      expect.objectContaining({
        body: {
          outcome: 'FAILED',
          content_matches: false,
          expected_revision: 4,
          comment: '公开页正文缺少参数段落',
        },
      }),
    );
    expect(await screen.findByText('公开页正文缺少参数段落')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开 Content Task 修正批准内容' })).toHaveAttribute(
      'href',
      `/content/tasks/${current.work.task_id}`,
    );
    expect(trigger).toHaveFocus();
  });

  it('换版 409 保留说明且不重放，成功后采用新 Context 并聚焦内容版本', async () => {
    const candidate = {
      id: '20000000-0000-4000-8000-000000000002',
      version: 4,
      title: '修订批准内容',
      summary: '修订后的冻结摘要',
      content_hash: 'replacement-hash',
    };
    const awaiting = verificationContext({ switch_candidate: candidate });
    let current = verificationContext({
      switch_candidate: candidate,
      work: {
        ...awaiting.work,
        status: 'ACTION_REQUIRED',
        workflow_stage: 'ACTION_REQUIRED',
        primary_task: 'FIX_AND_REVERIFY',
      },
    });
    let conflict = true;
    mockReads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path !== '/api/v1/publication-works/{work_id}/content-version') {
        throw new Error(`未声明 POST：${path}`);
      }
      if (conflict) {
        return {
          error: { error: { code: 'REVISION_CONFLICT', message: '发布工作已变化', details: {}, request_id: 'req-switch-conflict' } },
          response: Response.json({}, { status: 409 }),
        } as never;
      }
      current = {
        ...current,
        content: {
          ...current.content,
          id: candidate.id,
          version: candidate.version,
          title: candidate.title,
          summary: candidate.summary,
          content_hash: candidate.content_hash,
          body_markdown: '# 修订批准内容',
        },
        switch_candidate: null,
        work: {
          ...current.work,
          content_version_id: candidate.id,
          content_version: candidate.version,
          content_hash: candidate.content_hash,
          primary_task: 'REGISTER_RESULT',
          available_actions: ['REGISTER_RESULT', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
          revision: 5,
        },
      };
      return { data: current.work, response: Response.json(current.work) } as never;
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: '切换内容版本' }));
    const dialog = await screen.findByRole('dialog', { name: '切换内容版本' });
    const comment = within(dialog).getByRole('textbox', { name: '换版说明' });
    await userEvent.type(comment, '采用服务端批准候选');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));
    expect(await within(dialog).findByText('请求 ID：req-switch-conflict')).toBeInTheDocument();
    expect(comment).toHaveValue('采用服务端批准候选');
    expect(post).toHaveBeenCalledTimes(1);

    conflict = false;
    await userEvent.click(within(dialog).getByRole('button', { name: '显式重载最新工作' }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(comment).toHaveValue('采用服务端批准候选');
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

    expect(await screen.findByRole('heading', { level: 2, name: candidate.title })).toBeInTheDocument();
    expect(document.getElementById('content-version')).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(screen.getByRole('button', { name: '登记发布结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '核验发布结果' })).not.toBeInTheDocument();
    expect(screen.getByText('内容版本已切换，请重新登记真实发布结果后再核验。')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('PASSED 后所有 mutation 消失并显示只读 PublishedArticle 交接', async () => {
    let current = verificationContext();
    mockReads(() => current);
    vi.spyOn(api, 'POST').mockImplementation(async (path) => {
      if (path !== '/api/v1/publication-works/{work_id}/verifications') {
        throw new Error(`未声明 POST：${path}`);
      }
      current = verificationContext({
        work: {
          ...current.work,
          status: 'COMPLETED',
          workflow_stage: 'COMPLETED',
          primary_task: 'VIEW_COMPLETION',
          available_actions: [],
          revision: 5,
        },
      });
      return { data: current.work, response: Response.json(current.work) } as never;
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: '核验发布结果' }));
    const dialog = await screen.findByRole('dialog', { name: '核验发布结果' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '一致，通过本次核验' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '确认提交' }));

    expect(await screen.findByText('核验通过，发布成果已冻结为只读。')).toBeInTheDocument();
    expect(screen.getByText(current.work.id)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往发布成果详情' })).toHaveAttribute(
      'href',
      `/publishing/articles/${current.work.id}`,
    );
    expect(screen.queryByRole('button', { name: '核验发布结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记发布结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭发布工作' })).not.toBeInTheDocument();
    expect(screen.getByText('工作已完成并冻结为只读，无需关闭。')).toBeInTheDocument();
  });
});
