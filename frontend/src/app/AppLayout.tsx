/** 内部工作台框架，在桌面和移动端提供同一套路由导航。 */
import {
  BarChartOutlined, DatabaseOutlined, DownOutlined, FileTextOutlined, LockOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RocketOutlined, SettingOutlined,
  TeamOutlined, ToolOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Skeleton, Space, Typography, type MenuProps } from 'antd';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { api, csrfHeader, ensureSuccess, setCsrfToken } from '../shared/api/client';
import { ThemeModeControl } from '../shared/components/ThemeModeControl';
import { queryClient } from './queryClient';
import { prefetchNavigation, scheduleIdleRoutePrefetch } from './routePrefetch';

type NavigationItem = { key: string; icon?: ReactNode; label: string; adminOnly?: boolean; children?: NavigationItem[] };

const workflowNavigation: NavigationItem[] = [
  { key: '/', icon: <BarChartOutlined />, label: '工作台' },
  { key: '/products', icon: <DatabaseOutlined />, label: '产品事实' },
  { key: '/tasks', icon: <FileTextOutlined />, label: '内容任务' },
  { key: '/publications', icon: <RocketOutlined />, label: '人工发布' },
  { key: '/observations', icon: <BarChartOutlined />, label: 'GEO 观测' },
];

const systemNavigation: NavigationItem[] = [
  { key: '/settings', icon: <SettingOutlined />, label: '业务设置' },
  { key: '/users', icon: <TeamOutlined />, label: '用户管理', adminOnly: true },
  {
    key: '/configuration', icon: <ToolOutlined />, label: '配置中心', adminOnly: true,
    children: [
      { key: '/configuration/ai', label: 'AI 配置' },
      { key: '/configuration/platform-types', label: '平台类型' },
      { key: '/configuration/platforms', label: '平台管理' },
      { key: '/configuration/prompts', label: 'Prompt 管理' },
      { key: '/configuration/audit', label: '审计日志' },
    ],
  },
];

function filterNavigation(items: NavigationItem[], isAdmin: boolean): NavigationItem[] {
  return items.flatMap((item) => {
    if (item.adminOnly && !isAdmin) return [];
    return [{ ...item, children: item.children ? filterNavigation(item.children, isAdmin) : undefined }];
  });
}

function navigationLeaves(items: NavigationItem[], parentKey?: string): Array<NavigationItem & { parentKey?: string }> {
  return items.flatMap((item) => item.children?.length
    ? navigationLeaves(item.children, item.key)
    : [{ ...item, parentKey }]);
}

function matchesRoute(pathname: string, key: string): boolean {
  return key === '/' ? pathname === '/' : pathname === key || pathname.startsWith(`${key}/`);
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const workflowItems = filterNavigation(workflowNavigation, auth.isAdmin);
  const systemItems = filterNavigation(systemNavigation, auth.isAdmin);
  const visibleLeaves = navigationLeaves([...workflowItems, ...systemItems]);
  useEffect(() => scheduleIdleRoutePrefetch(), []);
  const logout = useMutation({
    mutationFn: async () => ensureSuccess(await api.POST('/api/v1/auth/logout', { params: { header: csrfHeader() } })),
    onSuccess: async () => {
      setCsrfToken(null);
      queryClient.clear();
      await auth.refresh();
      navigate('/login', { replace: true });
    },
  });
  const selected = visibleLeaves
    .filter((item) => matchesRoute(location.pathname, item.key))
    .sort((left, right) => right.key.length - left.key.length)[0] ?? visibleLeaves.find((item) => item.key === '/');
  const selectedKey = selected?.key ?? '/';
  const currentSection = selected?.label ?? '工作台';
  const toMenuItems = (items: NavigationItem[]): MenuProps['items'] => items.map((item) => ({
    key: item.key,
    icon: item.icon,
    children: item.children ? toMenuItems(item.children) : undefined,
    label: item.children ? (
      <span onMouseEnter={() => void prefetchNavigation(item.key)} onFocus={() => void prefetchNavigation(item.key)}>{item.label}</span>
    ) : (
      <Link
        to={item.key}
        onMouseEnter={() => void prefetchNavigation(item.key)}
        onFocus={() => void prefetchNavigation(item.key)}
        onClick={() => setDrawerOpen(false)}
      >{item.label}</Link>
    ),
  }));
  const menuItems: MenuProps['items'] = [
    { type: 'group', label: '内容工作流', children: toMenuItems(workflowItems) },
    { type: 'group', label: '系统管理', children: toMenuItems(systemItems) },
  ];
  const menu = <Menu key={location.pathname} mode="inline" items={menuItems} selectedKeys={[selectedKey]} defaultOpenKeys={selected?.parentKey ? [selected.parentKey] : []} />;
  const desktopSider = !!screens.lg;

  return (
    <Layout className="app-shell">
      {desktopSider ? (
        <Layout.Sider theme="light" width={232} collapsedWidth={72} collapsed={collapsed} className="app-sider">
          <div className="brand-mark"><span>PS</span>{!collapsed && <strong>PartSignal</strong>}</div>
          {menu}
          {!collapsed && <div className="sider-note">事实可信 · 人工审核 · 历史可溯</div>}
        </Layout.Sider>
      ) : (
        <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} size={280} className="mobile-drawer">
          <div className="brand-mark"><span>PS</span><strong>PartSignal</strong></div>{menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header className="app-header">
          <Space size="middle" className="header-context">
            <Button type="text" aria-label="切换导航" icon={desktopSider ? (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : <MenuUnfoldOutlined />} onClick={() => desktopSider ? setCollapsed((value) => !value) : setDrawerOpen(true)} />
            <div><Typography.Text className="header-kicker">PARTSIGNAL</Typography.Text><Typography.Text strong>{currentSection}</Typography.Text></div>
          </Space>
          <Space size="small" className="header-actions">
            <ThemeModeControl compact={!screens.md} />
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'password', icon: <LockOutlined />, label: '修改密码' },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', disabled: logout.isPending },
                ],
                onClick: ({ key }) => key === 'password' ? navigate('/change-password') : logout.mutate(),
              }}
            >
              <Button type="text" className="user-trigger" aria-label="打开用户操作菜单">
                <Avatar>{auth.user?.display_name.slice(0, 1)}</Avatar>
                <span className="user-block"><strong>{auth.user?.display_name}</strong><small>{auth.user?.username}</small></span>
                <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Suspense fallback={<section className="route-loading" role="status" aria-label="页面加载中"><Skeleton active paragraph={{ rows: 6 }} /></section>}>
            <Outlet />
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
