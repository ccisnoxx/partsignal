/** 验证懒路由只替换内容区，导航框架与预取交互保持可用。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, type ComponentType } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { queryClient } from './queryClient';
import { ThemeProvider } from './ThemeProvider';

const prefetchNavigation = vi.fn();
const authState = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { username: 'reviewer', display_name: '审核工程师' },
    isAdmin: authState.isAdmin,
    refresh: vi.fn(),
  }),
}));

vi.mock('./routePrefetch', () => ({
  prefetchNavigation: (...args: unknown[]) => prefetchNavigation(...args),
  scheduleIdleRoutePrefetch: () => () => undefined,
}));

beforeEach(() => {
  prefetchNavigation.mockReset();
  authState.isAdmin = true;
});

test('懒路由加载期间保持侧栏、页头和用户区稳定', async () => {
  type LazyModule = { default: ComponentType };
  let resolvePage!: (module: LazyModule) => void;
  const LazyPage = lazy(() => new Promise<LazyModule>((resolve) => { resolvePage = resolve; }));
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<LazyPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

  expect(screen.getByText('PartSignal')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '打开用户操作菜单' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: '页面加载中' })).toBeInTheDocument();

  await act(async () => resolvePage({ default: () => <h1>延迟页面</h1> }));
  expect(await screen.findByRole('heading', { name: '延迟页面' })).toBeInTheDocument();
  expect(screen.getByText('PartSignal')).toBeInTheDocument();
});

test('侧栏链接在键盘 focus 时预取单个目标路由', async () => {
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}><Route index element={<h1>工作台内容</h1>} /></Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const productsLink = screen.getByRole('link', { name: '产品事实' });
  await userEvent.tab();
  productsLink.focus();
  expect(prefetchNavigation).toHaveBeenCalledWith('/products');
});

test('管理员在渠道详情路由看到展开的配置子菜单和 AI 配置选中态', async () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/configuration/ai/channels/channel-1']}><Routes><Route element={<AppLayout />}><Route path="*" element={<h1>渠道详情</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(await screen.findByRole('menuitem', { name: /配置中心/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menuitem', { name: 'AI 配置' })).toHaveClass('ant-menu-item-selected');
  expect(screen.getAllByText('AI 配置').length).toBeGreaterThan(1);
  expect(screen.getByRole('menuitem', { name: '平台规则' })).toBeInTheDocument();
  expect(screen.getAllByRole('menuitem', { name: /审计日志/ })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '审计日志' })).toHaveAttribute('href', '/audit');
  expect(screen.queryByText('事实可信 · 人工审核 · 历史可溯')).not.toBeInTheDocument();
});

test('普通用户看不到配置中心、审计日志及配置子菜单', () => {
  authState.isAdmin = false;
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter><Routes><Route element={<AppLayout />}><Route index element={<h1>工作台</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.queryByRole('menuitem', { name: /配置中心/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'AI 配置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /审计日志/ })).not.toBeInTheDocument();
});

test('内容审核路由归属内容任务并显示审核标题', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/content/version-1']}><Routes><Route element={<AppLayout />}><Route path="content/:id" element={<h1>内容正文</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /内容任务/ })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('内容审核', { selector: '.header-context strong' })).toBeInTheDocument();
});

test('路径变化聚焦主内容，但查询参数变化不抢焦点', async () => {
  const user = userEvent.setup();
  const Page = () => <><h1>焦点测试</h1><Link to="?page=2">切换分页</Link><Link to="/next">打开下一页</Link></>;
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter><Routes><Route element={<AppLayout />}><Route path="*" element={<Page />} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  const content = document.querySelector<HTMLElement>('.app-content');
  await waitFor(() => expect(document.activeElement).toBe(content));
  const paginationLink = screen.getByRole('link', { name: '切换分页' });
  await user.click(paginationLink);
  expect(document.activeElement).toBe(paginationLink);
  await user.click(screen.getByRole('link', { name: '打开下一页' }));
  await waitFor(() => expect(document.activeElement).toBe(content));
});
