/** macOS 一体式工作区主题目录，是 Ant Design 与项目 CSS 变量的唯一颜色来源。 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export const THEME_STORAGE_KEY = 'partsignal.theme-mode';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export const visualConstants = {
  fontSans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontMono: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace',
  radiusCompact: 6,
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  motionFast: '160ms',
  motionBase: '200ms',
  motionSlow: '240ms',
  easeEnter: 'cubic-bezier(.2, .8, .2, 1)',
  easeExit: 'cubic-bezier(.4, 0, 1, 1)',
} as const;

const visualCssVariables = {
  '--ps-font-sans': visualConstants.fontSans,
  '--ps-font-mono': visualConstants.fontMono,
  '--ps-radius-compact': `${visualConstants.radiusCompact}px`,
  '--ps-radius-sm': `${visualConstants.radiusSm}px`,
  '--ps-radius-md': `${visualConstants.radiusMd}px`,
  '--ps-radius-lg': `${visualConstants.radiusLg}px`,
  '--ps-motion-fast': visualConstants.motionFast,
  '--ps-motion-base': visualConstants.motionBase,
  '--ps-motion-slow': visualConstants.motionSlow,
  '--ps-ease-enter': visualConstants.easeEnter,
  '--ps-ease-exit': visualConstants.easeExit,
} as const;

export interface ProjectThemeTokens {
  bgCanvas: string;
  bgSurface: string;
  bgSubtle: string;
  bgRaised: string;
  bgSunken: string;
  bgOverlay: string;
  glassSurface: string;
  glassSurfaceStrong: string;
  glassBorder: string;
  glassBackdrop: string;
  ambientBlue: string;
  ambientPurple: string;
  ambientPink: string;
  navBg: string;
  navHover: string;
  navSelected: string;
  navText: string;
  navTextMuted: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  textInverse: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  focusRing: string;
  selectionBg: string;
  actionPrimary: string;
  actionPrimaryEnd: string;
  actionPrimaryHover: string;
  actionPrimaryActive: string;
  actionPrimarySoft: string;
  actionOnPrimary: string;
  link: string;
  success: string;
  successSoft: string;
  successText: string;
  warning: string;
  warningSoft: string;
  warningText: string;
  danger: string;
  dangerSoft: string;
  dangerText: string;
  neutral: string;
  neutralSoft: string;
  neutralText: string;
  codeBg: string;
  codeText: string;
  codeBorder: string;
  codeInlineBg: string;
  codeInlineText: string;
  quoteBg: string;
  quoteBorder: string;
  diffAddBg: string;
  diffAddText: string;
  diffAddBorder: string;
  diffDeleteBg: string;
  diffDeleteText: string;
  diffDeleteBorder: string;
  chartSeries1: string;
  chartSeries2: string;
  chartSeries3: string;
  chartSeries4: string;
  chartSeries5: string;
  chartSeries6: string;
  geoSeriesBlue: string;
  geoSeriesGreen: string;
  geoSeriesPurple: string;
  geoSeriesOrange: string;
  geoSeriesRed: string;
  geoSeriesTeal: string;
  chartGrid: string;
  chartAxis: string;
  chartTooltipBg: string;
  chartTooltipBorder: string;
  chartRail: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export const projectThemes: Record<ResolvedTheme, ProjectThemeTokens> = {
  light: {
    bgCanvas: '#F4F7FC', bgSurface: '#FFFFFF', bgSubtle: '#F7F9FD', bgRaised: '#FFFFFF', bgSunken: '#EDF2F8', bgOverlay: 'rgba(23,32,51,.48)',
    glassSurface: 'rgba(255,255,255,.74)', glassSurfaceStrong: 'rgba(255,255,255,.90)', glassBorder: 'rgba(102,122,160,.16)', glassBackdrop: 'blur(24px) saturate(150%)',
    ambientBlue: 'rgba(92,145,255,.16)', ambientPurple: 'rgba(132,102,255,.12)', ambientPink: 'rgba(255,151,178,.10)',
    navBg: 'transparent', navHover: '#EDF2F8', navSelected: 'rgba(49,92,245,.11)', navText: '#172033', navTextMuted: '#68758C',
    textPrimary: '#172033', textSecondary: '#526079', textTertiary: '#68758C', textDisabled: '#8A96A9', textInverse: '#FFFFFF',
    borderSubtle: '#E5EAF2', borderDefault: '#D7DFEB', borderStrong: '#8795AA', focusRing: 'rgba(49,92,245,.36)', selectionBg: 'rgba(49,92,245,.16)',
    actionPrimary: '#315CF5', actionPrimaryEnd: '#5A3FF0', actionPrimaryHover: '#244CE0', actionPrimaryActive: '#1E40C6', actionPrimarySoft: 'rgba(49,92,245,.11)', actionOnPrimary: '#FFFFFF', link: '#315CF5',
    success: '#248A3D', successSoft: '#EAF7ED', successText: '#1B6B30', warning: '#B25000', warningSoft: '#FFF4E5', warningText: '#7A3A00',
    danger: '#D70015', dangerSoft: '#FDEBEC', dangerText: '#A20E1A', neutral: '#6E6E73', neutralSoft: '#F2F2F7', neutralText: '#515154',
    codeBg: '#172033', codeText: '#F7F9FD', codeBorder: '#526079', codeInlineBg: '#EDF2F8', codeInlineText: '#1E40C6', quoteBg: '#F2F6FF', quoteBorder: '#315CF5',
    diffAddBg: '#EAF7ED', diffAddText: '#1B6B30', diffAddBorder: '#63B174', diffDeleteBg: '#FDEBEC', diffDeleteText: '#A20E1A', diffDeleteBorder: '#E06B75',
    chartSeries1: '#315CF5', chartSeries2: '#168892', chartSeries3: '#248A3D', chartSeries4: '#68758C', chartSeries5: '#5A3FF0', chartSeries6: '#B25000',
    geoSeriesBlue: '#3579FF', geoSeriesGreen: '#29B36D', geoSeriesPurple: '#8B5CF6', geoSeriesOrange: '#F59A17', geoSeriesRed: '#FF4D5E', geoSeriesTeal: '#35B9C8',
    chartGrid: '#E5EAF2', chartAxis: '#68758C', chartTooltipBg: '#FFFFFF', chartTooltipBorder: '#D7DFEB', chartRail: '#E5EAF2',
    shadowSm: '0 1px 2px rgba(32,51,84,.06)', shadowMd: '0 8px 24px rgba(32,51,84,.10)', shadowLg: '0 20px 60px rgba(32,51,84,.14)',
  },
  dark: {
    bgCanvas: '#111827', bgSurface: '#192235', bgSubtle: '#202B40', bgRaised: '#273249', bgSunken: '#0D1524', bgOverlay: 'rgba(4,8,16,.72)',
    glassSurface: 'rgba(25,34,53,.78)', glassSurfaceStrong: 'rgba(32,43,64,.92)', glassBorder: 'rgba(159,178,213,.18)', glassBackdrop: 'blur(24px) saturate(145%)',
    ambientBlue: 'rgba(73,122,255,.14)', ambientPurple: 'rgba(139,108,255,.12)', ambientPink: 'rgba(255,126,164,.08)',
    navBg: 'transparent', navHover: 'rgba(255,255,255,.08)', navSelected: 'rgba(118,146,255,.18)', navText: '#F3F6FC', navTextMuted: '#A9B5C9',
    textPrimary: '#F3F6FC', textSecondary: '#CBD4E4', textTertiary: '#A9B5C9', textDisabled: '#748199', textInverse: '#111827',
    borderSubtle: '#344158', borderDefault: '#4B5A74', borderStrong: '#7D8DA8', focusRing: 'rgba(118,146,255,.52)', selectionBg: 'rgba(118,146,255,.24)',
    actionPrimary: '#7692FF', actionPrimaryEnd: '#9A7AFF', actionPrimaryHover: '#91A6FF', actionPrimaryActive: '#5E7DF4', actionPrimarySoft: 'rgba(118,146,255,.18)', actionOnPrimary: '#111827', link: '#91A6FF',
    success: '#30D158', successSoft: 'rgba(48,209,88,.16)', successText: '#6EE98B', warning: '#FFD60A', warningSoft: 'rgba(255,214,10,.16)', warningText: '#FFE45E',
    danger: '#FF453A', dangerSoft: 'rgba(255,69,58,.16)', dangerText: '#FF6961', neutral: '#A1A1A6', neutralSoft: '#2C2C2E', neutralText: '#D1D1D6',
    codeBg: '#111214', codeText: '#F5F5F7', codeBorder: '#48484A', codeInlineBg: '#2C2C2E', codeInlineText: '#64A8FF', quoteBg: '#24282D', quoteBorder: '#0A84FF',
    diffAddBg: 'rgba(48,209,88,.16)', diffAddText: '#6EE98B', diffAddBorder: '#30D158', diffDeleteBg: 'rgba(255,69,58,.16)', diffDeleteText: '#FF6961', diffDeleteBorder: '#FF453A',
    chartSeries1: '#0A84FF', chartSeries2: '#64D2FF', chartSeries3: '#30D158', chartSeries4: '#A1A1A6', chartSeries5: '#BF5AF2', chartSeries6: '#FFD60A',
    geoSeriesBlue: '#64A8FF', geoSeriesGreen: '#30D158', geoSeriesPurple: '#BF5AF2', geoSeriesOrange: '#FF9F0A', geoSeriesRed: '#FF453A', geoSeriesTeal: '#64D2FF',
    chartGrid: '#38383A', chartAxis: '#A1A1A6', chartTooltipBg: '#2C2C2E', chartTooltipBorder: '#636366', chartRail: '#38383A',
    shadowSm: '0 1px 2px rgba(0,0,0,.40)', shadowMd: '0 10px 28px rgba(0,0,0,.44)', shadowLg: '0 24px 72px rgba(0,0,0,.52)',
  },
};

const cssVariableNames: Record<keyof ProjectThemeTokens, `--ps-${string}`> = {
  bgCanvas: '--ps-bg-canvas', bgSurface: '--ps-bg-surface', bgSubtle: '--ps-bg-subtle', bgRaised: '--ps-bg-raised', bgSunken: '--ps-bg-sunken', bgOverlay: '--ps-bg-overlay',
  glassSurface: '--ps-glass-surface', glassSurfaceStrong: '--ps-glass-surface-strong', glassBorder: '--ps-glass-border', glassBackdrop: '--ps-glass-backdrop',
  ambientBlue: '--ps-ambient-blue', ambientPurple: '--ps-ambient-purple', ambientPink: '--ps-ambient-pink',
  navBg: '--ps-nav-bg', navHover: '--ps-nav-hover', navSelected: '--ps-nav-selected', navText: '--ps-nav-text', navTextMuted: '--ps-nav-text-muted',
  textPrimary: '--ps-text-primary', textSecondary: '--ps-text-secondary', textTertiary: '--ps-text-tertiary', textDisabled: '--ps-text-disabled', textInverse: '--ps-text-inverse',
  borderSubtle: '--ps-border-subtle', borderDefault: '--ps-border-default', borderStrong: '--ps-border-strong', focusRing: '--ps-focus-ring', selectionBg: '--ps-selection-bg',
  actionPrimary: '--ps-action-primary', actionPrimaryEnd: '--ps-action-primary-end', actionPrimaryHover: '--ps-action-primary-hover', actionPrimaryActive: '--ps-action-primary-active', actionPrimarySoft: '--ps-action-primary-soft', actionOnPrimary: '--ps-action-on-primary', link: '--ps-link',
  success: '--ps-success', successSoft: '--ps-success-soft', successText: '--ps-success-text', warning: '--ps-warning', warningSoft: '--ps-warning-soft', warningText: '--ps-warning-text',
  danger: '--ps-danger', dangerSoft: '--ps-danger-soft', dangerText: '--ps-danger-text', neutral: '--ps-neutral', neutralSoft: '--ps-neutral-soft', neutralText: '--ps-neutral-text',
  codeBg: '--ps-code-bg', codeText: '--ps-code-text', codeBorder: '--ps-code-border', codeInlineBg: '--ps-code-inline-bg', codeInlineText: '--ps-code-inline-text', quoteBg: '--ps-quote-bg', quoteBorder: '--ps-quote-border',
  diffAddBg: '--ps-diff-add-bg', diffAddText: '--ps-diff-add-text', diffAddBorder: '--ps-diff-add-border', diffDeleteBg: '--ps-diff-delete-bg', diffDeleteText: '--ps-diff-delete-text', diffDeleteBorder: '--ps-diff-delete-border',
  chartSeries1: '--ps-chart-series-1', chartSeries2: '--ps-chart-series-2', chartSeries3: '--ps-chart-series-3', chartSeries4: '--ps-chart-series-4', chartSeries5: '--ps-chart-series-5', chartSeries6: '--ps-chart-series-6',
  geoSeriesBlue: '--ps-geo-series-blue', geoSeriesGreen: '--ps-geo-series-green', geoSeriesPurple: '--ps-geo-series-purple', geoSeriesOrange: '--ps-geo-series-orange', geoSeriesRed: '--ps-geo-series-red', geoSeriesTeal: '--ps-geo-series-teal',
  chartGrid: '--ps-chart-grid', chartAxis: '--ps-chart-axis', chartTooltipBg: '--ps-chart-tooltip-bg', chartTooltipBorder: '--ps-chart-tooltip-border', chartRail: '--ps-chart-rail',
  shadowSm: '--ps-shadow-sm', shadowMd: '--ps-shadow-md', shadowLg: '--ps-shadow-lg',
};

export function applyProjectTheme(root: HTMLElement, resolvedTheme: ResolvedTheme) {
  const tokens = projectThemes[resolvedTheme];
  (Object.keys(cssVariableNames) as (keyof ProjectThemeTokens)[]).forEach((key) => {
    root.style.setProperty(cssVariableNames[key], tokens[key]);
  });
  Object.entries(visualCssVariables).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}
