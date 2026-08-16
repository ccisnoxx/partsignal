import { createFileRoute, Navigate } from '@tanstack/react-router';

import { useAuth, useAuthActions } from '@/app/auth/auth-provider';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';
import { LoginPage } from '@/domains/auth/login-page';

export const Route = createFileRoute('/login')({
  component: LoginRoute,
});

function LoginRoute() {
  const auth = useAuth();
  const navigate = Route.useNavigate();
  const { signIn } = useAuthActions();

  if (auth.isLoading) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;
  if (auth.user) {
    return <Navigate replace to={auth.user.must_change_password ? '/account/security' : '/'} />;
  }

  return (
    <LoginPage
      onSubmit={async (payload) => {
        const user = await signIn(payload);
        await navigate({ replace: true, to: user.must_change_password ? '/account/security' : '/' });
      }}
    />
  );
}
