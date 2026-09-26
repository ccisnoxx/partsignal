import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';
import { AuthProvider, authBoundaryIdentity, useAuth } from './auth/auth-provider';
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
  const boundaryIdentity = authBoundaryIdentity(auth.user);

  // 会话探测完成前不挂载 Router，避免受保护子路由 loader 提前读取业务数据。
  if (auth.isLoading) return <AuthLoadingPage />;
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
