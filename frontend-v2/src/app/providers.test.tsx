import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { queryClient } from './query-client';
import { router } from './router';
import { api } from '@/shared/api/client';

describe('AppProviders', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('装配 Router、QueryClient 并渲染根页面', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(
      await screen.findByRole('heading', { name: '工作台' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(queryClient.getQueryCache()).toBeDefined();
    await waitFor(() => expect(screen.queryByLabelText('正在读取账户信息')).not.toBeInTheDocument());
  });

  it('认证查询失败后重新计算路由上下文并显式显示错误', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { error: { message: '会话服务不可用' } },
      response: Response.json({}, { status: 503 }),
    } as never);
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(await screen.findByRole('alert')).toHaveTextContent('账户状态读取失败');
  });
});
