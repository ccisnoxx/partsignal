import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';

type AuditLog = components['schemas']['AuditLog'];
type AuditLogDetail = components['schemas']['AuditLogDetail'];

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

function success<T>(data: T) {
  return { data, response: Response.json(data) } as never;
}

function renderAudit() {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/system/audit?createdFrom=2026-08-13T00%3A00%3A00.000Z&createdTo=2026-08-16T00%3A00%3A00.000Z&page=1&pageSize=20'] }),
    context: { queryClient, auth },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider><RouterProvider context={{ queryClient, auth }} router={router} /></TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('SystemAuditPage', () => {
  it('只渲染七列，整行按需读取安全详情并在关闭后恢复焦点', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
      if (path === '/api/v1/audit-logs/filter-options') return success({ actions: ['ai_channel.updated'], target_types: ['AIChannel'] });
      if (path === '/api/v1/audit-logs/{audit_log_id}') return success(detail);
      if (path === '/api/v1/audit-logs') return success({ items: [log], page: 1, page_size: 20, total: 1 });
      throw new Error(`意外请求：${path}`);
    });
    const router = renderAudit();

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
    const router = renderAudit();

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
});
