import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { RunsPage } from './runs-page';
import { runSearchSchema, type RunSearch } from './runs.model';
import { asOf, batch, detail, run, runId } from './runs.test-support';
function response(data: unknown) {
  return { data, response: Response.json(data) } as never;
}
function renderPage(search: RunSearch) {
  const client = createAppQueryClient();
  const change = vi.fn();
  const root = createRootRoute();
  let update!: Dispatch<SetStateAction<RunSearch>>;
  function TestPage() {
    const [current, setCurrent] = useState(search);
    update = setCurrent;
    return <RunsPage csrfToken="csrf" onSearchChange={change} search={current} />;
  }
  const route = createRoute({ getParentRoute: () => root, path: '/geo/runs', component: TestPage });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/geo/runs'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, change, updateSearch: (next: RunSearch) => act(() => update(next)) };
}
afterEach(() => vi.restoreAllMocks());
describe('运行中心双层页面', () => {
  it('从完整批次进入运行视图，过滤、页码、选择由 URL 更新负责', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(
      response({ items: [batch()], total: 31, page: 2, page_size: 20, as_of: asOf }),
    );
    const { change } = renderPage(runSearchSchema.parse({ page: 2, q: '冻结计划' }));
    await userEvent.click(await screen.findByRole('button', { name: '待人工录入' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ view: 'runs', batch_id: batch().id }));
    await userEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(change).toHaveBeenLastCalledWith({ q: '冻结计划' });
  });
  it('运行主任务和动作由读模型裁决，历史运行可以查看但不能猜测重试动作', async () => {
    const historic = run({
      id: batch().id,
      primary_task: 'VIEW_FAILURE',
      workflow_stage: 'HISTORICAL_FAILURE',
      available_actions: [],
      status: 'FAILED',
      is_latest_attempt: false,
    });
    vi.spyOn(api, 'GET').mockResolvedValue(
      response({ items: [historic], total: 1, page: 1, page_size: 20, as_of: asOf }),
    );
    const { change } = renderPage({ view: 'runs' });
    await userEvent.click(await screen.findByRole('button', { name: '查看失败' }));
    expect(change).toHaveBeenCalledWith({ view: 'runs', run_id: historic.id });
    expect(screen.queryByRole('button', { name: '重试运行' })).not.toBeInTheDocument();
  });
  it('等待真实提交 promise期间更改筛选和分页，迟到回执只退出编辑且保留最新URL意图', async () => {
    const initial = {
      answer_text: '已保存原文',
      answer_format: 'TEXT',
      source_product: null,
      source_model: null,
      source_version: null,
      web_search_observed: null,
      raw_payload_summary: { schema_version: 1, payload_format: null, payload_bytes: null, finish_reason: null },
      raw_payload_file_id: null,
      screenshot_file_id: batch().id,
      citations: [],
      collected_at: asOf,
    };
    const context = {
      run_id: runId,
      batch_id: batch().id,
      run_revision: 1,
      draft_revision: 1,
      draft: { run_id: runId, draft_revision: 1, draft: initial, updated_by: runId, updated_at: asOf },
      input_snapshot: run().input_snapshot,
      require_screenshot: true,
      collection_blockers: [],
      workflow_stage: 'MANUAL_ENTRY_REQUIRED',
      primary_task: 'ENTER_MANUAL_OBSERVATION',
      available_actions: ['ENTER_MANUAL_OBSERVATION'],
    };
    vi.spyOn(api, 'GET').mockImplementation(async (path) =>
      response(
        path === '/api/v1/geo/observation-runs/{run_id}/manual-entry'
          ? context
          : path === '/api/v1/geo/observation-runs/{run_id}'
            ? detail()
            : { items: [run()], total: 100, page: 2, page_size: 20, as_of: asOf },
      ),
    );
    let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { change, updateSearch } = renderPage({ view: 'runs', run_id: runId, edit: 1, q: 'before', page: 2 });
    await userEvent.click(await screen.findByRole('button', { name: '正式提交人工观测' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    updateSearch({ view: 'runs', run_id: runId, edit: 1, q: 'after', page: 5 });
    await act(async () =>
      release(
        response({
          run_id: runId,
          answer_snapshot_id: batch().id,
          answer_sha256: 'a'.repeat(64),
          run_revision: 2,
          draft_revision: 1,
          collected_at: asOf,
          submitted_at: asOf,
          collection_status: 'COLLECTED',
          analysis_dispatch: 'NOT_IMPLEMENTED',
        }),
      ),
    );
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({ view: 'runs', run_id: runId, q: 'after', page: 5 }, true, true),
    );
  });
  it('401/403 不提供无效重试，临时读取失败允许显式恢复', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { code: 'FORBIDDEN', message: '权限不足', request_id: 'denied', details: {} } },
      response: Response.json({}, { status: 403 }),
    } as never);
    renderPage({ view: 'runs' });
    expect(await screen.findByRole('alert')).toHaveTextContent('当前资源不可访问');
    expect(screen.queryByRole('button', { name: '重试读取' })).not.toBeInTheDocument();
  });
  it.each(['filters', 'selection'])('新尝试迟到回执保留%s后的当前URL意图', async (intent) => {
    const failed = detail();
    failed.run = { ...failed.run, status: 'FAILED', workflow_stage: 'RETRYABLE_FAILURE', available_actions: ['RETRY'] };
    vi.spyOn(api, 'GET').mockImplementation(async (path) => response(
      path === '/api/v1/geo/observation-runs/{run_id}' ? failed : { items: [failed.run], total: 100, page: 1, page_size: 20, as_of: asOf },
    ));
    let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { change, updateSearch } = renderPage({ view: 'runs', run_id: runId, q: 'before' });
    await userEvent.click(await screen.findByRole('button', { name: '创建新采集尝试' }));
    await userEvent.click(screen.getByRole('button', { name: '确认创建新尝试' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    updateSearch({ view: 'runs', run_id: intent === 'selection' ? undefined : runId, q: 'after', page: 5 });
    const id = '10000000-0000-4000-8000-000000000009';
    await act(async () => release(response({ run_id: id, batch_id: failed.run.batch_id, previous_attempt_id: runId, attempt_no: failed.run.attempt_no + 1, created_at: asOf })));
    if (intent === 'filters') await waitFor(() => expect(change).toHaveBeenCalledWith({ view: 'runs', run_id: id, q: 'after', page: 5 }, true));
    else expect(change).not.toHaveBeenCalled();
  });
  it('详情不丢 URL 列表筛选，使用单一运行读模型展示证据', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) =>
      response(
        path === '/api/v1/geo/observation-runs/{run_id}'
          ? detail()
          : { items: [run()], total: 1, page: 1, page_size: 20, as_of: asOf },
      ),
    );
    const { change } = renderPage({ view: 'runs', run_id: runId, q: '冻结', page_size: 10 });
    expect(await screen.findByRole('region', { name: '运行详情' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '关闭运行详情' }));
    expect(change).toHaveBeenCalledWith({ view: 'runs', q: '冻结', page_size: 10 });
  });
});
