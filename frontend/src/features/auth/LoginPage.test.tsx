/** 验证未认证跳转和登录失败不会被伪装成成功。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import { mockFetch } from '../../test/fetchMock';

test('未认证用户看到完整登录边界，并展示真实登录错误', async () => {
  window.history.pushState({}, '', '/');
  mockFetch((request) => request.method === 'POST'
    ? { status: 401, body: { error: { code: 'AUTH_REQUIRED', message: '账号或密码错误', request_id: 'req-login' } } }
    : { status: 401, body: { error: { code: 'AUTH_REQUIRED', message: '请先登录', request_id: 'req-auth' } } });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'PartSignal' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '多平台 GEO 内容运营系统' })).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: '主题模式' })).toBeInTheDocument();
  expect(screen.getByText('内部系统 · 操作留痕 · 全程审计 · 数据安全')).toBeInTheDocument();
  expect(screen.queryByText('忘记密码')).not.toBeInTheDocument();
  expect(screen.queryByText(/SSO/)).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('账号'), 'operator');
  await userEvent.type(screen.getByLabelText('密码'), 'wrong-password');
  await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
  expect(await screen.findByText('账号或密码错误')).toBeInTheDocument();
});
