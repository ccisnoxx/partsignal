/** 根据用户意图和网络条件预取高概率路由代码与服务端数据。 */
import {
  dashboardSummaryQueryOptions,
  geoMetricsQueryOptions,
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
  '/settings': 'settings',
  '/users': 'users',
  '/configuration': 'aiChannels',
  '/configuration/ai': 'aiChannels',
  '/configuration/platform-types': 'platformTypes',
  '/configuration/platforms': 'platforms',
  '/configuration/audit': 'auditLog',
};

function connectionInfo(): ConnectionInfo | undefined {
  return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}

export function canIdlePrefetch(connection = connectionInfo()): boolean {
  if (connection?.saveData) return false;
  return !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

export function navigationLoaderKey(path: string): RouteLoaderKey | undefined {
  return path.startsWith('/configuration/ai/channels/') ? 'aiChannelDetail' : navigationLoaders[path];
}

export async function prefetchNavigation(path: string): Promise<void> {
  const loaderKey = navigationLoaderKey(path);
  if (!loaderKey) return;
  const tasks: Promise<unknown>[] = [routeLoaders[loaderKey]()];
  if (path === '/') {
    tasks.push(queryClient.prefetchQuery(dashboardSummaryQueryOptions()));
    tasks.push(queryClient.prefetchQuery(geoMetricsQueryOptions()));
  } else if (path === '/products') {
    tasks.push(queryClient.prefetchQuery(productsQueryOptions()));
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
