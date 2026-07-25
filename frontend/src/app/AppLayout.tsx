/** 内部工作台框架，在桌面和移动端提供同一套路由导航。 */
import {
  BarChartOutlined, DatabaseOutlined, DownOutlined, FileTextOutlined, LockOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RocketOutlined, SettingOutlined,
  SafetyCertificateOutlined, SearchOutlined, ToolOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { AutoComplete, Avatar, Button, Drawer, Dropdown, Grid, Input, Layout, Menu, Skeleton, Space, Typography, type MenuProps } from 'antd';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
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
  {
    key: '/observations-group', icon: <BarChartOutlined />, label: 'GEO 观测',
    children: [
      { key: '/observations', label: '观测记录' },
      { key: '/observations/insights', label: '分析洞察' },
    ],
  },
];

const systemNavigation: NavigationItem[] = [
  {
    key: '/business-settings', icon: <SettingOutlined />, label: '业务设置',
    children: [
      { key: '/settings?tab=accounts', label: '发布账号' },
      { key: '/settings', label: '历史目标问题' },
      { key: '/users', label: '用户管理', adminOnly: true },
    ],
  },
  {
    key: '/audit-security', icon: <SafetyCertificateOutlined />, label: '审计与安全', adminOnly: true,
    children: [
      { key: '/audit', label: '审计日志' },
    ],
  },
  {
    key: '/configuration', icon: <ToolOutlined />, label: '配置中心', adminOnly: true,
    children: [
      { key: '/configuration/platforms', label: '平台管理' },
      { key: '/configuration/prompts', label: '平台 Prompt' },
      { key: '/configuration/ai', label: 'AI 渠道与模型' },
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

function matchesRoute(pathname: string, search: string, key: string): boolean {
  if (key === '/tasks' && pathname.startsWith('/content/')) return true;
  const target = new URL(key, 'https://partsignal.local');
  if (target.pathname === '/settings') {
    if (pathname !== '/settings') return false;
    const currentTab = new URLSearchParams(search).get('tab');
    return target.searchParams.get('tab') === 'accounts' ? currentTab === 'accounts' : currentTab !== 'accounts';
  }
  return target.pathname === '/' ? pathname === '/' : pathname === target.pathname || pathname.startsWith(`${target.pathname}/`);
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const auth = useAuth();
  const workflowItems = filterNavigation(workflowNavigation, auth.isAdmin);
  const systemItems = filterNavigation(systemNavigation, auth.isAdmin);
  const visibleLeaves = navigationLeaves([...workflowItems, ...systemItems]);
  const searchableNavigation = [
    ...visibleLeaves,
    ...(auth.isAdmin ? [{ key: '/configuration/platform-types', label: '平台类型', parentKey: '/configuration' }] : []),
  ];
  useEffect(() => scheduleIdleRoutePrefetch(), []);
  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    const focusGlobalSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.global-navigation-search input')?.focus();
      }
    };
    window.addEventListener('keydown', focusGlobalSearch);
    return () => window.removeEventListener('keydown', focusGlobalSearch);
  }, []);
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
    .filter((item) => matchesRoute(location.pathname, location.search, item.key))
    .sort((left, right) => right.key.length - left.key.length)[0] ?? visibleLeaves.find((item) => item.key === '/');
  const selectedKey = selected?.key ?? '/';
  const currentSection = location.pathname.startsWith('/content/')
    ? '内容审核'
    : location.pathname.startsWith('/observations') ? 'GEO 观测' : selected?.label ?? '工作台';
  const isGeo = location.pathname.startsWith('/observations');
  const isConfiguration = location.pathname.startsWith('/configuration');
  const isAuditLog = location.pathname === '/audit';
  const isBusinessSettings = location.pathname === '/settings' || location.pathname === '/users';
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
        onClick={() => { setDrawerOpen(false); setGlobalSearch(''); }}
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
        <Layout.Sider theme="light" width={208} collapsedWidth={72} collapsed={collapsed} className="app-sider">
          <div className="brand-mark"><span><svg viewBox="0 0 32 28" aria-hidden="true"><path d="M3 4h16a9 9 0 0 1 0 18h-9l4-6h5a3 3 0 0 0 0-6H3z" /><path className="brand-mark-logo-secondary" d="M7 10h11l-4 6H3z" /></svg></span>{!collapsed && <strong>PartSignal</strong>}</div>
          {menu}
          <Button type="text" className="configuration-sider-collapse" aria-label={collapsed ? '展开导航' : '收起导航'} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((value) => !value)}>{!collapsed && '收起'}</Button>
        </Layout.Sider>
      ) : (
        <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} size={280} className="mobile-drawer">
          <div className="brand-mark"><span><svg viewBox="0 0 32 28" aria-hidden="true"><path d="M3 4h16a9 9 0 0 1 0 18h-9l4-6h5a3 3 0 0 0 0-6H3z" /><path className="brand-mark-logo-secondary" d="M7 10h11l-4 6H3z" /></svg></span><strong>PartSignal</strong></div>{menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header className="app-header">
          <Space size="middle" className="header-context">
            {!desktopSider && <Button type="text" aria-label="切换导航" icon={<MenuUnfoldOutlined />} onClick={() => setDrawerOpen(true)} />}
            <div>{isConfiguration ? <><Typography.Text strong>配置中心</Typography.Text><span className="header-breadcrumb-divider">/</span><Typography.Text>{currentSection}</Typography.Text></> : isAuditLog ? <><Typography.Text strong>审计与安全</Typography.Text><span className="header-breadcrumb-divider">/</span><Typography.Text>{currentSection}</Typography.Text></> : isBusinessSettings ? <><Typography.Text strong>业务设置</Typography.Text><span className="header-breadcrumb-divider">/</span><Typography.Text>{currentSection}</Typography.Text></> : isGeo ? <><Typography.Text strong>GEO 观测</Typography.Text><span className="header-breadcrumb-divider">/</span><Typography.Text>{selected?.label}</Typography.Text></> : <><Typography.Text className="header-kicker">PARTSIGNAL</Typography.Text><Typography.Text strong>{currentSection}</Typography.Text></>}</div>
          </Space>
          <AutoComplete
            className="global-navigation-search"
            value={globalSearch}
            onChange={setGlobalSearch}
            onSelect={(path) => { navigate(path); setGlobalSearch(''); }}
            options={searchableNavigation
              .filter((item) => !globalSearch || item.label.toLocaleLowerCase().includes(globalSearch.toLocaleLowerCase()))
              .map((item) => ({ value: item.key, label: <span><strong>{item.label}</strong><small>{item.parentKey === '/configuration' ? '配置中心' : '页面导航'}</small></span> }))}
          >
            <Input
              aria-label="全局页面搜索"
              prefix={<SearchOutlined />}
              placeholder="搜索内容、任务、平台、数据…"
              suffix={<kbd>⌘K</kbd>}
              allowClear
            />
          </AutoComplete>
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
        <Layout.Content ref={contentRef} tabIndex={-1} className="app-content">
          <Suspense fallback={<section className="route-loading" role="status" aria-label="页面加载中"><Skeleton active paragraph={{ rows: 6 }} /></section>}>
            <Outlet />
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
