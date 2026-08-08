import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { routeTree } from '@/routeTree.gen';

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

const engineer: AuthUser = { ...admin, id: '00000000-0000-4000-8000-000000000002', username: 'engineer', display_name: '内容工程师', account_type: 'ENGINEER', primary_task: 'MANAGE_LOGIN_SECURITY' };

function storyAuth(user: AuthUser | null, state?: 'loading' | 'error'): AuthContextValue {
  return {
    user,
    isLoading: state === 'loading',
    isSigningOut: false,
    error: state === 'error' ? new Error('认证服务暂时不可用') : null,
    isAdmin: user?.account_type === 'ADMIN',
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
}

function ShellStory({ path, auth }: { path: string; auth: AuthContextValue }) {
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() => createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, auth },
  }));
  return <RouterProvider router={router} context={{ queryClient, auth }} />;
}

const meta = {
  title: 'App/App Shell',
  component: ShellStory,
  decorators: [(Story) => <div className="-m-6"><Story /></div>],
} satisfies Meta<typeof ShellStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopAdmin: Story = {
  args: { path: '/products/router-foundation', auth: storyAuth(admin) },
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};

export const DesktopAnonymous: Story = {
  args: { path: '/', auth: storyAuth(null) },
  parameters: { viewport: { defaultViewport: 'desktop1024' } },
};

export const MobileAdmin: Story = {
  args: { path: '/products', auth: storyAuth(admin) },
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};

export const TabletAnonymous: Story = {
  args: { path: '/products', auth: storyAuth(null) },
  parameters: { viewport: { defaultViewport: 'tablet768' } },
};

export const AuthLoading: Story = {
  args: { path: '/', auth: storyAuth(null, 'loading') },
};

export const AuthError: Story = {
  args: { path: '/', auth: storyAuth(null, 'error') },
};

export const ForbiddenContent: Story = {
  args: { path: '/system/users', auth: storyAuth(engineer) },
};
