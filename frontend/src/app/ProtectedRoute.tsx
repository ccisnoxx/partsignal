/** 保护内部路由，并保留登录后的返回地址。 */
import { Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { ApiError, errorMessage } from '../shared/api/client';

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  const loading = <main className="auth-boot"><p aria-busy="true">正在加载内容…</p></main>;
  if (auth.isLoading) return loading;
  if (auth.user && auth.error) {
    const apiError = auth.error instanceof ApiError ? auth.error : null;
    return (
      <main className="centered">
        <section role="alert">
          <h1>加载失败</h1>
          <p>{errorMessage(auth.error)}</p>
          {apiError && <p className="data-code">错误码：{apiError.code}{apiError.requestId ? ` · 请求 ID：${apiError.requestId}` : ''}</p>}
        </section>
      </main>
    );
  }
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (auth.user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return (
    <Suspense fallback={loading}>
      <Outlet />
    </Suspense>
  );
}
