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
  expect(screen.getByRole('link', { name: '发布管理' })).toHaveAttribute('href', '/publications');
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

test('管理员在渠道详情路由看到原型配置子菜单和 AI 渠道选中态', async () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/configuration/ai/channels/channel-1']}><Routes><Route element={<AppLayout />}><Route path="*" element={<h1>渠道详情</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(await screen.findByRole('menuitem', { name: /配置中心/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menuitem', { name: 'AI 渠道与模型' })).toHaveClass('ant-menu-item-selected');
  expect(screen.getAllByText('AI 渠道与模型').length).toBeGreaterThan(1);
  expect(screen.getByRole('menuitem', { name: '平台管理' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Prompt 管理' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: '平台规则' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: /业务设置/ }));
  expect(screen.getAllByRole('menuitem', { name: /用户管理/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole('menuitem', { name: /审计与安全/ }));
  expect(screen.getAllByRole('menuitem', { name: /审计日志/ })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '审计日志' })).toHaveAttribute('href', '/audit');
  expect(screen.getByRole('link', { name: '用户管理' })).toHaveAttribute('href', '/users');
  expect(screen.queryByText('事实可信 · 人工审核 · 历史可溯')).not.toBeInTheDocument();
});

test('普通用户保留业务设置基础入口，但看不到管理员入口和配置中心', async () => {
  authState.isAdmin = false;
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter><Routes><Route element={<AppLayout />}><Route index element={<h1>工作台</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /业务设置/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: /业务设置/ }));
  expect(screen.getByRole('link', { name: '发布账号' })).toHaveAttribute('href', '/settings?tab=accounts');
  expect(screen.queryByRole('link', { name: '历史目标问题' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: /GEO 观测/ }));
  expect(screen.getByRole('link', { name: 'GEO 问题库' })).toHaveAttribute('href', '/observations/topics');
  expect(screen.queryByRole('menuitem', { name: /配置中心/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'AI 渠道与模型' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /用户管理/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /审计日志/ })).not.toBeInTheDocument();
});

test('发布账号查询参数保持业务设置选中态', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/settings?tab=accounts&platform_profile_id=profile-1']}><Routes><Route element={<AppLayout />}><Route path="settings" element={<h1>业务设置页</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /业务设置/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menuitem', { name: '发布账号' })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('业务设置', { selector: '.header-context strong' })).toBeInTheDocument();
});

test('GEO 问题库归属 GEO 观测并保持选中态', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/observations/topics']}><Routes><Route element={<AppLayout />}><Route path="observations/topics" element={<h1>GEO 问题库页</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /GEO 观测/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menuitem', { name: 'GEO 问题库' })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('GEO 观测', { selector: '.header-context strong' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: '历史目标问题' })).not.toBeInTheDocument();
});

test.each([
  ['/', '工作台'],
  ['/observations', 'GEO 观测'],
  ['/publications', '发布管理'],
  ['/users', '用户管理'],
  ['/audit', '审计日志'],
  ['/configuration/ai', 'AI 渠道与模型'],
])('%s 使用统一应用壳层和侧栏几何', async (path, heading) => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><Routes><Route element={<AppLayout />}><Route path="*" element={<h1>{heading}</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  const shell = document.querySelector('.app-shell');
  expect(shell).toHaveClass('app-shell');
  expect([...shell!.classList].filter((className) => className.startsWith('app-shell-'))).toEqual([]);
  if (path === '/') expect(document.querySelector('.header-context-stacked')).toBeInTheDocument();
  expect(document.querySelector('.app-sider')).toHaveStyle({ width: '208px' });
  const collapse = screen.getByRole('button', { name: '收起导航' });
  await userEvent.click(collapse);
  expect(document.querySelector('.app-sider')).toHaveStyle({ width: '72px' });
  expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
});

test('打印路由通过显式壳层类提供打印布局', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/observations/insights/print']}><Routes><Route element={<AppLayout />}><Route path="observations/insights/print" element={<h1>打印洞察</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(document.querySelector('.app-shell')).toHaveClass('app-shell-print');
});

test('审计日志保留导航选中与审计上下文', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/audit']}><Routes><Route element={<AppLayout />}><Route path="audit" element={<h1>审计页面</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: '审计日志' })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('审计与安全', { selector: '.header-context strong' })).toBeInTheDocument();
});

test('全局搜索只提供获权页面导航并支持 Ctrl K 聚焦', async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter><Routes><Route element={<AppLayout />}><Route index element={<h1>工作台</h1>} /><Route path="configuration/platform-types" element={<h1>平台类型页</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  await user.keyboard('{Control>}k{/Control}');
  const search = screen.getByRole('combobox', { name: '全局页面搜索' });
  expect(search).toHaveFocus();
  await user.type(search, '平台类型');
  await user.click(await screen.findByText('平台类型'));
  expect(await screen.findByRole('heading', { name: '平台类型页' })).toBeInTheDocument();
});

test('内容审核路由归属内容任务并显示审核标题', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/content/version-1']}><Routes><Route element={<AppLayout />}><Route path="content/:id" element={<h1>内容正文</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /内容任务/ })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('内容审核', { selector: '.header-context strong' })).toBeInTheDocument();
});

test('发布关注与修复路由归属发布管理', () => {
  render(
    <ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/publication-attentions/attention-1/repair']}><Routes><Route element={<AppLayout />}><Route path="publication-attentions/:id/repair" element={<h1>发布修复</h1>} /></Route></Routes></MemoryRouter></QueryClientProvider></ThemeProvider>,
  );
  expect(screen.getByRole('menuitem', { name: /发布管理/ })).toHaveClass('ant-menu-item-selected');
  expect(screen.getByText('发布管理', { selector: '.header-context strong' })).toBeInTheDocument();
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
