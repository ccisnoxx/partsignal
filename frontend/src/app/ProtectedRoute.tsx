/** 保护内部路由，并保留登录后的返回地址。 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryFailure, QueryLoading } from '../shared/components/AsyncState';
import { useAuth } from '../features/auth/AuthProvider';

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <main className="centered"><QueryLoading /></main>;
  if (auth.user && auth.error) return <main className="centered"><QueryFailure error={auth.error} /></main>;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
