import { QueryClient } from '@tanstack/react-query';

import {
  authSessionQueryKey,
  type AuthContextValue,
  type AuthSession,
} from '@/app/auth/auth-provider';

/** 为 generated routeTree 测试创建与 Auth route guard 同源的登录 QueryClient。 */
function createAuthenticatedTestQueryClient(auth: AuthContextValue) {
  if (!auth.user || !auth.csrfToken) throw new Error('路由测试必须提供完整登录会话');

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<AuthSession>(authSessionQueryKey, {
    user: auth.user,
    csrfToken: auth.csrfToken,
  });
  return queryClient;
}

export { createAuthenticatedTestQueryClient };
