import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { queryClient } from './query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type AuthUser = components['schemas']['User'];

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
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

describe('AppProviders', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('匿名根路由进入登录页且不渲染 App Shell', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(queryClient.getQueryCache()).toBeDefined();
  });

  it('有效会话才渲染根业务页面', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'admin-csrf' }, response: Response.json({ csrf_token: 'admin-csrf' }) } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByLabelText('正在读取账户信息')).not.toBeInTheDocument());
  });

  it('must-change 会话进入独立安全页且不渲染 App Shell', async () => {
    const mustChangeAdmin = { ...admin, must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE' as const };
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: mustChangeAdmin, response: Response.json(mustChangeAdmin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'admin-csrf' }, response: Response.json({ csrf_token: 'admin-csrf' }) } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('heading', { name: '修改密码' })).toBeInTheDocument();
    expect(screen.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/account/security');
  });

  it('认证查询失败后重新计算路由上下文并显式显示错误', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { message: '会话服务不可用' } },
      response: Response.json({}, { status: 503 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('alert')).toHaveTextContent('当前无法确认账户状态');
    expect(screen.queryByRole('heading', { name: '工作台' })).not.toBeInTheDocument();
  });
});
