import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AppShell } from '@/app/layout/app-shell';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  const { auth } = Route.useRouteContext();
  return (
    <AppShell auth={auth}>
      <Outlet />
    </AppShell>
  );
}
