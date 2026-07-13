/** 服务端状态缓存策略，写操作由各业务模块显式失效相关查询。 */
import { QueryClient } from '@tanstack/react-query';

export const QUERY_STALE_TIME = {
  workbench: 15_000,
  businessList: 30_000,
  detail: 60_000,
  configuration: 300_000,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: QUERY_STALE_TIME.workbench, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
