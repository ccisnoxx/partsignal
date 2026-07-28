/** 验证主题偏好只有一个状态源，并正确响应持久化与系统变化。 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useThemeMode, ThemeProvider } from './ThemeProvider';
import { createAntTheme } from './AntThemeProvider';
import { projectThemes, THEME_STORAGE_KEY, visualConstants } from './theme';

type MediaListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initial: { dark: boolean; reduced?: boolean }) {
  const state = { dark: initial.dark, reduced: initial.reduced ?? false };
  const listeners = new Map<string, Set<MediaListener>>();
  const matches = (query: string) => query.includes('prefers-color-scheme') ? state.dark : state.reduced;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() { return matches(query); },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, listener: MediaListener) => {
        const current = listeners.get(query) ?? new Set<MediaListener>();
        current.add(listener);
        listeners.set(query, current);
      },
      removeEventListener: (_type: string, listener: MediaListener) => listeners.get(query)?.delete(listener),
      dispatchEvent: () => false,
    }),
  });
  return {
    setDark(dark: boolean) {
      state.dark = dark;
      const query = '(prefers-color-scheme: dark)';
      listeners.get(query)?.forEach((listener) => listener({ matches: dark, media: query } as MediaQueryListEvent));
    },
  };
}

function Probe() {
  const theme = useThemeMode();
  return <><span>{theme.mode}/{theme.resolvedTheme}</span><button onClick={() => theme.setMode('light')}>使用浅色</button><button onClick={() => theme.setMode('dark')}>使用深色</button><button onClick={() => theme.setMode('system')}>跟随系统</button></>;
}

function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const channel = (offset: number) => {
      const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});

test('首次无偏好时跟随系统并持久化显式选择', async () => {
  installMatchMedia({ dark: true });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByText('system/dark')).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  await userEvent.click(screen.getByRole('button', { name: '使用浅色' }));
  expect(screen.getByText('light/light')).toBeInTheDocument();
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
});

test('仅跟随系统模式响应系统主题变化', () => {
  const media = installMatchMedia({ dark: false });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByText('system/light')).toBeInTheDocument();
  act(() => media.setDark(true));
  expect(screen.getByText('system/dark')).toBeInTheDocument();
});

test('从显式主题切回系统时立即读取当前系统配色', async () => {
  installMatchMedia({ dark: false });
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByText('dark/dark')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '跟随系统' }));
  expect(screen.getByText('system/light')).toBeInTheDocument();
});

test('跨标签页主题变化同步到当前页面', () => {
  installMatchMedia({ dark: false });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })));
  expect(screen.getByText('dark/dark')).toBeInTheDocument();
});

test('无效持久化值被清理并回到跟随系统', () => {
  installMatchMedia({ dark: false });
  localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByText('system/light')).toBeInTheDocument();
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
});

test('浅深模式同步更新主题与共享视觉变量', async () => {
  installMatchMedia({ dark: false });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  const root = document.documentElement;
  const antTheme = createAntTheme('light', false);
  const lightCanvas = root.style.backgroundColor;
  expect(root.style.getPropertyValue('--ps-bg-canvas')).toBe(projectThemes.light.bgCanvas);
  expect(root.style.getPropertyValue('--ps-glass-surface')).toBe(projectThemes.light.glassSurface);
  expect(root.style.getPropertyValue('--ps-glass-backdrop')).toBe(projectThemes.light.glassBackdrop);
  expect(root.style.getPropertyValue('--ps-action-primary-end')).toBe(projectThemes.light.actionPrimaryEnd);
  expect(root.style.getPropertyValue('--ps-ambient-blue')).toBe(projectThemes.light.ambientBlue);
  expect(root.style.getPropertyValue('--ps-ambient-purple')).toBe(projectThemes.light.ambientPurple);
  expect(root.style.getPropertyValue('--ps-ambient-pink')).toBe(projectThemes.light.ambientPink);
  expect(root.style.getPropertyValue('--ps-font-sans')).toBe(visualConstants.fontSans);
  expect(root.style.getPropertyValue('--ps-font-mono')).toBe(visualConstants.fontMono);
  expect(antTheme.token?.fontFamily).toBe('var(--ps-font-sans)');
  expect(antTheme.token?.fontFamilyCode).toBe('var(--ps-font-mono)');
  expect(root.style.getPropertyValue('--ps-radius-compact')).toBe('6px');
  expect(root.style.getPropertyValue('--ps-radius-sm')).toBe(`${antTheme.token?.borderRadius}px`);
  expect(root.style.getPropertyValue('--ps-radius-md')).toBe('12px');
  expect(root.style.getPropertyValue('--ps-radius-lg')).toBe(`${antTheme.token?.borderRadiusLG}px`);
  expect(root.style.getPropertyValue('--ps-motion-fast')).toBe(antTheme.token?.motionDurationFast);
  expect(root.style.getPropertyValue('--ps-motion-base')).toBe(antTheme.token?.motionDurationMid);
  expect(root.style.getPropertyValue('--ps-motion-slow')).toBe(antTheme.token?.motionDurationSlow);
  expect([antTheme.token?.motionDurationFast, antTheme.token?.motionDurationMid, antTheme.token?.motionDurationSlow]).toEqual(['160ms', '200ms', '240ms']);

  await userEvent.click(screen.getByRole('button', { name: '使用深色' }));
  expect(root.style.backgroundColor).not.toBe(lightCanvas);
  expect(root.style.getPropertyValue('--ps-bg-canvas')).toBe(projectThemes.dark.bgCanvas);
  expect(root.style.getPropertyValue('--ps-glass-surface')).toBe(projectThemes.dark.glassSurface);
  expect(root.style.getPropertyValue('--ps-glass-backdrop')).toBe(projectThemes.dark.glassBackdrop);
  expect(root.style.getPropertyValue('--ps-action-primary-end')).toBe(projectThemes.dark.actionPrimaryEnd);
});

test('控件边界与主操作渐变端点满足浅深模式对比度基线', () => {
  (['light', 'dark'] as const).forEach((mode) => {
    const tokens = projectThemes[mode];
    expect(createAntTheme(mode, false).token?.colorBorder).toBe(tokens.borderStrong);
    expect(contrastRatio(tokens.borderStrong, tokens.bgSurface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.actionOnPrimary, tokens.actionPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.actionOnPrimary, tokens.actionPrimaryEnd)).toBeGreaterThanOrEqual(4.5);
  });
});
