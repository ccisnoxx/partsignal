import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import type { AuthContextValue } from '@/app/auth/auth-provider';

type RouterContext = {
  queryClient: QueryClient;
  auth: AuthContextValue;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  notFoundComponent: RootNotFound,
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}

function RootNotFound() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => sectionRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <section
        className="w-full space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        ref={sectionRef}
        tabIndex={-1}
      >
        <p className="type-label text-text-secondary">404</p>
        <h1 className="type-page-title">页面不存在</h1>
        <p className="text-text-secondary">请检查地址，或返回工作台继续操作。</p>
        <a className="inline-flex text-sm font-medium text-link hover:underline" href="/">返回工作台</a>
      </section>
    </main>
  );
}
