/** 管理员配置路由的统一权限边界。 */
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function ConfigurationLayout() {
  const auth = useAuth();
  return auth.isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}
