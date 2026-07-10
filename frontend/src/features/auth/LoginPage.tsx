/** 内部账号登录页，不持久化密码或会话令牌。 */
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Schema } from '../../shared/api/types';
import { api, errorMessage, setCsrfToken, unwrap } from '../../shared/api/client';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const login = useMutation({
    mutationFn: async (values: Schema<'LoginRequest'>) => unwrap(await api.POST('/api/v1/auth/login', { body: values })),
    onSuccess: async (session) => {
      setCsrfToken(session.csrf_token);
      await auth.refresh();
      const target = typeof location.state === 'object' && location.state && 'from' in location.state
        ? String(location.state.from)
        : '/';
      navigate(target, { replace: true });
    },
  });

  if (auth.isAuthenticated) return <Navigate to="/" replace />;

  return (
    <main className="login-page">
      <section className="login-intro">
        <Typography.Text className="eyebrow">PARTSIGNAL / GEO OPERATIONS</Typography.Text>
        <Typography.Title>让每条替代结论<br />都有证据可循。</Typography.Title>
        <Typography.Paragraph>从产品事实到内容审核、人工发布与 GEO 观测，在同一条可追溯链路上协作。</Typography.Paragraph>
      </section>
      <Card className="login-card" variant="borderless">
        <Typography.Title level={2}>进入工作台</Typography.Title>
        <Typography.Paragraph type="secondary">使用内部账号登录。所有审核与发布操作均记录审计轨迹。</Typography.Paragraph>
        {login.error && <Alert type="error" showIcon message={errorMessage(login.error)} className="form-alert" />}
        <Form<Schema<'LoginRequest'>> layout="vertical" onFinish={(values) => login.mutate(values)} requiredMark={false}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input size="large" prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}>
            <Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={login.isPending}>登录</Button>
        </Form>
      </Card>
    </main>
  );
}
