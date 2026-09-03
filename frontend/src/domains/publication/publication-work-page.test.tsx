import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import { PublicationWorkPage } from './publication-work-page';
import type { PublicationReadyItem, PublicationWorkSearch } from './publication-work.model';
import { publicationWorkListQueryOptions } from './publication.api';
import {
  account,
  createdWork,
  noAccountReadyItem,
  publicationIds,
  publicationSummary,
  readyItem,
  workListItem,
} from './publication-work.test-fixtures';

function mockPublicationGet({
  empty = false,
  readyItems = [readyItem, noAccountReadyItem],
  total = 1,
}: {
  empty?: boolean;
  readyItems?: PublicationReadyItem[];
  total?: number;
} = {}) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path, request) => {
    if (path === '/api/v1/publication-workbench-summary') {
      return { data: publicationSummary, response: Response.json(publicationSummary) } as never;
    }
    if (path === '/api/v1/publication-ready-items') {
      const data = { items: empty ? [] : readyItems };
      return { data, response: Response.json(data) } as never;
    }
    if (path === '/api/v1/publication-works') {
      const query = (request as { params?: { query?: { page?: number; page_size?: number } } })
        .params?.query;
      const data = {
        items: empty ? [] : [workListItem],
        page: query?.page ?? 1,
        page_size: query?.page_size ?? 20,
        total: empty ? 0 : total,
      };
      return { data, response: Response.json(data) } as never;
    }
    throw new Error(`未声明 GET：${path}`);
  });
}

