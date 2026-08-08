import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { queryClient } from './query-client';

export const router = createRouter({
  routeTree,
  // RouterProvider 会在运行时注入当前认证上下文；这里只满足根路由的创建期类型。
  context: { queryClient, auth: undefined! },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
