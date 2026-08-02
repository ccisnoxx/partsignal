/** 强制改密和普通自助改密共用的受限页面。 */
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AntThemeProvider } from '../../app/AntThemeProvider';
import { api, csrfHeader, ensureSuccess, errorMessage } from '../../shared/api/client';
import type { Schema } from '../../shared/api/types';
import { useAuth } from './AuthProvider';

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const change = useMutation({ mutationFn: async (body: Schema<'ChangePasswordRequest'>) => ensureSuccess(await api.POST('/api/v1/auth/change-password', { params: { header: csrfHeader() }, body })), onSuccess: async () => { await auth.refresh(); navigate('/', { replace: true }); } });
  return <AntThemeProvider><main className="centered"><Card className="password-card"><Typography.Text className="eyebrow">账号安全</Typography.Text><Typography.Title level={2}>修改密码</Typography.Title><Typography.Paragraph type="secondary">{auth.user?.must_change_password ? '当前使用临时密码，完成修改后才能进入工作台。' : '修改后其他登录会话会被撤销。'}</Typography.Paragraph>{change.error && <Alert role="alert" type="error" showIcon title={errorMessage(change.error)} />}<Form<Schema<'ChangePasswordRequest'>> layout="vertical" scrollToFirstError onFinish={(body) => change.mutate(body)}><Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }, { min: 8, message: '当前密码至少 8 位' }]}><Input.Password autoComplete="current-password" /></Form.Item><Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '新密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item><Button type="primary" htmlType="submit" block loading={change.isPending}>更新密码</Button></Form></Card></main></AntThemeProvider>;
}
