import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { getAuthRouteUser } from '@/app/auth/auth-provider';
import { Button } from '@/design-system/primitives/button';
import { RouteError } from '@/design-system/workspace/route-error';
import { geoRulesQueryOptions } from '@/domains/geo-rules/geo-rules.api';
import { GeoRulesPage } from '@/domains/geo-rules/geo-rules-page';

export const Route = createFileRoute('/_app/configuration/geo-rules')({
  staticData: { navId: 'geo-rules', breadcrumb: 'GEO 规则与阈值' },
  beforeLoad: ({ context }) => {
    if (getAuthRouteUser(context.queryClient)?.account_type !== 'ADMIN') throw notFound();
  },
  loader: ({ context }) => { void context.queryClient.prefetchQuery(geoRulesQueryOptions()); },
  notFoundComponent: GeoRulesForbidden,
  errorComponent: ({ error, reset }) => <RouteError title="GEO 规则配置发生错误" error={error} onRetry={reset} />,
  component: GeoRulesRoute,
});

function GeoRulesRoute() {
  const { auth } = Route.useRouteContext();
  return <GeoRulesPage csrfToken={auth.csrfToken} />;
}
function GeoRulesForbidden() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, []);
  return <section ref={ref} tabIndex={-1} className="space-y-3 rounded-lg border border-danger/30 bg-surface-panel p-5">
    <p className="text-danger">403</p><h1 className="type-page-title">无权访问 GEO 规则配置</h1>
    <p className="text-text-secondary">GEO 规则配置仅供管理员访问，当前地址已保留。</p>
    <Button render={<Link to="/" />} variant="outline">返回工作台</Button>
  </section>;
}
