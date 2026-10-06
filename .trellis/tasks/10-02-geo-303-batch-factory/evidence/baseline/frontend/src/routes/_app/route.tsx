import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';

import { getAuthRouteUser } from '@/app/auth/auth-provider';
import { approvedReturnTo } from '@/app/auth/return-to';
import { AppShell } from '@/app/layout/app-shell';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const user = getAuthRouteUser(context.queryClient);
    if (!user) {
      throw redirect({
        replace: true,
        to: '/login',
        search: { redirect: approvedReturnTo(location.href) },
      });
    }
    if (user.must_change_password) {
      throw redirect({ replace: true, to: '/account/security' });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { auth } = Route.useRouteContext();
  if (auth.isLoading) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;
  if (!auth.user) return <Navigate replace search={{ redirect: undefined }} to="/login" />;
  if (auth.user.must_change_password) return <Navigate replace to="/account/security" />;

  return (
    <AppShell auth={auth}>
      <Outlet />
    </AppShell>
  );
}
