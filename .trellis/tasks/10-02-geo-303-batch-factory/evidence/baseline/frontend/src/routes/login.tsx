import { createFileRoute, Navigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useAuth, useAuthActions } from '@/app/auth/auth-provider';
import { approvedReturnTo } from '@/app/auth/return-to';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';
import { LoginPage } from '@/domains/auth/login-page';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginRoute,
});

function LoginRoute() {
  const auth = useAuth();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const { signIn } = useAuthActions();
  const returnTo = approvedReturnTo(search.redirect);

  if (auth.isLoading) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;
  if (auth.user) {
    return auth.user.must_change_password
      ? <Navigate replace to="/account/security" />
      : <ApprovedReturnTo href={returnTo} />;
  }

  return (
    <LoginPage
      onSubmit={async (payload) => {
        const user = await signIn(payload);
        if (user.must_change_password) {
          await navigate({ replace: true, to: '/account/security' });
        } else {
          router.history.replace(returnTo);
        }
      }}
    />
  );
}

function ApprovedReturnTo({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.history.replace(href);
  }, [href, router]);

  return null;
}