function renderPage(search: PublicationWorkSearch = { page: 1, pageSize: 20 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const onSearchChange = vi.fn<(...args: [PublicationWorkSearch]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const onContentProjectionChange = vi.fn<(taskId: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PublicationWorkPage
          csrfToken="publication-csrf"
          onContentProjectionChange={onContentProjectionChange}
          onSearchChange={onSearchChange}
          search={search}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { invalidateQueries, onContentProjectionChange, onSearchChange, queryClient, view };
}

function structuredError(status: number, code: string, requestId: string) {
  return {
    error: {
      error: { code, message: '当前发布资格已变化', details: {}, request_id: requestId },
    },
    response: Response.json({}, { status }),
  } as never;
}

function postRequest(value: unknown) {
  return value as {
    body: Record<string, unknown>;
    params: { header: Record<string, string> };
  };
}

async function openStartDialog() {
  await userEvent.click(await screen.findByRole('button', { name: '开始发布' }));
  const dialog = await screen.findByRole('dialog', { name: `开始发布“${readyItem.content_version.title}”` });
  await userEvent.click(within(dialog).getByRole('combobox', { name: '发布账号' }));
  await userEvent.click(await screen.findByRole('option', {
    name: `${account.label} · ${account.account_identifier}`,
  }));
  return dialog;
}

afterEach(() => vi.restoreAllMocks());

describe('PublicationWorkPage', () => {
  it('展示四项摘要、Ready/no-account 与固定六列服务端 work projection', async () => {
    const get = mockPublicationGet();
    renderPage();

    expect(await screen.findByRole('heading', { name: '发布工作' })).toBeInTheDocument();
    const summary = screen.getByRole('heading', { name: '运营摘要' }).closest('section')!;
    expect(await within(summary).findByText('待开始')).toBeInTheDocument();
    expect(within(summary).getByText('进行中')).toBeInTheDocument();
    expect(within(summary).getByText('待核验')).toBeInTheDocument();
    expect(within(summary).getByText('需处理')).toBeInTheDocument();
    expect(within(summary).queryByText('99')).not.toBeInTheDocument();

    expect(screen.getByText('当前平台暂无可用账号。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '开始发布' })).toHaveLength(1);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '内容', '平台 / 账号', '当前阶段', '最近情况', '更新时间', '操作',
    ]);
    expect(screen.getByText('准备中')).toBeInTheDocument();
    expect(screen.getByText('已开始发布')).toBeInTheDocument();
    expect(screen.getByRole('link', {
      name: `${workListItem.product.brand} · ${workListItem.product.part_number}`,
    })).toHaveAttribute(
      'href',
      `/products/${workListItem.product.id}`,
    );
    expect(screen.getByRole('link', { name: '继续准备' })).toHaveAttribute(
      'href',
      `/publishing/work/${workListItem.id}#preparation`,
    );
    await userEvent.click(screen.getByRole('button', { name: `更多操作：${workListItem.content_title}` }));
    expect(await screen.findByRole('menuitem', { name: '关闭发布工作' })).toHaveAttribute(
      'href',
      `/publishing/work/${workListItem.id}#close`,
    );
    expect(get).toHaveBeenCalledWith('/api/v1/publication-works', {
      params: { query: { page: 1, page_size: 20, status: undefined } },
    });
  });

  it('status、pagination 与 pageSize 只通过页面 search callback 更新', async () => {
    mockPublicationGet({ total: 21 });
    const { onSearchChange } = renderPage();
    expect(await screen.findAllByText(workListItem.content_title)).toHaveLength(2);

    await userEvent.click(screen.getByRole('combobox', { name: '当前阶段' }));
    await userEvent.click(await screen.findByRole('option', { name: '需处理' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'ACTION_REQUIRED' });

    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: 2, pageSize: 20 });

    await userEvent.click(screen.getByRole('combobox', { name: '每页条数' }));
    await userEvent.click(await screen.findByRole('option', { name: '50 条/页' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
  });

  it('服务端若返回 START 但没有 matching account，明确报告合同不一致且禁止提交', async () => {
    mockPublicationGet({
      readyItems: [{ ...noAccountReadyItem, available_actions: ['START'] }],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '开始发布' }));
    const dialog = await screen.findByRole('dialog', {
      name: `开始发布“${noAccountReadyItem.content_version.title}”`,
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('没有返回可选账号');
    expect(within(dialog).getByRole('button', { name: '确认开始' })).toBeDisabled();
  });

  it('409 不自动重放，保留账号和 request ID；人工重试复用 key 后采用 canonical ID', async () => {
    mockPublicationGet();
    const post = vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(structuredError(409, 'PUBLICATION_ALREADY_EXISTS', 'req-start-409'))
      .mockResolvedValueOnce({
        data: createdWork,
        response: Response.json(createdWork, { status: 201 }),
      } as never);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const { invalidateQueries, onContentProjectionChange, onSearchChange } = renderPage();
    const dialog = await openStartDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: '确认开始' }));
    expect(await within(dialog).findByText('当前发布资格已变化')).toBeInTheDocument();
    expect(within(dialog).getByText('请求 ID：req-start-409')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: '发布账号' })).toHaveTextContent(account.label);
    expect(post).toHaveBeenCalledOnce();
    expect(onContentProjectionChange).toHaveBeenCalledWith(publicationIds.task);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['publication', 'ready-items'],
      refetchType: 'none',
    });

    await userEvent.click(within(dialog).getByRole('button', { name: '确认开始' }));
    expect(await screen.findByText(createdWork.id)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    const first = postRequest(post.mock.calls[0]![1]);
    const second = postRequest(post.mock.calls[1]![1]);
    expect(first.body).toEqual({
      content_version_id: publicationIds.contentVersion,
      platform_account_id: publicationIds.account,
    });
    expect(first.params.header).toEqual({
      'X-CSRF-Token': 'publication-csrf',
      'Idempotency-Key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(second.params.header['Idempotency-Key']).toBe(first.params.header['Idempotency-Key']);
    expect(onSearchChange).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: undefined });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['publication', 'summary'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['publication', 'ready-items'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['publication', 'works', 'list'] });
    await waitFor(() => expect(screen.getByRole('button', { name: '开始发布' })).toHaveFocus());
  });

  it('pending 阶段阻止重复提交并禁用 Dialog 退出控件', async () => {
    mockPublicationGet();
    let release: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }) as never);
    renderPage();
    const dialog = await openStartDialog();

    await userEvent.dblClick(within(dialog).getByRole('button', { name: '确认开始' }));
    expect(await within(dialog).findByRole('button', { name: '正在创建…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: '发布账号' })).toBeDisabled();
    expect(post).toHaveBeenCalledOnce();
    release?.({ data: createdWork, response: Response.json(createdWork, { status: 201 }) });
    expect(await screen.findByText(createdWork.id)).toBeInTheDocument();
  });

  it('三个 GET surface 独立显示 structured error，也区分全局与筛选空态', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(structuredError(503, 'PUBLICATION_UNAVAILABLE', 'req-get'));
    const failed = renderPage();
    expect(await screen.findAllByRole('alert')).toHaveLength(3);
    failed.view.unmount();

    vi.restoreAllMocks();
    mockPublicationGet({ empty: true });
    const empty = renderPage();
    expect(await screen.findByText('暂无待开始内容')).toBeInTheDocument();
    expect(screen.getByText('暂无活动发布工作')).toBeInTheDocument();
    empty.view.unmount();

    vi.restoreAllMocks();
    mockPublicationGet({ empty: true });
    renderPage({ page: 1, pageSize: 20, status: 'ACTION_REQUIRED' });
    expect(await screen.findByText('未找到匹配工作')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '清除筛选' })).toHaveLength(2);
  });

  it('缓存刷新失败时保留三个投影，并由各区块独立重试', async () => {
    const modes = { summary: 'success', ready: 'success', works: 'success' };
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path, request) => {
      if (path === '/api/v1/publication-workbench-summary') {
        if (modes.summary === 'error') return structuredError(503, 'SUMMARY_REFRESH_FAILED', 'req-summary-refresh');
        return { data: publicationSummary, response: Response.json(publicationSummary) } as never;
      }
      if (path === '/api/v1/publication-ready-items') {
        if (modes.ready === 'error') return structuredError(503, 'READY_REFRESH_FAILED', 'req-ready-refresh');
        const data = { items: [readyItem, noAccountReadyItem] };
        return { data, response: Response.json(data) } as never;
      }
      if (path === '/api/v1/publication-works') {
        if (modes.works === 'error') return structuredError(503, 'WORKS_REFRESH_FAILED', 'req-works-refresh');
        const query = (request as { params?: { query?: { page?: number; page_size?: number } } })
          .params?.query;
        const data = {
          items: [workListItem],
          page: query?.page ?? 1,
          page_size: query?.page_size ?? 20,
          total: 21,
        };
        return { data, response: Response.json(data) } as never;
      }
      throw new Error(`未声明 GET：${path}`);
    });
    const { queryClient } = renderPage();
    expect(await screen.findByText('已开始发布')).toBeInTheDocument();

    modes.summary = 'error';
    modes.ready = 'error';
    modes.works = 'error';
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['publication', 'summary'], exact: true }),
      queryClient.refetchQueries({ queryKey: ['publication', 'ready-items'], exact: true }),
      queryClient.refetchQueries({
        queryKey: publicationWorkListQueryOptions({ page: 1, pageSize: 20 }).queryKey,
        exact: true,
      }),
    ]);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));

    const summary = screen.getByRole('heading', { name: '运营摘要' }).closest('section')!;
    const ready = screen.getByRole('heading', { name: 'Ready Queue' }).closest('section')!;
    const works = screen.getByRole('heading', { name: '发布工作列表' }).closest('section')!;
    expect(within(summary).getByRole('alert')).toHaveTextContent('后台刷新失败，已保留当前数据');
    expect(within(summary).getByRole('alert')).toHaveTextContent('req-summary-refresh');
    expect(within(summary).getByText('待开始')).toBeInTheDocument();
    expect(within(ready).getByRole('alert')).toHaveTextContent('req-ready-refresh');
    expect(within(ready).getByRole('button', { name: '开始发布' })).toBeInTheDocument();
    expect(within(works).getByRole('alert')).toHaveTextContent('req-works-refresh');
    expect(within(works).getByText(workListItem.content_title)).toBeInTheDocument();
    expect(within(works).getByRole('button', { name: '下一页' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(3);

    const countFor = (path: string) => get.mock.calls.filter((call) => call[0] === path).length;
    const summaryRequests = countFor('/api/v1/publication-workbench-summary');
    const readyRequests = countFor('/api/v1/publication-ready-items');
    const workRequests = countFor('/api/v1/publication-works');

    await userEvent.click(within(works).getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(countFor('/api/v1/publication-works')).toBe(workRequests + 1));
    expect(within(works).getByRole('alert')).toHaveTextContent('req-works-refresh');
    expect(within(works).getByText(workListItem.content_title)).toBeInTheDocument();
    expect(within(works).getByRole('button', { name: '下一页' })).toBeInTheDocument();
    const failedWorkRequests = countFor('/api/v1/publication-works');

    modes.summary = 'success';
    await userEvent.click(within(summary).getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(within(summary).queryByRole('alert')).not.toBeInTheDocument());
    expect(countFor('/api/v1/publication-workbench-summary')).toBe(summaryRequests + 1);
    expect(countFor('/api/v1/publication-ready-items')).toBe(readyRequests);
    expect(countFor('/api/v1/publication-works')).toBe(failedWorkRequests);

    modes.ready = 'success';
    await userEvent.click(within(ready).getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(within(ready).queryByRole('alert')).not.toBeInTheDocument());
    expect(countFor('/api/v1/publication-ready-items')).toBe(readyRequests + 1);
    expect(countFor('/api/v1/publication-works')).toBe(failedWorkRequests);

    modes.works = 'success';
    await userEvent.click(within(works).getByRole('button', { name: '重试刷新' }));
    await waitFor(() => expect(within(works).queryByRole('alert')).not.toBeInTheDocument());
    expect(countFor('/api/v1/publication-works')).toBe(failedWorkRequests + 1);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('切换到无缓存的 Work List exact key 初始失败时不回退旧 key 投影', async () => {
    const get = mockPublicationGet();
    const originalImplementation = get.getMockImplementation();
    if (!originalImplementation) throw new Error('Publication GET mock 缺少默认实现');
    let failFilteredWorkList = false;
    get.mockImplementation(async (path, request) => {
      if (path === '/api/v1/publication-works' && failFilteredWorkList) {
        return structuredError(503, 'WORKS_FILTERED_UNAVAILABLE', 'req-works-filtered');
      }
      return originalImplementation(path, request);
    });
    const { onContentProjectionChange, onSearchChange, queryClient, view } = renderPage();
    expect(await screen.findByText('已开始发布')).toBeInTheDocument();

    failFilteredWorkList = true;
    const filteredSearch: PublicationWorkSearch = {
      page: 2,
      pageSize: 20,
      status: 'ACTION_REQUIRED',
    };
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PublicationWorkPage
            csrfToken="publication-csrf"
            onContentProjectionChange={onContentProjectionChange}
            onSearchChange={onSearchChange}
            search={filteredSearch}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const works = screen.getByRole('heading', { name: '发布工作列表' }).closest('section')!;
    await waitFor(() => expect(within(works).getByRole('alert')).toHaveTextContent('req-works-filtered'));
    expect(within(works).queryByRole('row', { name: /PartSignal · PS-LNA-01/ })).not.toBeInTheDocument();
    expect(within(works).queryByRole('navigation', { name: '表格分页' })).not.toBeInTheDocument();
    expect(within(works).getByRole('alert')).toHaveTextContent('发布工作列表加载失败');
  });
});
