import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { auditKeys } from './audit.api';

type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];
const unknownAction = 'audit.action.unknown.sentinel';
const secretSentinel = 'system-audit-secret-sentinel';

const log: AuditLog = {
  id: '20000000-0000-4000-8000-000000000001',
  actor_id: '10000000-0000-4000-8000-000000000001',
  actor: { id: '10000000-0000-4000-8000-000000000001', display_name: '系统管理员', account_type: 'ADMIN' },
  business_module: 'CONFIGURATION',
  action: 'ai_channel.updated',
  target_type: 'AIChannel',
  target_id: '30000000-0000-4000-8000-000000000001',
  outcome: 'SUCCESS',
  primary_task: 'VIEW_LOG_DETAIL',
  request_id: 'req-audit-safe',
  created_at: '2026-08-15T08:00:00Z',
};

const detail: AuditLogDetail = {
  ...log,
  changes: [{ field: 'revision', before: 4, after: 5 }],
  facts: { revision: 5 },
  result_message: '渠道配置已更新',
  error_code: null,
  related_entry: { status: 'AVAILABLE', kind: 'AIChannel', parent_id: null },
};

const unknownLog: AuditLog = {
  ...log,
  id: '20000000-0000-4000-8000-000000000002',
  action: unknownAction,
  target_id: '30000000-0000-4000-8000-000000000002',
  request_id: 'req-audit-unknown',
};

const secondLog: AuditLog = {
  ...log,
  id: '20000000-0000-4000-8000-000000000003',
  action: 'user.updated',
  business_module: 'IDENTITY',
  target_type: 'User',
  target_id: '30000000-0000-4000-8000-000000000003',
  request_id: 'req-audit-second',
};

const auth: AuthContextValue = {
  user: {
    id: '10000000-0000-4000-8000-000000000099', username: 'admin', display_name: '管理员',
    account_type: 'ADMIN', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE',
    primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1,
    created_at: '2026-08-15T00:00:00Z',
  },
  csrfToken: 'audit-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: true,
  refresh: vi.fn(), signOut: vi.fn(),
};

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false, media: '(min-width: 1280px)', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => vi.restoreAllMocks());

