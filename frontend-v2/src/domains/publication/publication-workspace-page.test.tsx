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

function mockReads() {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/publication-works/{work_id}/workspace-context') {
      return { data: workspaceContext, response: Response.json(workspaceContext) } as never;
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
});
