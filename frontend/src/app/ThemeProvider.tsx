/** 项目级主题 Provider，统一拥有主题偏好、系统解析与 Ant Design 配置。 */
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyProjectTheme,
  createAntTheme,
  projectThemes,
  THEME_MODES,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from './theme';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  reducedMotion: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const isThemeMode = (value: unknown): value is ThemeMode => typeof value === 'string' && THEME_MODES.includes(value as ThemeMode);
const systemTheme = (): ResolvedTheme => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function initialMode(): ThemeMode {
  const bootMode = document.documentElement.dataset.themeMode;
  if (isThemeMode(bootMode)) return bootMode;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
    if (stored !== null) localStorage.removeItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn('无法读取主题偏好，本次会话将跟随系统主题。', error);
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(() => {
    const bootTheme = document.documentElement.dataset.theme;
    return bootTheme === 'light' || bootTheme === 'dark' ? bootTheme : systemTheme();
  });
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const resolvedTheme = mode === 'system' ? systemResolved : mode;

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateColorScheme = () => setSystemResolved(colorScheme.matches ? 'dark' : 'light');
    const updateMotion = () => setReducedMotion(motion.matches);
    colorScheme.addEventListener('change', updateColorScheme);
    motion.addEventListener('change', updateMotion);
    return () => {
      colorScheme.removeEventListener('change', updateColorScheme);
      motion.removeEventListener('change', updateMotion);
    };
  }, []);

  useEffect(() => {
    const syncStoredMode = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (isThemeMode(event.newValue)) setModeState(event.newValue);
      else {
        setModeState('system');
        if (event.newValue !== null) {
          try { localStorage.removeItem(THEME_STORAGE_KEY); }
          catch (error) { console.warn('无法清理无效主题偏好。', error); }
        }
      }
    };
    window.addEventListener('storage', syncStoredMode);
    return () => window.removeEventListener('storage', syncStoredMode);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.themeMode = mode;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
    root.style.backgroundColor = projectThemes[resolvedTheme].bgCanvas;
    applyProjectTheme(root, resolvedTheme);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', projectThemes[resolvedTheme].bgCanvas);
  }, [mode, resolvedTheme]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    const commit = () => {
      if (nextMode === 'system') setSystemResolved(systemTheme());
      setModeState(nextMode);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      } catch (error) {
        console.warn('无法持久化主题偏好，本次会话仍会使用当前选择。', error);
      }
    };
    const transitionDocument = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (!reducedMotion && transitionDocument.startViewTransition) transitionDocument.startViewTransition(commit);
    else commit();
  }, [reducedMotion]);
  const contextValue = useMemo(() => ({ mode, resolvedTheme, reducedMotion, setMode }), [mode, resolvedTheme, reducedMotion, setMode]);
  const antTheme = useMemo(() => createAntTheme(resolvedTheme, reducedMotion), [resolvedTheme, reducedMotion]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <ConfigProvider locale={zhCN} theme={antTheme}>
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeMode 必须在 ThemeProvider 内使用');
  return value;
}
