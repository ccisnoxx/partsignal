/** 管理当前会话身份；业务权限仍由服务端作最终裁决。 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../../app/queryClient';
import { api, setCsrfToken, unwrap } from '../../shared/api/client';
import type { Role, User } from '../../shared/api/types';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: unknown;
  hasRole: (...roles: Role[]) => boolean;
  refresh: () => Promise<unknown>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const currentUser = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => unwrap(await api.GET('/api/v1/auth/me')),
    retry: false,
  });

  const csrf = useQuery({
    queryKey: ['auth', 'csrf'],
    queryFn: async () => unwrap(await api.GET('/api/v1/auth/csrf')),
    enabled: currentUser.isSuccess,
    retry: false,
  });
  const refreshCurrentUser = currentUser.refetch;
  useEffect(() => {
    const expire = () => {
      setCsrfToken(null);
      queryClient.removeQueries({ queryKey: ['auth'] });
      void refreshCurrentUser();
    };
    globalThis.addEventListener('partsignal:auth-expired', expire);
    return () => globalThis.removeEventListener('partsignal:auth-expired', expire);
  }, [refreshCurrentUser]);
  setCsrfToken(csrf.data?.csrf_token ?? null);

  const user = currentUser.data ?? null;
  return (
    <AuthContext.Provider value={{
      user,
      isLoading: currentUser.isLoading || (currentUser.isSuccess && csrf.isLoading),
      isAuthenticated: user !== null,
      error: currentUser.error ?? csrf.error,
      hasRole: (...roles) => user?.roles.some((role) => roles.includes(role)) ?? false,
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
