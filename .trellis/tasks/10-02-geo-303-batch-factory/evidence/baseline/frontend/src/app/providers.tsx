import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';
import {
  AuthProvider,
  authBoundaryIdentity,
  authSessionQueryKey,
  getAuthSession,
  useAuth,
} from './auth/auth-provider';
import { queryClient } from './query-client';
import { createAppRouter } from './router';

function PrincipalRouter({
  auth,
  boundaryIdentity,
}: {
  auth: ReturnType<typeof useAuth>;
  boundaryIdentity: string | null;
}) {
  const [router] = useState(createAppRouter);
  const previousBoundaryRef = useRef(boundaryIdentity);

  useEffect(() => {
    const previousBoundary = previousBoundaryRef.current;
    previousBoundaryRef.current = boundaryIdentity;
    if (previousBoundary !== boundaryIdentity) void router.invalidate();
  }, [boundaryIdentity, router]);

  return <RouterProvider context={{ queryClient, auth }} router={router} />;
}

function AppRouter() {
  const auth = useAuth();
  const boundaryIdentity = authBoundaryIdentity(getAuthSession(queryClient));
  const sessionResolved = queryClient.getQueryState(authSessionQueryKey)?.status === 'success';

  // 仅首次会话探测前不挂载 Router。已挂载路由在 principal command 期间由
  // route component 的 loading 分支留在原 owner 上，避免登录/改密 callback
  // 因整个 Router 被卸载而失去 terminal 导航；beforeLoad 和 QueryClient barrier
  // 仍会拒绝新的受保护导航与业务读取。
  if (auth.isLoading && !sessionResolved) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;

  const routerPrincipalIdentity = auth.user
    ? JSON.stringify([auth.user.id, auth.user.account_type])
    : 'anonymous';
  return (
    <PrincipalRouter
      auth={auth}
      boundaryIdentity={boundaryIdentity}
      key={routerPrincipalIdentity}
    />
  );
}

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <AppRouter />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
