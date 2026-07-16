/** 验证主题偏好只有一个状态源，并正确响应持久化与系统变化。 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useThemeMode, ThemeProvider } from './ThemeProvider';
import { projectThemes, THEME_STORAGE_KEY } from './theme';

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
  return <><span>{theme.mode}/{theme.resolvedTheme}</span><button onClick={() => theme.setMode('light')}>使用浅色</button><button onClick={() => theme.setMode('dark')}>使用深色</button></>;
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

test('浅深模式同步更新画布与玻璃材质变量', async () => {
  installMatchMedia({ dark: false });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  const root = document.documentElement;
  const lightCanvas = root.style.backgroundColor;
  expect(root.style.getPropertyValue('--ps-bg-canvas')).toBe(projectThemes.light.bgCanvas);
  expect(root.style.getPropertyValue('--ps-glass-surface')).toBe(projectThemes.light.glassSurface);
  expect(root.style.getPropertyValue('--ps-glass-backdrop')).toBe(projectThemes.light.glassBackdrop);

  await userEvent.click(screen.getByRole('button', { name: '使用深色' }));
  expect(root.style.backgroundColor).not.toBe(lightCanvas);
  expect(root.style.getPropertyValue('--ps-bg-canvas')).toBe(projectThemes.dark.bgCanvas);
  expect(root.style.getPropertyValue('--ps-glass-surface')).toBe(projectThemes.dark.glassSurface);
  expect(root.style.getPropertyValue('--ps-glass-backdrop')).toBe(projectThemes.dark.glassBackdrop);
});
