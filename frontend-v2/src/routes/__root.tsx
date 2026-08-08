import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { AuthContextValue } from '@/app/auth/auth-provider';

type RouterContext = {
  queryClient: QueryClient;
  auth: AuthContextValue;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
