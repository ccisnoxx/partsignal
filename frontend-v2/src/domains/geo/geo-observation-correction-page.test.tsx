import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { geoKeys, geoObservationCorrectionContextQueryOptions } from './geo.api';
import { GeoObservationCorrectionPage } from './geo-observation-correction-page';

type CorrectionContext = components['schemas']['GeoObservationCorrectionContext'];

const rootId = '10000000-0000-4000-8000-000000000001';
const tailId = '10000000-0000-4000-8000-000000000002';
const nextTailId = '10000000-0000-4000-8000-000000000003';
const createdId = '10000000-0000-4000-8000-000000000004';
const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';
const articleId = '50000000-0000-4000-8000-000000000001';
const newArticleId = '50000000-0000-4000-8000-000000000002';

function correctionContext(
  selectedId = tailId,
  currentTailId = tailId,
): CorrectionContext {
  const ids = currentTailId === tailId ? [rootId, tailId] : [rootId, tailId, currentTailId];
  return {
    detail: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      selected_observation_id: selectedId,
      chain_root_id: rootId,
      chain_tail_id: currentTailId,
      product: { id: productId, label: 'PartSignal PS-CORRECTION' },
      correction_history: ids.map((id, index) => historyItem(
        id,
        index === 0 ? null : ids[index - 1]!,
        index === 0,
        id === selectedId,
        id === currentTailId,
      )),
    },
    correction_article_results: currentTailId === tailId
      ? [{
          published_article_id: articleId,
          discovered: true,
          mentioned: false,
          accuracy: 'PARTIAL',
          title: '当前候选文章',
          platform_name: '官网',
          final_url: 'https://example.com/current',
        }]
      : [{
          published_article_id: newArticleId,
          discovered: null,
          mentioned: null,
          accuracy: null,
          title: '刷新后新增文章',
          platform_name: '社区',
          final_url: 'https://example.com/new',
        }],
    query_topic_options: [],
  };
}

function historyItem(
  id: string,
  supersedesId: string | null,
  original: boolean,
  selected: boolean,
  tail: boolean,
): CorrectionContext['detail']['correction_history'][number] {
  return {
    observation: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      id,
      query_topic_id: topicId,
      product_id: productId,
      product_label: 'PartSignal PS-CORRECTION',
      search_platform: 'DeepSeek',
      search_query: '如何选择可靠的射频器件？',
      tested_at: '2026-08-12T08:00:00Z',
      article_results: [{
        published_article_id: articleId,
        discovered: true,
        mentioned: false,
        accuracy: 'PARTIAL',
        title: '历史文章',
        platform_name: '官网',
        final_url: 'https://example.com/history',
      }],
      attachment_file_ids: original
        ? ['60000000-0000-4000-8000-000000000001']
        : [],
      notes: original ? '不可变历史备注' : '当前尾备注',
      supersedes_id: supersedesId,
      tested_by: actorId,
      recorder: { id: actorId, username: 'engineer', display_name: '内容工程师' },
      is_current: tail,
      workflow_stage: tail ? 'READY' : 'SUPERSEDED',
      primary_task: tail ? 'CORRECT_OBSERVATION' : 'VIEW_CORRECTION_HISTORY',
      available_actions: tail ? ['CORRECT'] : [],
      created_at: '2026-08-12T08:01:00Z',
    },
    query_topic: { id: topicId, canonical_question: '射频器件如何选型？' },
    evidence: original ? [{
      file: {
        id: '60000000-0000-4000-8000-000000000001',
        category: 'OPERATION_SCREENSHOT',
        original_filename: 'historical.png',
        object_key: 'geo/historical.png',
        content_type: 'image/png',
        size: 128,
        sha256: 'a'.repeat(64),
        access_level: 'INTERNAL',
        status: 'VERIFIED',
        created_at: '2026-08-12T08:00:00Z',
        verified_at: '2026-08-12T08:00:00Z',
      },
      download: {
        url: 'https://files.example.com/historical.png',
        expires_at: '2026-08-12T09:00:00Z',
      },
    }] : [],
    is_original: original,
    is_selected: selected,
    is_chain_tail: tail,
  };
}

function contextResult(data: CorrectionContext) {
  return { data, response: Response.json(data) } as never;
}

function conflictResult(code: 'GEO_PUBLICATIONS_CHANGED' | 'REVISION_CONFLICT') {
  return {
    error: {
      error: {
        code,
        message: '更正上下文已变化',
        details: {},
        request_id: `req-${code.toLowerCase()}`,
      },
    },
    response: Response.json({}, { status: 409 }),
  } as never;
}

