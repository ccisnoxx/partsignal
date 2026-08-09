import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type AuthUser = components['schemas']['User'];

type AuthSession = {
  user: AuthUser;
  csrfToken: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  csrfToken: string | null;
  isLoading: boolean;
  isSigningOut: boolean;
  error: unknown;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const authSessionQueryKey = ['auth', 'session'] as const;
const AuthContext = createContext<AuthContextValue | null>(null);

function requestError(action: string, result: { error?: unknown; response: Response }) {
  const payload = result.error as { error?: { message?: string } } | undefined;
  return new Error(payload?.error?.message ?? `${action}失败（HTTP ${result.response.status}）`);
}

async function loadAuthSession(): Promise<AuthSession | null> {
  const currentUser = await api.GET('/api/v1/auth/me');
  if (currentUser.response.status === 204) {
    // Chromium 需要显式消费空响应，否则开发工具可能把已完成请求显示为中止。
    await currentUser.response.text();
    return null;
  }
  if (!currentUser.data) throw requestError('读取当前会话', currentUser);

  const csrf = await api.GET('/api/v1/auth/csrf');
  if (!csrf.data) throw requestError('读取会话安全令牌', csrf);

  return { user: currentUser.data, csrfToken: csrf.data.csrf_token };
}

function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: loadAuthSession,
    retry: false,
  });

  const logout = useMutation({
    mutationFn: async () => {
      if (!session.data) throw new Error('当前没有可退出的登录会话');
      const result = await api.POST('/api/v1/auth/logout', {
        params: { header: { 'X-CSRF-Token': session.data.csrfToken } },
      });
      if (!result.response.ok) throw requestError('退出登录', result);
    },
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0],
      });
      queryClient.setQueryData(authSessionQueryKey, null);
    },
  });

  const user = session.data?.user ?? null;
  const value: AuthContextValue = {
    user,
    csrfToken: session.data?.csrfToken ?? null,
    isLoading: session.isLoading,
    isSigningOut: logout.isPending,
    error: session.error,
    isAdmin: user?.account_type === 'ADMIN',
    refresh: async () => {
      await session.refetch();
    },
    signOut: logout.mutateAsync,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}

export { AuthProvider, useAuth };
export type { AuthContextValue, AuthUser };
