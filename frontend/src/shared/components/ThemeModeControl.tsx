/** 三态主题选择器：工作台使用下拉，登录页可展开显示全部选项。 */
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Dropdown, Button, Segmented, Tooltip, type MenuProps } from 'antd';
import type { ReactNode } from 'react';
import { useThemeMode } from '../../app/ThemeProvider';
import { THEME_MODES, type ThemeMode } from '../../app/theme';

const labels: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
const icons: Record<ThemeMode, ReactNode> = { light: <SunOutlined />, dark: <MoonOutlined />, system: <DesktopOutlined /> };

export function ThemeModeControl({ compact = false, expanded = false }: { compact?: boolean; expanded?: boolean }) {
  const { mode, setMode } = useThemeMode();
  const items: MenuProps['items'] = THEME_MODES.map((value) => ({
    key: value,
    icon: icons[value],
    label: labels[value],
  }));
  if (expanded) {
    return (
      <Segmented<ThemeMode>
        className="theme-mode-segmented"
        aria-label="主题模式"
        tabIndex={-1}
        value={mode}
        onChange={setMode}
        options={THEME_MODES.map((value) => ({ value, label: labels[value], icon: icons[value] }))}
      />
    );
  }
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
