import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useAuth, useAuthActions } from '@/app/auth/auth-provider';
import { AccountSecurityPage } from '@/domains/auth/account-security-page';
import { AuthErrorPage, AuthLoadingPage } from '@/domains/auth/auth-page-frame';

export const Route = createFileRoute('/account/security')({
  component: AccountSecurityRoute,
});

function AccountSecurityRoute() {
  const auth = useAuth();
  const navigate = Route.useNavigate();
  const { changePassword } = useAuthActions();
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    // 等服务端刷新后的会话进入 Router 上下文，再离开强制改密页。
    if (passwordChanged && auth.user && !auth.user.must_change_password) {
      void navigate({ replace: true, to: '/' });
    }
  }, [auth.user, navigate, passwordChanged]);

  if (auth.isLoading) return <AuthLoadingPage />;
  if (auth.error) return <AuthErrorPage onRetry={() => void auth.refresh()} />;
  if (!auth.user) return <Navigate replace to="/login" />;

  return (
    <AccountSecurityPage
      mustChangePassword={auth.user.must_change_password}
      onSubmit={async (payload) => {
        await changePassword(payload);
        setPasswordChanged(true);
      }}
    />
  );
}