async function renderCorrection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const rootRoute = createRootRoute({ component: Outlet });
  function CorrectionRouteComponent() {
    const { observationId } = correctionRoute.useParams();
    const router = useRouter();
    const navigate = correctionRoute.useNavigate();
    return (
      <GeoObservationCorrectionPage
        csrfToken="correction-csrf"
        observationId={observationId}
        onCancel={(id) => router.history.push(`/geo/observations/${id}`)}
        onCanonicalChange={(id) => navigate({
          ignoreBlocker: true,
          params: { observationId: id },
          replace: true,
          to: '/geo/observations/$observationId/correct',
        })}
        onCreated={(id) => router.history.push(`/geo/observations/${id}`)}
      />
    );
  }
  const correctionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/geo/observations/$observationId/correct',
    loader: ({ params }) => queryClient.ensureQueryData(
      geoObservationCorrectionContextQueryOptions(params.observationId),
    ),
    component: CorrectionRouteComponent,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/geo/observations/$observationId',
    component: () => <h1>GEO Observation Detail</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([correctionRoute, detailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/geo/observations/${tailId}/correct`],
    }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { invalidateQueries, router };
}

beforeEach(() => {
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

describe('GeoObservationCorrectionPage', () => {
  it('只读呈现历史与冻结字段，并用 DirtyGuard 保护新 Notes', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(contextResult(correctionContext()));
    await renderCorrection();

    expect(await screen.findByRole('heading', { name: '更正 GEO Observation' }))
      .toBeInTheDocument();
    expect(screen.getByText(/不会编辑或覆盖原 Observation/)).toBeInTheDocument();
    expect(screen.getByText('不可变历史备注')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'historical.png' })).toHaveAttribute(
      'href',
      'https://files.example.com/historical.png',
    );
    expect(screen.getAllByText('PartSignal PS-CORRECTION')).toHaveLength(2);
    expect(screen.queryByRole('textbox', { name: 'Product（冻结）' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '更正原因 / Notes' }), '仅属于新节点');
    await user.click(screen.getByRole('button', { name: '返回当前 Detail' }));
    const dialog = await screen.findByRole('dialog', { name: '要离开当前页面吗？' });
    expect(dialog).toHaveTextContent('本次更正事实、原因和已上传证据选择将会丢失');
    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '更正原因 / Notes' }))
      .toHaveValue('仅属于新节点');
  });

  it('提交权威尾节点 payload，成功解除 DirtyGuard 并按响应 ID 交接', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(contextResult(correctionContext()));
    const created = {
      ...historyItem(createdId, tailId, false, true, true).observation,
      id: createdId,
      supersedes_id: tailId,
    };
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: created,
      response: Response.json(created, { status: 201 }),
    } as never);
    const { invalidateQueries } = await renderCorrection();
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: '更正原因 / Notes' }),
      '事实修正',
    );
    await user.click(screen.getByRole('button', { name: '追加 Correction' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/v1/geo-observations', {
      body: expect.objectContaining({
        product_id: productId,
        query_topic_id: topicId,
        search_platform: 'DeepSeek',
        search_query: '如何选择可靠的射频器件？',
        supersedes_id: tailId,
        attachment_file_ids: [],
        notes: '事实修正',
        article_results: [{
          published_article_id: articleId,
          discovered: true,
          mentioned: false,
          accuracy: 'PARTIAL',
        }],
      }),
      params: { header: { 'X-CSRF-Token': 'correction-csrf' } },
    });
    expect(await screen.findByRole('heading', { name: 'GEO Observation Detail' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '要离开当前页面吗？' }))
      .not.toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: geoKeys.lists() });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: geoKeys.details() });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: geoKeys.correctionContexts(),
    });
  });

  it.each(['GEO_PUBLICATIONS_CHANGED', 'REVISION_CONFLICT'] as const)(
    '%s 不自动重放，显式刷新保留草稿并采用服务端新尾',
    async (code) => {
      let changed = false;
      const get = vi.spyOn(api, 'GET').mockImplementation(async (_path, request) => {
        const id = (request as { params: { path: { observation_id: string } } })
          .params.path.observation_id;
        return contextResult(changed
          ? correctionContext(id, nextTailId)
          : correctionContext(id, tailId));
      });
      const post = vi.spyOn(api, 'POST').mockImplementation(async () => {
        changed = true;
        return conflictResult(code);
      });
      const { router } = await renderCorrection();
      const user = userEvent.setup();
      await user.type(
        await screen.findByRole('textbox', { name: '更正原因 / Notes' }),
        '保留这个草稿',
      );
      await user.click(screen.getByRole('button', { name: '追加 Correction' }));

      const alert = await screen.findByText(/草稿与本次上传仍保留/);
      expect(alert).toBeInTheDocument();
      expect(post).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: '追加 Correction' }))
        .toHaveAttribute('aria-disabled', 'true');

      await user.click(screen.getByRole('button', { name: '重新加载最新上下文' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(
        `/geo/observations/${nextTailId}/correct`,
      ));
      expect(screen.getByRole('textbox', { name: '更正原因 / Notes' }))
        .toHaveValue('保留这个草稿');
      expect(await screen.findByText('刷新后新增文章')).toBeInTheDocument();
      expect(post).toHaveBeenCalledOnce();
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    },
  );

  it('pending 期间禁用表单并阻止重复 POST', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(contextResult(correctionContext()));
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(api, 'POST').mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }) as never);
    await renderCorrection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '追加 Correction' }));

    const pending = await screen.findByRole('button', { name: '提交中…' });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: '返回当前 Detail' }))
      .toHaveAttribute('aria-disabled', 'true');
    await user.click(pending);
    expect(post).toHaveBeenCalledOnce();

    const created = historyItem(createdId, tailId, false, true, true).observation;
    resolvePost?.({ data: created, response: Response.json(created, { status: 201 }) });
    expect(await screen.findByRole('heading', { name: 'GEO Observation Detail' }))
      .toBeInTheDocument();
  });
});
