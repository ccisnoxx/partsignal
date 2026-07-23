/** macOS 一体式工作区主题目录，是 Ant Design 与项目 CSS 变量的唯一颜色来源。 */
import { theme, type ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export const THEME_STORAGE_KEY = 'partsignal.theme-mode';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

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
    bgCanvas: '#F5F5F7', bgSurface: '#FFFFFF', bgSubtle: '#F2F2F7', bgRaised: '#FFFFFF', bgSunken: '#E8E8ED', bgOverlay: 'rgba(0,0,0,.48)',
    glassSurface: 'rgba(255,255,255,.82)', glassSurfaceStrong: 'rgba(255,255,255,.92)', glassBorder: 'rgba(29,29,31,.14)', glassBackdrop: 'blur(24px) saturate(160%)',
    navBg: 'transparent', navHover: '#E8E8ED', navSelected: 'rgba(0,102,204,.12)', navText: '#1D1D1F', navTextMuted: '#6E6E73',
    textPrimary: '#1D1D1F', textSecondary: '#515154', textTertiary: '#6E6E73', textDisabled: '#8E8E93', textInverse: '#FFFFFF',
    borderSubtle: '#E5E5EA', borderDefault: '#D1D1D6', borderStrong: '#8E8E93', focusRing: 'rgba(0,102,204,.38)', selectionBg: 'rgba(0,102,204,.16)',
    actionPrimary: '#0066CC', actionPrimaryHover: '#0057B8', actionPrimaryActive: '#004A9F', actionPrimarySoft: 'rgba(0,102,204,.12)', actionOnPrimary: '#FFFFFF', link: '#0057B8',
    success: '#248A3D', successSoft: '#EAF7ED', successText: '#1B6B30', warning: '#B25000', warningSoft: '#FFF4E5', warningText: '#7A3A00',
    danger: '#D70015', dangerSoft: '#FDEBEC', dangerText: '#A20E1A', neutral: '#6E6E73', neutralSoft: '#F2F2F7', neutralText: '#515154',
    codeBg: '#1C1C1E', codeText: '#F5F5F7', codeBorder: '#48484A', codeInlineBg: '#F2F2F7', codeInlineText: '#004A9F', quoteBg: '#F2F7FC', quoteBorder: '#0066CC',
    diffAddBg: '#EAF7ED', diffAddText: '#1B6B30', diffAddBorder: '#63B174', diffDeleteBg: '#FDEBEC', diffDeleteText: '#A20E1A', diffDeleteBorder: '#E06B75',
    chartSeries1: '#0066CC', chartSeries2: '#007A85', chartSeries3: '#248A3D', chartSeries4: '#6E6E73', chartSeries5: '#5E5CE6', chartSeries6: '#B25000',
    geoSeriesBlue: '#3579FF', geoSeriesGreen: '#29B36D', geoSeriesPurple: '#8B5CF6', geoSeriesOrange: '#F59A17', geoSeriesRed: '#FF4D5E', geoSeriesTeal: '#35B9C8',
    chartGrid: '#E5E5EA', chartAxis: '#6E6E73', chartTooltipBg: '#FFFFFF', chartTooltipBorder: '#D1D1D6', chartRail: '#E5E5EA',
    shadowSm: '0 1px 2px rgba(0,0,0,.06)', shadowMd: '0 8px 24px rgba(0,0,0,.10)', shadowLg: '0 20px 60px rgba(0,0,0,.16)',
  },
  dark: {
    bgCanvas: '#0F1012', bgSurface: '#1C1C1E', bgSubtle: '#242426', bgRaised: '#2C2C2E', bgSunken: '#151517', bgOverlay: 'rgba(0,0,0,.68)',
    glassSurface: 'rgba(28,28,30,.82)', glassSurfaceStrong: 'rgba(36,36,38,.92)', glassBorder: 'rgba(255,255,255,.16)', glassBackdrop: 'blur(24px) saturate(160%)',
    navBg: 'transparent', navHover: 'rgba(255,255,255,.08)', navSelected: 'rgba(10,132,255,.18)', navText: '#F5F5F7', navTextMuted: '#A1A1A6',
    textPrimary: '#F5F5F7', textSecondary: '#D1D1D6', textTertiary: '#A1A1A6', textDisabled: '#6E6E73', textInverse: '#1D1D1F',
    borderSubtle: '#38383A', borderDefault: '#48484A', borderStrong: '#636366', focusRing: 'rgba(10,132,255,.5)', selectionBg: 'rgba(10,132,255,.22)',
    actionPrimary: '#0A84FF', actionPrimaryHover: '#409CFF', actionPrimaryActive: '#0071E3', actionPrimarySoft: 'rgba(10,132,255,.18)', actionOnPrimary: '#001B33', link: '#64A8FF',
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
  navBg: '--ps-nav-bg', navHover: '--ps-nav-hover', navSelected: '--ps-nav-selected', navText: '--ps-nav-text', navTextMuted: '--ps-nav-text-muted',
  textPrimary: '--ps-text-primary', textSecondary: '--ps-text-secondary', textTertiary: '--ps-text-tertiary', textDisabled: '--ps-text-disabled', textInverse: '--ps-text-inverse',
  borderSubtle: '--ps-border-subtle', borderDefault: '--ps-border-default', borderStrong: '--ps-border-strong', focusRing: '--ps-focus-ring', selectionBg: '--ps-selection-bg',
  actionPrimary: '--ps-action-primary', actionPrimaryHover: '--ps-action-primary-hover', actionPrimaryActive: '--ps-action-primary-active', actionPrimarySoft: '--ps-action-primary-soft', actionOnPrimary: '--ps-action-on-primary', link: '--ps-link',
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
}

