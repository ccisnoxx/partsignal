import {
  authBoundaryIdentity,
  authSessionQueryKey,
  type AuthContextValue,
  type AuthSession,
} from '@/app/auth/auth-provider';
import { initializePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';

/** 为 generated routeTree 测试创建与 Auth route guard 同源的登录 QueryClient。 */
function createAuthenticatedTestQueryClient(auth: AuthContextValue) {
  if (!auth.user || !auth.csrfToken) throw new Error('路由测试必须提供完整登录会话');

  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  queryClient.setQueryData<AuthSession>(authSessionQueryKey, {
    user: auth.user,
    csrfToken: auth.csrfToken,
    sessionBinding: auth.user.id.replaceAll('-', '').padEnd(64, '0'),
  });
  initializePrincipalEpoch(queryClient, authBoundaryIdentity(auth.user));
  return queryClient;
}

export { createAuthenticatedTestQueryClient };
