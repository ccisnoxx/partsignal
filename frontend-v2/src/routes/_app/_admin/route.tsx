import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { getAuthRouteUser } from '@/app/auth/auth-provider';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin')({
  beforeLoad: ({ context }) => {
    if (getAuthRouteUser(context.queryClient)?.account_type !== 'ADMIN') {
      throw notFound();
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="无法验证系统管理权限" />
  ),
  notFoundComponent: AdminForbidden,
  component: Outlet,
});

function AdminForbidden() {
  const forbiddenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => forbiddenRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <section ref={forbiddenRef} tabIndex={-1} className="space-y-2 rounded-lg border border-danger/30 bg-surface-panel p-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <p className="type-label text-text-danger">403</p>
      <h1 className="type-page-title">无权访问系统管理</h1>
      <p className="text-text-secondary">当前会话没有管理员权限，地址已保留。</p>
    </section>
  );
}
