import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { queryClient } from './query-client';

export function createAppRouter() {
  return createRouter({
    routeTree,
    // RouterProvider 会在创建后立即注入已完成探测的认证上下文。
    context: { queryClient, auth: undefined! },
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
