/** 根据用户意图和网络条件预取高概率路由代码与服务端数据。 */
import {
  dashboardSummaryQueryOptions,
  geoMetricsQueryOptions,
  platformProfilesQueryOptions,
  platformTypesQueryOptions,
  productsQueryOptions,
} from '../shared/api/queryOptions';
import { queryClient } from './queryClient';
import { routeLoaders, type RouteLoaderKey } from './routeLoaders';

type ConnectionInfo = { saveData?: boolean; effectiveType?: string };

const navigationLoaders: Record<string, RouteLoaderKey> = {
  '/': 'dashboard',
  '/products': 'products',
  '/tasks': 'contentTasks',
  '/publications': 'publications',
  '/observations': 'geoObservations',
  '/observations/insights': 'geoInsights',
  '/observations/insights/print': 'geoInsights',
  '/settings': 'settings',
  '/users': 'users',
  '/audit': 'auditLog',
  '/configuration': 'aiChannels',
  '/configuration/ai': 'aiChannels',
  '/configuration/platform-types': 'platformTypes',
  '/configuration/platforms': 'platforms',
  '/configuration/prompts': 'platformPrompts',
};

function connectionInfo(): ConnectionInfo | undefined {
  return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}

export function canIdlePrefetch(connection = connectionInfo()): boolean {
  if (connection?.saveData) return false;
  return !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

export function navigationLoaderKey(path: string): RouteLoaderKey | undefined {
  const pathname = new URL(path, 'https://partsignal.local').pathname;
  return pathname.startsWith('/configuration/ai/channels/') ? 'aiChannelDetail' : navigationLoaders[pathname];
}

export async function prefetchNavigation(path: string): Promise<void> {
  const loaderKey = navigationLoaderKey(path);
  if (!loaderKey) return;
  const pathname = new URL(path, 'https://partsignal.local').pathname;
  const tasks: Promise<unknown>[] = [routeLoaders[loaderKey]()];
  if (pathname === '/') {
    tasks.push(queryClient.prefetchQuery(dashboardSummaryQueryOptions()));
    tasks.push(queryClient.prefetchQuery(geoMetricsQueryOptions()));
  } else if (pathname === '/products') {
    tasks.push(queryClient.prefetchQuery(productsQueryOptions()));
  } else if (pathname === '/configuration/platforms') {
    tasks.push(queryClient.prefetchQuery(platformProfilesQueryOptions({ page: 1, page_size: 20 })));
    tasks.push(queryClient.prefetchQuery(platformTypesQueryOptions()));
  }
  await Promise.all(tasks);
}

export function scheduleIdleRoutePrefetch(): () => void {
  if (!canIdlePrefetch()) return () => undefined;
  const run = () => {
    void prefetchNavigation('/');
    void prefetchNavigation('/products');
  };
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(run, { timeout: 1_500 });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const handle = globalThis.setTimeout(run, 1_000);
  return () => globalThis.clearTimeout(handle);
}
