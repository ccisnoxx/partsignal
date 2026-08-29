import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';
import { AuthProvider, useAuth } from './auth/auth-provider';
import { queryClient } from './query-client';
import { createAppRouter } from './router';

function AppRouter() {
  const auth = useAuth();
  const [router] = useState(createAppRouter);
  const previousUserRef = useRef(auth.user);

  useEffect(() => {
    const wasAuthenticated = previousUserRef.current !== null;
    previousUserRef.current = auth.user;
    if (wasAuthenticated && !auth.user) void router.invalidate();
  }, [auth.user, router]);

  // 会话探测完成前不挂载 Router，避免受保护子路由 loader 提前读取业务数据。
  if (auth.isLoading) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;

  return <RouterProvider router={router} context={{ queryClient, auth }} />;
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
