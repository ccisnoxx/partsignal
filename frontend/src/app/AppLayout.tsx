/** 内部工作台框架，在桌面和移动端提供同一套路由导航。 */
import {
  BarChartOutlined, DatabaseOutlined, DownOutlined, FileTextOutlined, LockOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RocketOutlined, SettingOutlined,
  TeamOutlined, ToolOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Space, Typography, type MenuProps } from 'antd';
import { useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { api, csrfHeader, ensureSuccess, setCsrfToken } from '../shared/api/client';
import { queryClient } from './queryClient';

type NavigationItem = { key: string; icon: ReactNode; label: string; adminOnly?: boolean };

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
  { key: '/configuration', icon: <ToolOutlined />, label: '配置中心', adminOnly: true },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const filterNavigation = (items: NavigationItem[]) => items.filter((item) => !item.adminOnly || auth.isAdmin);
  const workflowItems = filterNavigation(workflowNavigation);
  const systemItems = filterNavigation(systemNavigation);
  const visibleNavigation = [...workflowItems, ...systemItems];
  const logout = useMutation({
    mutationFn: async () => ensureSuccess(await api.POST('/api/v1/auth/logout', { params: { header: csrfHeader() } })),
    onSuccess: async () => {
      setCsrfToken(null);
      queryClient.clear();
      await auth.refresh();
      navigate('/login', { replace: true });
    },
  });
  const selectedKey = visibleNavigation.find((item) => item.key !== '/' && location.pathname.startsWith(item.key))?.key ?? '/';
  const currentSection = visibleNavigation.find((item) => item.key === selectedKey)?.label ?? '工作台';
  const menuItems: MenuProps['items'] = [
    { type: 'group', label: '内容工作流', children: workflowItems },
    { type: 'group', label: '系统管理', children: systemItems },
  ];
  const menu = <Menu theme="dark" mode="inline" items={menuItems} selectedKeys={[selectedKey]} onClick={({ key }) => { navigate(key); setDrawerOpen(false); }} />;
  const desktopSider = !!screens.lg;

  return (
    <Layout className="app-shell">
      {desktopSider ? (
        <Layout.Sider width={232} collapsedWidth={72} collapsed={collapsed} className="app-sider">
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
        </Layout.Header>
        <Layout.Content className="app-content"><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  );
}
