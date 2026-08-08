import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { AuthProvider, useAuth } from './auth/auth-provider';
import { queryClient } from './query-client';
import { router } from './router';

function AppRouter() {
  const auth = useAuth();

  useEffect(() => {
    // RouterProvider 会更新 options.context；当前匹配仍需失效后才会重新计算 route context。
    void router.invalidate();
  }, [auth.error, auth.isLoading, auth.isSigningOut, auth.user]);

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
