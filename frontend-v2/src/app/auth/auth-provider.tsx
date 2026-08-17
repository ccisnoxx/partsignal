import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type AuthUser = components['schemas']['User'];
type LoginRequest = components['schemas']['LoginRequest'];
type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];

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

function clearBusinessQueries(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0],
  });
}

function getAuthRouteUser(queryClient: QueryClient): AuthUser | null {
  return queryClient.getQueryData<AuthSession | null>(authSessionQueryKey)?.user ?? null;
}

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
      clearBusinessQueries(queryClient);
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

function useAuthActions() {
  const auth = useAuth();
  const queryClient = useQueryClient();

  return {
    signIn: async (payload: LoginRequest) => {
      const result = await api.POST('/api/v1/auth/login', { body: payload });
      if (!result.data) throw requestError('登录', result);

      clearBusinessQueries(queryClient);
      queryClient.setQueryData<AuthSession>(authSessionQueryKey, {
        user: result.data.user,
        csrfToken: result.data.csrf_token,
      });
      return result.data.user;
    },
    changePassword: async (payload: ChangePasswordRequest) => {
      if (!auth.csrfToken) throw new Error('当前没有可修改密码的登录会话');
      const result = await api.POST('/api/v1/auth/change-password', {
        body: payload,
        params: { header: { 'X-CSRF-Token': auth.csrfToken } },
      });
      if (!result.response.ok) throw requestError('修改密码', result);

      // 改密后的 must-change 状态只能来自服务端，不能在浏览器里推导。
      const refreshedSession = await loadAuthSession();
      if (!refreshedSession) throw new Error('修改密码后登录会话已失效');
      queryClient.setQueryData(authSessionQueryKey, refreshedSession);
    },
  };
}

export { AuthProvider, authSessionQueryKey, getAuthRouteUser, useAuth, useAuthActions };
export type { AuthContextValue, AuthUser };
