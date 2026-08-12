import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { geoKeys } from './geo.api';

type GeoObservationDetail = components['schemas']['GeoObservationDetail'];

const rootId = '10000000-0000-4000-8000-000000000001';
const tailId = '10000000-0000-4000-8000-000000000002';
const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';
const publicationId = '50000000-0000-4000-8000-000000000001';

const admin: AuthUser = {
  id: actorId,
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
  csrfToken: 'geo-detail-csrf',
  isLoading: false,
  isSigningOut: false,
  error: null,
  isAdmin: true,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function manualDetail(): GeoObservationDetail {
  return {
    observation_kind: 'MANUAL_ARTICLE_SEARCH',
    selected_observation_id: rootId,
    chain_root_id: rootId,
    chain_tail_id: tailId,
    product: { id: productId, label: 'PartSignal PS-DETAIL' },
    correction_history: [
      historyItem(rootId, null, true, true, false, '历史备注'),
      historyItem(tailId, rootId, false, false, true, '当前链尾备注'),
    ],
  };
}

function historyItem(
  id: string,
  supersedesId: string | null,
  original: boolean,
  selected: boolean,
  tail: boolean,
  notes: string,
): components['schemas']['GeoObservationCorrectionHistoryItem'] {
  return {
    observation: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      id,
      query_topic_id: topicId,
      product_id: productId,
      product_label: 'PartSignal PS-DETAIL',
      search_platform: 'DeepSeek',
      search_query: '怎样选择射频前端器件？',
      tested_at: tail ? '2026-08-12T08:00:00Z' : '2026-08-11T08:00:00Z',
      article_results: [{
        published_article_id: publicationId,
        discovered: tail,
        mentioned: tail,
        accuracy: tail ? 'ACCURATE' : null,
        title: '射频前端选型指南',
        platform_name: '知乎',
        final_url: 'https://example.com/article',
      }],
      attachment_file_ids: [
        '60000000-0000-4000-8000-000000000001',
        ...(tail ? ['60000000-0000-4000-8000-000000000002'] : []),
      ],
      notes,
      supersedes_id: supersedesId,
      tested_by: actorId,
      recorder: { id: actorId, username: 'admin', display_name: '系统管理员' },
      is_current: tail,
      workflow_stage: tail ? 'READY' : 'SUPERSEDED',
      primary_task: tail ? 'VIEW_ANALYSIS' : 'VIEW_CORRECTION_HISTORY',
      available_actions: tail ? ['CORRECT', 'DELETE'] : [],
      created_at: tail ? '2026-08-12T08:01:00Z' : '2026-08-11T08:01:00Z',
    },
    query_topic: { id: topicId, canonical_question: '射频前端如何选型？' },
    evidence: [{
      file: {
        id: tail
          ? '60000000-0000-4000-8000-000000000002'
          : '60000000-0000-4000-8000-000000000001',
        category: 'OPERATION_SCREENSHOT',
        original_filename: tail ? 'tail.png' : 'root.png',
        object_key: tail ? 'geo/tail.png' : 'geo/root.png',
        content_type: 'image/png',
        size: 128,
        sha256: 'a'.repeat(64),
        access_level: 'INTERNAL',
        status: 'VERIFIED',
        created_at: '2026-08-12T08:00:00Z',
        verified_at: '2026-08-12T08:00:00Z',
      },
      download: {
        url: `https://files.example.com/${tail ? 'tail' : 'root'}.png`,
        expires_at: '2026-08-12T09:00:00Z',
      },
    }],
    is_original: original,
    is_selected: selected,
    is_chain_tail: tail,
  };
}

function legacyDetail(): GeoObservationDetail {
  return {
    observation_kind: 'LEGACY_MODEL_RESULT',
    observation: {
      observation_kind: 'LEGACY_MODEL_RESULT',
      id: rootId,
      query_topic_id: topicId,
      product_id: productId,
      product_label: 'PartSignal PS-DETAIL',
      actual_prompt: '旧模型完整问题是什么？',
      model_name: 'ChatGPT',
      model_version: '4o',
      tested_at: '2026-08-10T08:00:00Z',
      web_search_enabled: true,
      answer_summary: '旧模型完整回答摘要。',
      mentioned: true,
      recommendation: 'RECOMMENDED',
      accuracy: 'ACCURATE',
      citations: [{
        url: 'https://example.com/source',
        source_type: 'OFFICIAL',
        published_article_id: publicationId,
      }],
      published_article_ids: [publicationId],
      attachment_file_ids: [],
      notes: '旧模型备注',
      supersedes_id: null,
      tested_by: actorId,
      recorder: { id: actorId, username: 'admin', display_name: '系统管理员' },
      is_current: true,
      workflow_stage: 'LEGACY',
      primary_task: 'VIEW_HISTORICAL_RECORD',
      available_actions: [],
      created_at: '2026-08-10T08:01:00Z',
    },
    query_topic: { id: topicId, canonical_question: '旧模型标准问题' },
    product: { id: productId, label: 'PartSignal PS-DETAIL' },
    published_articles: [{
      id: publicationId,
      title: '历史关联成果',
      platform_name: '知乎快照',
      final_url: 'https://example.com/article',
    }],
    evidence: [],
  };
}

