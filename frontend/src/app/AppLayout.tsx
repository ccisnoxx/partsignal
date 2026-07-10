/** 内部工作台框架，在桌面和移动端提供同一套路由导航。 */
import {
  BarChartOutlined, DatabaseOutlined, FileTextOutlined, MenuFoldOutlined,
  MenuUnfoldOutlined, RocketOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Avatar, Button, Drawer, Grid, Layout, Menu, Space, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, csrfHeader, ensureSuccess, setCsrfToken } from '../shared/api/client';
import { useAuth } from '../features/auth/AuthProvider';
import { queryClient } from './queryClient';
import type { Role } from '../shared/api/types';

const navigation: Array<{ key: string; icon: ReactNode; label: string; roles?: Role[] }> = [
  { key: '/', icon: <BarChartOutlined />, label: '工作台' },
  { key: '/products', icon: <DatabaseOutlined />, label: '产品事实' },
  { key: '/tasks', icon: <FileTextOutlined />, label: '内容任务' },
  { key: '/publications', icon: <RocketOutlined />, label: '人工发布' },
  { key: '/observations', icon: <BarChartOutlined />, label: 'GEO 观测' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统配置', roles: ['SYSTEM_ADMIN', 'CONTENT_EDITOR'] },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const visibleNavigation = navigation.filter((item) => !item.roles || auth.hasRole(...item.roles));
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
  const menu = <Menu theme="dark" mode="inline" items={visibleNavigation} selectedKeys={[selectedKey]} onClick={({ key }) => { navigate(key); setDrawerOpen(false); }} />;

  return (
    <Layout className="app-shell">
      {screens.md ? (
        <Layout.Sider width={228} collapsed={collapsed} className="app-sider">
          <div className="brand-mark"><span>PS</span>{!collapsed && <strong>PartSignal</strong>}</div>
          {menu}
          {!collapsed && <div className="sider-note">事实可信 · 人工审核 · 历史可溯</div>}
        </Layout.Sider>
      ) : (
        <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={260} className="mobile-drawer">
          <div className="brand-mark"><span>PS</span><strong>PartSignal</strong></div>{menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header className="app-header">
          <Button type="text" aria-label="切换导航" icon={screens.md ? (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : <MenuUnfoldOutlined />}
            onClick={() => screens.md ? setCollapsed((value) => !value) : setDrawerOpen(true)} />
          <Space size="middle">
            <Avatar>{auth.user?.display_name.slice(0, 1)}</Avatar>
            <div className="user-block"><Typography.Text strong>{auth.user?.display_name}</Typography.Text><Typography.Text type="secondary">{auth.user?.username}</Typography.Text></div>
            <Button type="text" loading={logout.isPending} onClick={() => logout.mutate()}>退出</Button>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content"><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  );
}