function success<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function renderAudit(initialEntry = '/system/audit?createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z&page=1&pageSize=20') {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider><RouterProvider context={{ queryClient, auth }} router={router} /></TooltipProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

function failure(status: number, message: string, requestId: string) {
  return {
    error: { error: { code: 'AUDIT_DETAIL_FAILED', message, details: {}, request_id: requestId } },
    response: Response.json({}, { status }),
  } as never;
}

describe('SystemAuditPage', () => {
  it('只渲染七列，整行按需读取安全详情并在关闭后恢复焦点', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs/{audit_log_id}') return success(detail);
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      throw new Error(`意外请求：${path}`);
    });
    const { router } = renderAudit();

    expect(await screen.findByRole('heading', { name: '系统审计' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '时间', '操作者', '模块', '动作', '对象', '结果', 'Request ID',
    ]);
    expect(get).not.toHaveBeenCalledWith('/api/v1/audit-logs/{audit_log_id}', expect.anything());

    const row = screen.getByRole('row', { name: /查看审计详情：更新 AI 渠道/ });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('渠道配置已更新')).toBeInTheDocument();
    expect(screen.getByText('4 → 5')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ logId: log.id });
    expect(get).toHaveBeenCalledWith('/api/v1/audit-logs/{audit_log_id}', {
      params: { path: { audit_log_id: log.id } },
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('logId'));
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('混合动作逐行隔离投影失败，坏行保留元数据但不打开详情', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
      if (path === '/api/v1/audit-logs/filter-options') {
        return success({ actions: ['ai_channel.updated', unknownAction, 'user.updated'], target_types: ['AIChannel', 'User'] });
      }
      if (path === '/api/v1/audit-logs/{audit_log_id}') {
        const requestedId = (options as { params: { path: { audit_log_id: string } } }).params.path.audit_log_id;
        return requestedId === secondLog.id
          ? success({
              ...secondLog,
              changes: [{ field: 'display_name', before: '旧名称', after: '系统管理员' }],
              facts: { account_type: 'ADMIN' },
              result_message: '渠道配置已更新',
              error_code: null,
              related_entry: { status: 'UNSUPPORTED', kind: null, parent_id: null },
            } as const)
          : success(detail);
      }
      if (path === '/api/v1/audit-logs') {
        return success({
          items: [log, { ...unknownLog, change_summary: secretSentinel, raw_json: secretSentinel }, secondLog],
          page: 1,
          page_size: 20,
          total: 3,
        });
      }
      throw new Error(`意外请求：${path}`);
    });
    renderAudit();

    const unknownRow = await screen.findByRole('row', { name: '审计记录动作无法安全投影' });
    expect(unknownRow).toHaveTextContent('无法安全投影');
    expect(unknownRow).toHaveTextContent('系统管理员');
    expect(unknownRow).toHaveTextContent('系统配置');
    expect(unknownRow).not.toHaveAttribute('tabindex');
    expect(unknownRow).not.toHaveTextContent(unknownAction);
    expect(document.body.innerHTML).not.toContain(unknownAction);
    expect(document.body.innerHTML).not.toContain(secretSentinel);

    const detailCalls = get.mock.calls as unknown as Array<[string]>;
    const detailRequestCount = detailCalls.filter(([path]) => path === '/api/v1/audit-logs/{audit_log_id}').length;
    await userEvent.click(unknownRow);
    fireEvent.keyDown(unknownRow, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(unknownRow, { key: ' ', code: 'Space' });
    expect((get.mock.calls as unknown as Array<[string]>).filter(([path]) => path === '/api/v1/audit-logs/{audit_log_id}')).toHaveLength(detailRequestCount);

    const firstRow = screen.getByRole('row', { name: /查看审计详情：更新 AI 渠道/ });
    await userEvent.click(firstRow);
    expect(await screen.findByText('渠道配置已更新')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    const secondRow = screen.getByRole('row', { name: /查看审计详情：更新用户/ });
    secondRow.focus();
    await userEvent.keyboard(' ');
    expect(await screen.findByText('渠道配置已更新')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/audit-logs/{audit_log_id}', {
      params: { path: { audit_log_id: secondLog.id } },
    });
  });

  it('未知动作筛选项只显示局部反馈，未知当前 URL 保留服务端筛选直到明确清除', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') {
        return success({ actions: ['ai_channel.updated', unknownAction], target_types: [] });
      }
      if (path === '/api/v1/audit-logs') {
        return success({ items: [], page: 1, page_size: 20, total: 0 });
      }
      throw new Error(`意外请求：${path}`);
    });
    const { router } = renderAudit(`/system/audit?createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z&page=1&pageSize=20&action=${unknownAction}`);

    expect(await screen.findByRole('heading', { name: '系统审计' })).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('当前动作无法安全投影'))).toBe(true);
    expect(alerts.every((alert) => !alert.textContent?.includes(unknownAction))).toBe(true);
    expect(router.state.location.search.action).toBe(unknownAction);
    expect(get).toHaveBeenCalledWith('/api/v1/audit-logs', expect.objectContaining({
      params: expect.objectContaining({ query: expect.objectContaining({ action: unknownAction }) }),
    }));

    await userEvent.click(screen.getByText('更多筛选'));
    const actionSelect = screen.getByRole('combobox', { name: '动作' });
    expect(actionSelect).toHaveTextContent('当前动作无法安全投影');
    await userEvent.click(actionSelect);
    expect(screen.getAllByText('当前动作无法安全投影')).not.toHaveLength(0);
    expect(screen.getByText('更新 AI 渠道')).toBeInTheDocument();
    await userEvent.click(screen.getByText('全部动作'));
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('action'));
  });

  it('更多筛选折叠时仍显示未知动作选项的局部反馈', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') {
        return success({ actions: [unknownAction, 'ai_channel.updated'], target_types: [] });
      }
      if (path === '/api/v1/audit-logs') return success({ items: [], page: 1, page_size: 20, total: 0 });
      throw new Error(`意外请求：${path}`);
    });
    renderAudit();

    expect(await screen.findByRole('heading', { name: '系统审计' })).toBeInTheDocument();
    expect(await screen.findByText('部分动作筛选项无法安全投影，已从可选项中隐藏。')).toBeVisible();
    expect(document.body.innerHTML).not.toContain(unknownAction);
    expect(screen.queryByRole('combobox', { name: '动作' })).not.toBeVisible();
  });

  it('时间范围为空时保留当前 URL 并显示校验错误', async () => {
    let listRequests = 0;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: [], target_types: [] });
      if (path === '/api/v1/audit-logs') {
        listRequests += 1;
        return success({ items: [], page: 1, page_size: 20, total: 0 });
      }
      throw new Error(`意外请求：${path}`);
    });
    const { router } = renderAudit();

    expect(await screen.findByRole('heading', { name: '系统审计' })).toBeInTheDocument();
    expect(listRequests).toBeGreaterThan(0);
    const listRequestCount = listRequests;
    const search = router.state.location.search;

    await userEvent.clear(screen.getByLabelText('开始时间（北京时间）'));
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(screen.getByRole('alert')).toHaveTextContent('开始时间和结束时间不能为空。');
    expect(router.state.location.search).toEqual(search);
    expect(listRequests).toBe(listRequestCount);
  });

  it.each([403, 404, 409, 503])('详情已有缓存时 refetch %s 仍显示局部错误、旧数据与 exact retry', async (status) => {
    let detailRequestCount = 0;
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/audit-logs/{audit_log_id}') {
        detailRequestCount += 1;
        if (detailRequestCount === 2) {
          return failure(status, `审计详情刷新失败 ${status}`, `req-audit-detail-${status}`);
        }
        return success(detail);
      }
      throw new Error(`意外请求：${path}`);
    });
    const { queryClient } = renderAudit();
    await userEvent.click(await screen.findByRole('row', { name: /查看审计详情：更新 AI 渠道/ }));
    expect(await screen.findByText('渠道配置已更新')).toBeInTheDocument();

    await queryClient.invalidateQueries({ exact: true, queryKey: auditKeys.detail(log.id) });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`审计详情刷新失败 ${status}`);
    expect(alert).toHaveTextContent(`req-audit-detail-${status}`);
    expect(screen.getByText('渠道配置已更新')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(detailRequestCount).toBe(3);
    const detailCalls = (get.mock.calls as unknown as Array<[string, { params: { path: { audit_log_id: string } } }]>)
      .filter(([path]) => path === '/api/v1/audit-logs/{audit_log_id}');
    expect(detailCalls).toHaveLength(3);
    expect(detailCalls.every(([, options]) => options.params.path.audit_log_id === log.id)).toBe(true);
  });

  it('详情运行时出现对象与原型字段时局部安全失败且 sentinel 不进入 DOM', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/audit-logs/{audit_log_id}') {
        return success({
          ...detail,
          facts: {
            constructor: secretSentinel,
            reason: { secret: secretSentinel },
          },
        } as unknown as AuditLogDetail);
      }
      throw new Error(`意外请求：${path}`);
    });
    renderAudit();
    await userEvent.click(await screen.findByRole('row', { name: /查看审计详情：更新 AI 渠道/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('安全投影失败');
    expect(document.body.innerHTML).not.toContain(secretSentinel);
    expect(document.body.innerHTML).not.toContain('constructor');
  });

  it('AVAILABLE target UUID 规范化后才进入 cache 与关联链接', async () => {
    const canonicalTargetId = log.target_id!;
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/audit-logs/{audit_log_id}') {
        return success({ ...detail, target_id: canonicalTargetId.toUpperCase() });
      }
      throw new Error(`意外请求：${path}`);
    });
    const { queryClient } = renderAudit();
    await userEvent.click(await screen.findByRole('row', { name: /查看审计详情：更新 AI 渠道/ }));

    expect(await screen.findByRole('link', { name: '查看 AI 渠道' }))
      .toHaveAttribute('href', `/settings/ai/${canonicalTargetId}?tab=basic`);
    expect(queryClient.getQueryData<AuditLogDetail>(auditKeys.detail(log.id))?.target_id).toBe(canonicalTargetId);
  });

  it('AVAILABLE 非法 target UUID 固定安全失败且 sentinel 不进入 cache、DOM 或 URL', async () => {
    vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      if (path === '/api/v1/audit-logs/{audit_log_id}') return success({ ...detail, target_id: secretSentinel });
      throw new Error(`意外请求：${path}`);
    });
    const { queryClient } = renderAudit();
    await userEvent.click(await screen.findByRole('row', { name: /查看审计详情：更新 AI 渠道/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('审计响应安全投影失败');
    expect(queryClient.getQueryData(auditKeys.detail(log.id))).toBeUndefined();
    expect(screen.queryByRole('link', { name: '查看 AI 渠道' })).not.toBeInTheDocument();
    expect(`${document.body.innerHTML}\n${window.location.href}`).not.toContain(secretSentinel);
  });
});
