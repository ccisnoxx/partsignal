/** 三态主题选择器，在登录页和工作台共用同一交互。 */
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Dropdown, Button, type MenuProps } from 'antd';
import type { ReactNode } from 'react';
import { useThemeMode } from '../../app/ThemeProvider';
import type { ThemeMode } from '../../app/theme';

const labels: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
const icons: Record<ThemeMode, ReactNode> = { light: <SunOutlined />, dark: <MoonOutlined />, system: <DesktopOutlined /> };

export function ThemeModeControl({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useThemeMode();
  const items: MenuProps['items'] = (['light', 'dark', 'system'] as const).map((value) => ({
    key: value,
    icon: icons[value],
    label: labels[value],
  }));
  return (
    <Dropdown trigger={['click']} menu={{ items, selectable: true, selectedKeys: [mode], onClick: ({ key }) => setMode(key as ThemeMode) }}>
      <Button className="theme-mode-control" type="text" icon={icons[mode]} aria-label={`主题：${labels[mode]}`}>
        {!compact && labels[mode]}
      </Button>
    </Dropdown>
  );
}
