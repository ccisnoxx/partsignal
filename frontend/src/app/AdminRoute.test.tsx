/** 验证管理员路由在受限页面挂载前统一拒绝未获权访问。 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { AdminRoute } from './AdminRoute';

const authState = vi.hoisted(() => ({ isAdmin: true }));
const restrictedPage = vi.fn();

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: authState.isAdmin }) }));

beforeEach(() => {
  authState.isAdmin = true;
  restrictedPage.mockReset();
});

function RestrictedPage() {
  restrictedPage();
  return <h1>管理员页面</h1>;
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>;
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<><LocationProbe /><Outlet /></>}>
          <Route index element={<h1>工作台</h1>} />
          <Route element={<AdminRoute />}>
            <Route path="users" element={<RestrictedPage />} />
            <Route path="audit" element={<RestrictedPage />} />
            <Route path="configuration/*" element={<RestrictedPage />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test.each(['/users', '/audit', '/configuration/ai'])('管理员可以进入 %s', (path) => {
  renderRoute(path);
  expect(screen.getByRole('heading', { name: '管理员页面' })).toBeInTheDocument();
  expect(restrictedPage).toHaveBeenCalledOnce();
});

test.each(['/users', '/audit?outcome=DENIED', '/configuration/ai'])(
  '工程师直达 %s 时保留地址且不挂载受限页面',
  async (path) => {
    authState.isAdmin = false;
    renderRoute(path);

    const alert = screen.getByRole('alert', { name: '无权访问' });
    expect(screen.getByRole('button', { name: '返回工作台' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(path);
    expect(restrictedPage).not.toHaveBeenCalled();
    await waitFor(() => expect(alert).toHaveFocus());
  },
);

test('返回工作台可由键盘激活', async () => {
  authState.isAdmin = false;
  renderRoute('/audit');
  await waitFor(() => expect(screen.getByRole('alert', { name: '无权访问' })).toHaveFocus());

  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole('button', { name: '返回工作台' })).toHaveFocus();
  await user.keyboard('{Enter}');

  expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument();
  expect(screen.getByLabelText('当前地址')).toHaveTextContent('/');
});
