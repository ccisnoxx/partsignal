/** 验证未认证跳转和登录失败不会被伪装成成功。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import { mockFetch } from '../../test/fetchMock';

test('未认证用户看到完整登录边界，并展示真实登录错误', async () => {
  window.history.pushState({}, '', '/');
  const requestedPaths: string[] = [];
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    requestedPaths.push(path);
    if (path.endsWith('/auth/me')) return { status: 204, body: undefined };
    return { status: 401, body: { error: { code: 'AUTH_REQUIRED', message: '账号或密码错误', request_id: 'req-login' } } };
  });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'PartSignal' })).toBeInTheDocument();
  expect(requestedPaths).not.toContain('/api/v1/auth/csrf');
  expect(screen.getByRole('heading', { name: '多平台 GEO 内容运营系统' })).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: '主题模式' })).toBeInTheDocument();
  expect(screen.getByText('内部系统 · 操作留痕 · 全程审计 · 数据安全')).toBeInTheDocument();
  expect(screen.queryByText('忘记密码')).not.toBeInTheDocument();
  expect(screen.queryByText(/SSO/)).not.toBeInTheDocument();
  const password = screen.getByLabelText('密码');
  expect(password).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: '显示输入内容' }));
  expect(password).toHaveAttribute('type', 'text');
  await userEvent.type(screen.getByLabelText('账号'), 'operator');
  await userEvent.type(password, 'wrong-password');
  await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
  expect(await screen.findByText('账号或密码错误')).toBeInTheDocument();
  expect(requestedPaths).not.toContain('/api/v1/auth/csrf');
});

test('登录表单在请求前执行账号和密码校验', async () => {
  window.history.pushState({}, '', '/');
  const requestedPaths: string[] = [];
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    requestedPaths.push(path);
    if (path.endsWith('/auth/me')) return { status: 204, body: undefined };
    return { status: 500, body: { error: { code: 'UNEXPECTED_LOGIN', message: '不应发送登录请求' } } };
  });
  render(<App />);
  await screen.findByRole('heading', { name: 'PartSignal' });

  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(screen.getByText('请输入账号')).toBeInTheDocument();
  expect(screen.getByText('请输入密码')).toBeInTheDocument();
  expect(requestedPaths).toEqual(['/api/v1/auth/me']);

  await userEvent.type(screen.getByLabelText('账号'), 'operator');
  await userEvent.type(screen.getByLabelText('密码'), 'short');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(screen.getByText('密码至少 8 位')).toBeInTheDocument();
  expect(requestedPaths).toEqual(['/api/v1/auth/me']);
});
