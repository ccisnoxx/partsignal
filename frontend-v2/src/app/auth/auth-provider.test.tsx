import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { AuthUser } from './auth-provider';
import { AuthProvider, useAuth, useAuthActions } from './auth-provider';

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

afterEach(() => vi.restoreAllMocks());

function AuthProbe() {
  const auth = useAuth();
  const actions = useAuthActions();
  if (auth.isLoading) return <p>读取中</p>;
  if (auth.error) return <p>读取失败</p>;
  return (
    <div>
      <p>{auth.user ? `${auth.user.display_name}:${auth.isAdmin}:${auth.csrfToken}` : '匿名'}</p>
      {!auth.user && (
        <button onClick={() => void actions.signIn({ username: 'admin', password: 'password-123' })}>
          登录
        </button>
      )}
      {auth.user && (
        <>
          <p>{auth.user.must_change_password ? '必须改密' : '正常会话'}</p>
          <button onClick={() => void actions.changePassword({ old_password: 'password-123', new_password: 'password-456' })}>
            修改密码
          </button>
          <button onClick={() => void auth.signOut()}>退出</button>
        </>
      )}
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe('AuthProvider', () => {
  it('把 204 会话作为匿名状态且不请求 CSRF', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);

    renderAuth();

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/api/v1/auth/me');
  });

  it('使用真实会话身份和 CSRF header 退出', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({
        data: { csrf_token: 'csrf-token' },
        response: Response.json({ csrf_token: 'csrf-token' }),
      } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);

    renderAuth();
    expect(await screen.findByText('系统管理员:true:csrf-token')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/logout', {
      params: { header: { 'X-CSRF-Token': 'csrf-token' } },
    });
  });

  it('登录写入 canonical session 并清除上一身份的业务缓存', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: { user: admin, csrf_token: 'signed-in-csrf' },
      response: Response.json({ user: admin, csrf_token: 'signed-in-csrf' }),
    } as never);
    const { queryClient } = renderAuth();
    queryClient.setQueryData(['products', 'list'], { items: ['上一身份的数据'] });

    await userEvent.click(await screen.findByRole('button', { name: '登录' }));

    expect(await screen.findByText('系统管理员:true:signed-in-csrf')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/login', {
      body: { username: 'admin', password: 'password-123' },
    });
    expect(queryClient.getQueryData(['products', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'signed-in-csrf',
    });
  });

  it('修改密码使用 canonical CSRF 并以服务端刷新结果解除 must-change', async () => {
    const mustChangeAdmin = { ...admin, must_change_password: true, workflow_stage: 'FIRST_PASSWORD_CHANGE' as const };
    const get = vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: mustChangeAdmin, response: Response.json(mustChangeAdmin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'change-csrf' }, response: Response.json({ csrf_token: 'change-csrf' }) } as never)
      .mockResolvedValueOnce({ data: admin, response: Response.json(admin) } as never)
      .mockResolvedValueOnce({ data: { csrf_token: 'refreshed-csrf' }, response: Response.json({ csrf_token: 'refreshed-csrf' }) } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const { queryClient } = renderAuth();

    expect(await screen.findByText('必须改密')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByText('正常会话')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/change-password', {
      body: { old_password: 'password-123', new_password: 'password-456' },
      params: { header: { 'X-CSRF-Token': 'change-csrf' } },
    });
    expect(get).toHaveBeenCalledTimes(4);
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual({
      user: admin,
      csrfToken: 'refreshed-csrf',
    });
  });

  it('显式暴露认证错误', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { message: '会话服务不可用' } },
      response: Response.json({}, { status: 503 }),
    } as never);

    renderAuth();

    expect(await screen.findByText('读取失败')).toBeInTheDocument();
  });
});
