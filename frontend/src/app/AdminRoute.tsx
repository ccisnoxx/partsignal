/** 在受限页面挂载前统一执行管理员权限检查。 */
import { Button, Result } from 'antd';
import { useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';

export function AdminRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const alertRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (auth.isAdmin) return;
    const frame = requestAnimationFrame(() => alertRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [auth.isAdmin]);

  if (auth.isAdmin) return <Outlet />;

  return (
    <section
      ref={alertRef}
      role="alert"
      aria-labelledby="admin-access-denied-title"
      tabIndex={-1}
    >
      <Result
        status="403"
        title={<span id="admin-access-denied-title">无权访问</span>}
        subTitle="当前账号没有访问此管理页面的权限。"
        extra={<Button type="primary" onClick={() => navigate('/')}>返回工作台</Button>}
      />
    </section>
  );
}
