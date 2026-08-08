import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';

export const Route = createFileRoute('/_app/_admin')({
  component: AdminBoundary,
});

function AdminBoundary() {
  const { auth } = Route.useRouteContext();
  const forbiddenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (auth.isLoading || auth.error || auth.isAdmin) return;
    const timeout = window.setTimeout(() => forbiddenRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [auth.error, auth.isAdmin, auth.isLoading]);

  if (auth.isLoading) {
    return <Skeleton aria-label="正在验证访问权限" className="h-32 w-full" />;
  }

  if (auth.error) {
    return (
      <section className="space-y-3 rounded-lg border border-danger/30 bg-surface-panel p-5" role="alert">
        <h1 className="type-page-title">无法验证访问权限</h1>
        <p className="text-text-secondary">认证服务暂时不可用，请重试。</p>
        <Button variant="outline" onClick={() => void auth.refresh()}>重试</Button>
      </section>
    );
  }

  if (!auth.isAdmin) {
    return (
      <section ref={forbiddenRef} tabIndex={-1} className="space-y-2 rounded-lg border border-danger/30 bg-surface-panel p-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <p className="type-label text-text-danger">403</p>
        <h1 className="type-page-title">无权访问系统管理</h1>
        <p className="text-text-secondary">当前会话没有管理员权限，地址已保留。</p>
      </section>
    );
  }

  return <Outlet />;
}
