/** 服务端状态缓存策略，写操作由各业务模块显式失效相关查询。 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
