/** 工作台三态主题下拉，只随受保护路由加载。 */
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Dropdown, Button, Tooltip, type MenuProps } from 'antd';
import type { ReactNode } from 'react';
import { useThemeMode } from '../../app/ThemeProvider';
import { THEME_MODES, type ThemeMode } from '../../app/theme';

const labels: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
const icons: Record<ThemeMode, ReactNode> = { light: <SunOutlined />, dark: <MoonOutlined />, system: <DesktopOutlined /> };

export function ThemeModeControl({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useThemeMode();
  const items: MenuProps['items'] = THEME_MODES.map((value) => ({
    key: value,
    icon: icons[value],
    label: labels[value],
  }));
  return (
    <Dropdown trigger={['click']} menu={{ items, selectable: true, selectedKeys: [mode], onClick: ({ key }) => setMode(key as ThemeMode) }}>
      <Tooltip title={compact ? `主题：${labels[mode]}` : undefined}>
        <Button className="theme-mode-control" type="text" icon={icons[mode]} aria-label={`主题：${labels[mode]}`}>
          {!compact && labels[mode]}
        </Button>
      </Tooltip>
    </Dropdown>
  );
}
