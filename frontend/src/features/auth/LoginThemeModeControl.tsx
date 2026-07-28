/** 登录页三态主题选择器，保持键盘可达且不加载工作台下拉组件。 */
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useThemeMode } from '../../app/ThemeProvider';
import { THEME_MODES, type ThemeMode } from '../../app/theme';

const labels: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
const icons: Record<ThemeMode, ReactNode> = { light: <SunOutlined />, dark: <MoonOutlined />, system: <DesktopOutlined /> };

export function LoginThemeModeControl() {
  const { mode, setMode } = useThemeMode();
  return (
    <fieldset className="theme-mode-segmented" role="radiogroup" aria-label="主题模式">
      {THEME_MODES.map((value) => (
        <label className="theme-mode-option" key={value}>
          <input
            type="radio"
            name="theme-mode"
            value={value}
            checked={mode === value}
            onChange={() => setMode(value)}
          />
          <span>{icons[value]}{labels[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
