import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClientProvider,
  QueryObserver,
  useQuery,
} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import {
  initializePrincipalEpoch,
  invalidatePrincipalEpoch,
} from '@/app/auth/principal-epoch';
import { insightKeys } from '@/domains/geo-insights/insights.api';
import { reportKeys } from '@/domains/geo-reports/reports.api';
import { api } from '@/shared/api/client';
import {
  analyzedDetail,
  analysisId,
  failure,
  response,
} from './analysis.test-support';
import { runId } from './runs.test-support';
import { runDetailOptions, runKeys, RunRequestError } from './runs.api';
import { RunReanalysis } from './run-reanalysis';
import { RunAnalysis } from './run-analysis';
import {
  failureKind,
  type Detail,
  type Accepted,
  type ReanalysisRequest,
} from './reanalysis.api';

const nextId = '10000000-0000-4000-8000-000000000099';
function value() {
  const data = analyzedDetail();
  data.analysis.available_actions.push('REANALYZE');
  return data;
}
function pending(data: Detail) {
  const fresh = structuredClone(data);
  const revision = structuredClone(fresh.analysis.revisions[0]!);
  revision.analysis = {
    ...revision.analysis,
    id: nextId,
    status: 'PENDING',
    revision: 2,
    finished_at: null,
  };
  revision.mentions = [];
  revision.claims = [];
  revision.recommendations = [];
  revision.citations = [];
  fresh.analysis.revisions.unshift(revision);
  return fresh;
}
function mount(initial = value()) {
  const client = createAppQueryClient();
  initializePrincipalEpoch(client, 'actor-a');
  function Route() {
    const query = useQuery({
      ...runDetailOptions(runId),
      initialData: initial,
    });
    return (
      query.data && (
        <RunAnalysis
          detail={query.data}
          reviewControl={
            <RunReanalysis
              detail={query.data}
              csrfToken="csrf"
              blocked={Boolean(query.error) || query.isFetching}
              readError={query.error}
            />
          }
        />
      )
    );
  }
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/geo/runs',
    component: Route,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/geo/runs?run_id=${runId}`],
    }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, view };
}
async function begin() {
  await userEvent.click(
    await screen.findByRole('button', { name: '显式重新分析' }),
  );
  expect(screen.getByRole('button', { name: '确认重新分析' })).toBeDisabled();
  await userEvent.click(screen.getByRole('combobox', { name: '重新分析原因' }));
  await userEvent.click(
    await screen.findByRole('option', { name: '对象词典或别名已更新' }),
  );
}
function accept() {
  return vi.spyOn(api, 'POST').mockImplementation(async (_path, opts) => {
    const options = opts as { params: { header: { 'X-Request-ID': string } } };
    return response({
      run_id: runId,
      analysis_revision_id: nextId,
      request_id: options.params.header['X-Request-ID'],
    } satisfies Accepted);
  });
}
afterEach(() => vi.restoreAllMocks());
describe('管理员显式重新分析', () => {
  it('只消费服务端动作，保持相同业务状态也不自行推断入口', async () => {
    const initial = value();
    initial.analysis.available_actions = ['REVIEW'];
    const { client } = mount(initial);
    await screen.findByRole('region', { name: '分析与人工复核' });
    expect(
      screen.queryByRole('button', { name: '显式重新分析' }),
    ).not.toBeInTheDocument();
    act(() => client.setQueryData(runKeys.detail(runId), value()));
    expect(
      await screen.findByRole('button', { name: '显式重新分析' }),
    ).toBeVisible();
  });
  it('显式原因、Run CAS、CSRF与诊断ID；双击只发一次，真实回执追踪待处理到完成', async () => {
    const initial = value();
    const fresh = pending(initial);
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(fresh));
    let release!: (result: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { client } = mount(initial);
    await begin();
    await userEvent.dblClick(
      screen.getByRole('button', { name: '确认重新分析' }),
    );
    expect(post).toHaveBeenCalledTimes(1);
    const options = post.mock.calls[0]![1] as {
      params: { header: Record<string, string> };
      body: ReanalysisRequest['body'];
    };
    expect(options.body).toEqual({
      expected_revision: 7,
      reason: 'DICTIONARY_UPDATED',
    });
    expect(options.params.header).toEqual({
      'X-CSRF-Token': 'csrf',
      'X-Request-ID': expect.any(String),
    });
    await act(async () =>
      release(
        response({
          run_id: runId,
          analysis_revision_id: nextId,
          request_id: options.params.header['X-Request-ID'],
        }),
      ),
    );
    const receipt = await screen.findByRole('region', {
      name: '本次重新分析回执',
    });
    expect(receipt).toHaveFocus();
    await waitFor(() =>
      expect(within(receipt).getByText(/目标状态：待处理/)).toBeVisible(),
    );
    expect(
      within(receipt).getByRole('link', { name: '在历史中查看本次分析' }),
    ).toHaveAttribute('href', `#analysis-revision-${nextId}`);
    const complete = structuredClone(fresh);
    complete.analysis.revisions[0]!.analysis.status = 'COMPLETED';
    complete.analysis.selection.current_analysis_revision_id = nextId;
    client.setQueryData(reportKeys.root, 'Worker发布前的旧报告');
    client.setQueryData(insightKeys.root, 'Worker发布前的旧洞察');
    get.mockResolvedValue(response(complete));
    act(() => client.setQueryData(runKeys.detail(runId), complete));
    await waitFor(() =>
      expect(
        within(receipt).getByText('目标状态：已完成 · 当前分析'),
      ).toBeVisible(),
    );
    expect(complete.analysis.revisions[1]!.analysis.id).toBe(analysisId);
    await waitFor(() => {
      expect(client.getQueryState(reportKeys.root)?.isInvalidated).toBe(true);
      expect(client.getQueryState(insightKeys.root)?.isInvalidated).toBe(true);
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('首次读取已是终态也失效早于Worker的fresh报告', async () => {
    const fresh = pending(value());
    fresh.analysis.revisions[0]!.analysis.status = 'COMPLETED';
    fresh.analysis.selection.current_analysis_revision_id = nextId;
    fresh.run.revision = 8;
    let releaseDetail!: (result: never) => void;
    const get = vi.spyOn(api, 'GET').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseDetail = resolve;
        }),
    );
    const post = accept();
    const { client } = mount();
    const key = [...reportKeys.root, 'preview', 'fast-worker'];
    const reportRead = vi
      .fn()
      .mockResolvedValueOnce('早于Worker的RR快照')
      .mockResolvedValue('新current报告');
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: reportRead,
      initialData: '接受前缓存',
      staleTime: 30_000,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await begin();
      await userEvent.click(
        screen.getByRole('button', { name: '确认重新分析' }),
      );
      await waitFor(() =>
        expect(client.getQueryData(key)).toBe('早于Worker的RR快照'),
      );
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      await act(async () => releaseDetail(response(fresh)));
      await waitFor(() =>
        expect(client.getQueryData(key)).toBe('新current报告'),
      );
      expect(reportRead).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByText('目标状态：已完成 · 当前分析'),
      ).toBeVisible();
    } finally {
      unsubscribe();
    }
  });
  it('冲突与后台版本变化保留原因，必须显式重读并再次确认', async () => {
    const fresh = pending(value());
    vi.spyOn(api, 'GET').mockResolvedValue(response(fresh));
    const post = vi.spyOn(api, 'POST').mockResolvedValue(failure());
    const { client } = mount();
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    expect(
      await screen.findByRole('button', { name: '加载最新运行与分析历史' }),
    ).toBeVisible();
    act(() => client.setQueryData(runKeys.detail(runId), fresh));
    expect(screen.getByRole('button', { name: '确认重新分析' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: '加载最新运行与分析历史' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '确认重新分析' }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole('combobox', { name: '重新分析原因' }),
    ).toHaveTextContent('对象词典或别名已更新');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('结果未知只有GET核对，不能从新版本推断成功或重发；关闭核对不取消后台工作', async () => {
    const get = vi
      .spyOn(api, 'GET')
      .mockResolvedValue(response(pending(value())));
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValue(new TypeError('网络中断'));
    mount();
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    await screen.findByText(/接受结果未知/);
    expect(
      screen.queryByRole('button', { name: '确认重新分析' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: '重新分析原因' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: '读取现有分析版本核对' }),
    );
    expect(
      await screen.findByText(/不能单凭本次读取证明原请求已接受/),
    ).toBeVisible();
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('region', { name: '本次重新分析回执' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: '关闭核对（不取消后台分析）' }),
    );
    expect(screen.getByRole('button', { name: '显式重新分析' })).toHaveFocus();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('回执身份不一致按未知处理，不接受错误目标', async () => {
    vi.spyOn(api, 'POST').mockResolvedValue(
      response({
        run_id: 'wrong',
        analysis_revision_id: nextId,
        request_id: 'wrong',
      }),
    );
    mount();
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    expect(await screen.findByText(/接受结果未知/)).toBeVisible();
    expect(
      screen.queryByRole('region', { name: '本次重新分析回执' }),
    ).not.toBeInTheDocument();
  });
  it('成功接受后失效失败仍保留回执，只允许重新读取结果', async () => {
    const post = accept();
    const { client } = mount();
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(
      new Error('虚构读取失效失败'),
    );
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    const receipt = await screen.findByRole('region', {
      name: '本次重新分析回执',
    });
    expect(
      await screen.findByText(
        '请求已接受，关联读取失败；保留目标分析ID，不会重发。',
      ),
    ).toBeVisible();
    expect(receipt).toHaveTextContent(nextId);
    vi.spyOn(api, 'GET').mockResolvedValue(response(pending(value())));
    await userEvent.click(
      within(receipt).getByRole('button', { name: '读取最新分析结果' }),
    );
    await waitFor(() =>
      expect(within(receipt).getByText(/目标状态：待处理/)).toBeVisible(),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('403后隐藏私有表单，不提供重试', async () => {
    vi.spyOn(api, 'POST').mockResolvedValue(failure('PERMISSION_DENIED', 403));
    mount();
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    expect(
      await screen.findByText('当前运行不可访问，请关闭详情并确认登录与权限。'),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: '管理员重新分析表单' }),
    ).not.toBeInTheDocument();
  });
  it('主体变化与卸载撤销请求并忽略迟到回执', async () => {
    let release!: (result: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { client, view } = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await begin();
    await userEvent.click(screen.getByRole('button', { name: '确认重新分析' }));
    const options = post.mock.calls[0]![1] as { signal: AbortSignal };
    act(() => invalidatePrincipalEpoch(client, 'actor-b'));
    view.unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () =>
      release(
        response({
          run_id: runId,
          analysis_revision_id: nextId,
          request_id: 'late',
        }),
      ),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('终态Run仍按PENDING分析轮询，失败或已完成停止；详情身份不匹配失败', async () => {
    const initial = value();
    initial.run.workflow_stage = 'COMPLETED';
    const options = runDetailOptions(runId);
    const poll = options.refetchInterval as (query: {
      state: { data: Detail; error?: Error };
    }) => number | false;
    expect(poll({ state: { data: initial } })).toBe(false);
    expect(poll({ state: { data: pending(initial) } })).toBe(5000);
    expect(
      poll({ state: { data: pending(initial), error: new Error('read') } }),
    ).toBe(false);
    expect(options.refetchIntervalInBackground).toBe(false);
    initial.analysis.selection.run_id = nextId;
    vi.spyOn(api, 'GET').mockResolvedValue(response(initial));
    const client = createAppQueryClient();
    await expect(client.fetchQuery(options)).rejects.toThrow(
      '运行详情身份与请求不一致',
    );
  });
  it('畸形4xx和无HTTP状态都保留未知结果，明确冲突才允许重新确认', () => {
    expect(failureKind(new RunRequestError('malformed', 409))).toBe('unknown');
    expect(failureKind(new Error('network'))).toBe('unknown');
    expect(
      failureKind(
        new RunRequestError('conflict', 409, {
          code: 'REVISION_CONFLICT',
          message: 'changed',
          request_id: 'r',
          details: {},
        }),
      ),
    ).toBe('conflict');
  });
});
