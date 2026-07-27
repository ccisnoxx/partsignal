/** 验证正式新密码的前端八位边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { ChangePasswordPage } from './ChangePasswordPage';

const authState = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ user: { must_change_password: true }, refresh: authState.refresh }),
}));

test('七位新密码留在表单校验，八位新密码提交服务端', async () => {
  let submittedBody: Promise<Schema<'ChangePasswordRequest'>> | undefined;
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/v1/auth/change-password' && request.method === 'POST') {
      submittedBody = request.clone().json() as Promise<Schema<'ChangePasswordRequest'>>;
      return { body: undefined, status: 204 };
    }
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/" element={<h1>工作台</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await userEvent.type(screen.getByLabelText('当前密码'), 'old-pass');
  const newPassword = screen.getByLabelText('新密码');
  await userEvent.type(newPassword, '1234567');
  await userEvent.click(screen.getByRole('button', { name: '更新密码' }));
  await waitFor(() => expect(newPassword).toHaveAttribute('aria-invalid', 'true'));
  expect(submittedBody).toBeUndefined();

  await userEvent.type(newPassword, '8');
  await userEvent.click(screen.getByRole('button', { name: '更新密码' }));
  await waitFor(() => expect(submittedBody).toBeDefined());
  expect(await submittedBody).toEqual({
    old_password: 'old-pass',
    new_password: '12345678',
  });
});