export function createAntTheme(resolvedTheme: ResolvedTheme, reducedMotion: boolean): ThemeConfig {
  const tokens = projectThemes[resolvedTheme];
  return {
    algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: { prefix: 'ps-ant', key: `partsignal-${resolvedTheme}` },
    token: {
      colorPrimary: tokens.actionPrimary,
      colorPrimaryHover: tokens.actionPrimaryHover,
      colorPrimaryActive: tokens.actionPrimaryActive,
      colorInfo: tokens.actionPrimary,
      colorSuccess: tokens.success,
      colorWarning: tokens.warning,
      colorError: tokens.danger,
      colorLink: tokens.link,
      colorLinkHover: tokens.actionPrimaryHover,
      colorLinkActive: tokens.actionPrimaryActive,
      colorText: tokens.textPrimary,
      colorTextSecondary: tokens.textSecondary,
      colorTextTertiary: tokens.textTertiary,
      colorTextQuaternary: tokens.textTertiary,
      colorBgBase: tokens.bgCanvas,
      colorBgLayout: tokens.bgCanvas,
      colorBgContainer: tokens.bgSurface,
      colorBgElevated: tokens.bgRaised,
      colorBgSpotlight: tokens.bgRaised,
      colorBorder: tokens.borderDefault,
      colorBorderSecondary: tokens.borderSubtle,
      colorSplit: tokens.borderSubtle,
      colorFillSecondary: tokens.bgSunken,
      colorFillTertiary: tokens.bgSubtle,
      borderRadius: 8,
      borderRadiusLG: 16,
      controlHeight: 36,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      fontFamilyCode: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace',
      motion: !reducedMotion,
      motionDurationFast: '0.15s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.22s',
    },
    components: {
      Layout: { siderBg: tokens.glassSurface, lightSiderBg: tokens.glassSurface, headerBg: tokens.glassSurface, bodyBg: tokens.bgCanvas, triggerBg: tokens.glassSurface, triggerColor: tokens.navText },
      Menu: {
        itemBg: tokens.navBg, subMenuItemBg: tokens.navBg, itemColor: tokens.navText, groupTitleColor: tokens.navTextMuted,
        itemHoverBg: tokens.navHover, itemHoverColor: tokens.navText, itemSelectedBg: tokens.navSelected, itemSelectedColor: tokens.navText,
        itemActiveBg: tokens.navSelected, itemBorderRadius: 8, activeBarBorderWidth: 0,
      },
      Button: { primaryShadow: 'none', primaryColor: tokens.actionOnPrimary, borderRadius: 8 },
      Card: { borderRadiusLG: 16, headerBg: tokens.bgSurface, actionsBg: tokens.bgSubtle, extraColor: tokens.textSecondary },
      Table: {
        headerBg: tokens.bgSubtle, headerColor: tokens.textSecondary, rowHoverBg: tokens.actionPrimarySoft, rowSelectedBg: tokens.selectionBg,
        rowSelectedHoverBg: tokens.selectionBg, rowExpandedBg: tokens.bgSubtle, borderColor: tokens.borderSubtle, headerSplitColor: tokens.borderDefault,
        cellPaddingBlock: 11, cellPaddingInline: 14,
      },
      Progress: { defaultColor: tokens.chartSeries2, remainingColor: tokens.chartRail },
      Modal: { headerBg: tokens.glassSurfaceStrong, contentBg: tokens.glassSurfaceStrong, footerBg: tokens.glassSurfaceStrong, titleColor: tokens.textPrimary },
      Drawer: { colorBgElevated: tokens.glassSurface, colorBgMask: tokens.bgOverlay },
      Dropdown: { colorBgElevated: tokens.glassSurfaceStrong, controlItemBgHover: tokens.actionPrimarySoft, controlItemBgActive: tokens.actionPrimarySoft },
      Input: { colorBgContainer: tokens.bgSurface, activeBorderColor: tokens.actionPrimary, hoverBorderColor: tokens.actionPrimaryHover, activeShadow: `0 0 0 3px ${tokens.focusRing}` },
      Select: { selectorBg: tokens.bgSurface, optionActiveBg: tokens.actionPrimarySoft, optionSelectedBg: tokens.actionPrimarySoft, activeBorderColor: tokens.actionPrimary, hoverBorderColor: tokens.actionPrimaryHover, activeOutlineColor: tokens.focusRing },
      Tabs: { itemColor: tokens.textSecondary, itemHoverColor: tokens.actionPrimaryHover, itemSelectedColor: tokens.actionPrimary, itemActiveColor: tokens.actionPrimaryActive, inkBarColor: tokens.actionPrimary },
      Tag: { defaultBg: tokens.bgSubtle, defaultColor: tokens.textSecondary },
    },
  };
}
