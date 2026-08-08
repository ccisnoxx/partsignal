import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from './providers';
import { queryClient } from './query-client';
import { router } from './router';

describe('AppProviders', () => {
  it('装配 Router、QueryClient 并渲染根页面', async () => {
    window.history.replaceState(null, '', '/');

    render(<AppProviders />);

    expect(
      await screen.findByRole('heading', { name: 'PartSignal Frontend V2' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(queryClient.getQueryCache()).toBeDefined();
  });
});
