/** 在 React 启动前同步恢复主题，避免首帧使用错误配色。 */
(() => {
  const storageKey = 'partsignal.theme-mode';
  const validModes = ['light', 'dark', 'system'];
  let mode = 'system';
  try {
    const stored = globalThis.localStorage.getItem(storageKey);
    if (validModes.includes(stored)) mode = stored;
    else if (stored !== null) globalThis.localStorage.removeItem(storageKey);
  } catch (error) {
    console.warn('无法读取主题偏好，本次会话将跟随系统主题。', error);
  }
  const resolved = mode === 'system'
    ? (globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  const canvas = resolved === 'dark' ? '#111827' : '#F4F7FC';
  globalThis.document.documentElement.dataset.themeMode = mode;
  globalThis.document.documentElement.dataset.theme = resolved;
  globalThis.document.documentElement.style.colorScheme = resolved;
  globalThis.document.documentElement.style.backgroundColor = canvas;
  globalThis.document.querySelector('meta[name="theme-color"]').content = canvas;
})();
