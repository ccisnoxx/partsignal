import { render, screen } from '@testing-library/react';
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
  });
});
