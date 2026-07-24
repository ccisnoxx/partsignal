/** 管理当前会话身份；业务权限仍由服务端作最终裁决。 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../../app/queryClient';
import { api, setCsrfToken, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { User } from '../../shared/api/types';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: unknown;
  isAdmin: boolean;
  refresh: () => Promise<unknown>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const currentUser = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => {
      const result = await api.GET('/api/v1/auth/me');
      if (result.response.status !== 204) return unwrap(result);
      // openapi-fetch 对 204 提前返回；显式消费空响应，避免 Chromium 将未读取的 fetch 记为 ERR_ABORTED。
      await result.response.text();
      return null;
    },
    retry: false,
  });
  const user = currentUser.data ?? null;

  const csrf = useQuery({
    queryKey: queryKeys.auth.csrf,
    queryFn: async () => unwrap(await api.GET('/api/v1/auth/csrf')),
    enabled: user !== null,
    retry: false,
  });
  const refreshCurrentUser = currentUser.refetch;
  useEffect(() => {
    const expire = () => {
      setCsrfToken(null);
      queryClient.removeQueries({ queryKey: queryKeys.auth.all });
      void refreshCurrentUser();
    };
    globalThis.addEventListener('partsignal:auth-expired', expire);
    return () => globalThis.removeEventListener('partsignal:auth-expired', expire);
  }, [refreshCurrentUser]);
  setCsrfToken(csrf.data?.csrf_token ?? null);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading: currentUser.isLoading || (user !== null && csrf.isLoading),
      isAuthenticated: user !== null,
      error: currentUser.error ?? csrf.error,
      isAdmin: user?.account_type === 'ADMIN',
      refresh: currentUser.refetch,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
