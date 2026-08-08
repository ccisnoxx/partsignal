import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { AuthUser } from './auth-provider';
import { AuthProvider, useAuth } from './auth-provider';

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
  if (auth.isLoading) return <p>读取中</p>;
  if (auth.error) return <p>读取失败</p>;
  return (
    <div>
      <p>{auth.user ? `${auth.user.display_name}:${auth.isAdmin}` : '匿名'}</p>
      {auth.user && <button onClick={() => void auth.signOut()}>退出</button>}
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
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
    expect(await screen.findByText('系统管理员:true')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByText('匿名')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/logout', {
      params: { header: { 'X-CSRF-Token': 'csrf-token' } },
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