function renderDetail(data: GeoObservationDetail, entryId = rootId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/geo/observations/${entryId}`] }),
    context: { queryClient, auth },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} context={{ queryClient, auth }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, view, data };
}

afterEach(() => vi.restoreAllMocks());

describe('GeoObservationDetailPage', () => {
  it('绘制 Manual selected record、完整历史和链尾服务端动作', async () => {
    const data = manualDetail();
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data,
      response: Response.json(data),
    } as never);
    renderDetail(data);

    expect(await screen.findByRole('heading', { name: '怎样选择射频前端器件？' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('射频前端如何选型？').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未判断').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '查看结果' })).toHaveAttribute('href', '#results');
    expect(screen.getByText('原记录')).toBeInTheDocument();
    expect(screen.getByText('更正 1')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'root.png' })[0]).toHaveAttribute(
      'href',
      'https://files.example.com/root.png',
    );
    expect(screen.getAllByRole('link', { name: '射频前端选型指南' }).at(-1)).toHaveAttribute(
      'href',
      `/publishing/articles/${publicationId}`,
    );

    await userEvent.click(screen.getByRole('button', { name: /更多操作/ }));
    expect(await screen.findByRole('menuitem', { name: '更正' })).toHaveAttribute(
      'href',
      `/geo/observations/${tailId}/correct`,
    );
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/api/v1/geo-observations/{observation_id}/detail',
      { params: { path: { observation_id: rootId } } },
    );
  });

  it('绘制 Legacy-only recommendation、citation 与成果，不显示更正历史', async () => {
    const data = legacyDetail();
    vi.spyOn(api, 'GET').mockResolvedValue({ data, response: Response.json(data) } as never);
    renderDetail(data);

    expect(await screen.findByRole('heading', { name: '旧模型完整问题是什么？' }))
      .toBeInTheDocument();
    expect(screen.getByText('已推荐')).toBeInTheDocument();
    expect(screen.getByText('旧模型完整回答摘要。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/source' }))
      .toHaveAttribute('href', 'https://example.com/source');
    expect(screen.queryByRole('heading', { name: 'Correction history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /更多操作/ })).not.toBeInTheDocument();
  });

  it('区分 409 并在显式重试后恢复', async () => {
    const data = manualDetail();
    let failed = true;
    vi.spyOn(api, 'GET').mockImplementation(async () => failed ? ({
      error: {
        error: {
          code: 'REVISION_CONFLICT',
          message: 'GEO 观测更正链不完整',
          details: {},
          request_id: 'req-geo-detail',
        },
      },
      response: Response.json({}, { status: 409 }),
    } as never) : ({ data, response: Response.json(data) } as never));
    renderDetail(data);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GEO Observation 暂不可读取');
    expect(alert).toHaveTextContent('req-geo-detail');
    failed = false;
    await userEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(
      screen.getByRole('heading', { name: '怎样选择射频前端器件？' }),
    ).toBeInTheDocument());
  });

  it('背景刷新失败时保留已有只读快照并允许重试', async () => {
    const data = manualDetail();
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data, response: Response.json(data) } as never)
      .mockResolvedValue({
        error: {
          error: {
            code: 'INTERNAL_ERROR',
            message: '刷新失败',
            details: {},
            request_id: 'req-refresh',
          },
        },
        response: Response.json({}, { status: 500 }),
      } as never);
    const { queryClient } = renderDetail(data);
    expect(await screen.findByRole('heading', { name: '怎样选择射频前端器件？' }))
      .toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: geoKeys.detail(rootId) });
    });

    expect(screen.getByRole('heading', { name: '怎样选择射频前端器件？' }))
      .toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('刷新失败，已保留当前只读详情');
    expect(alert).toHaveTextContent('req-refresh');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('非法 UUID 在路由边界失败且不发送 Detail 请求', async () => {
    const get = vi.spyOn(api, 'GET');
    renderDetail(manualDetail(), 'not-a-uuid');

    expect(await screen.findByText(/不是有效 UUID/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    [404, '未找到 GEO Observation'],
    [403, '无法访问 GEO Observation'],
    [500, 'GEO Observation 加载失败'],
  ])('区分 HTTP %s 页面错误', async (status, title) => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: {
        error: {
          code: `HTTP_${status}`,
          message: `读取失败 ${status}`,
          details: {},
          request_id: `req-${status}`,
        },
      },
      response: Response.json({}, { status }),
    } as never);
    renderDetail(manualDetail());

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`req-${status}`)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
