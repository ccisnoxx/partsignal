/** Midnight Signal 主题目录，是 Ant Design 与项目 CSS 变量的唯一颜色来源。 */
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
  dataCyan: string;
  dataCyanStrong: string;
  dataCyanSoft: string;
  dataOnCyan: string;
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
  chartGrid: string;
  chartAxis: string;
  chartTooltipBg: string;
  chartTooltipBorder: string;
  chartRail: string;
  auroraBlue: string;
  auroraCyan: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export const projectThemes: Record<ResolvedTheme, ProjectThemeTokens> = {
  light: {
    bgCanvas: '#F3F6FA', bgSurface: '#FFFFFF', bgSubtle: '#F8FAFC', bgRaised: '#FFFFFF', bgSunken: '#EAF0F6', bgOverlay: 'rgba(15,23,42,.48)',
    navBg: '#EAF0F6', navHover: '#DCE8F5', navSelected: '#D9E9FF', navText: '#334155', navTextMuted: '#475569',
    textPrimary: '#172033', textSecondary: '#475569', textTertiary: '#52627A', textDisabled: '#7B8BA3', textInverse: '#F8FAFC',
    borderSubtle: '#E2E8F0', borderDefault: '#CBD5E1', borderStrong: '#94A3B8', focusRing: 'rgba(6,182,212,.38)', selectionBg: '#D9E9FF',
    actionPrimary: '#2563EB', actionPrimaryHover: '#1D4ED8', actionPrimaryActive: '#1E40AF', actionPrimarySoft: '#DBEAFE', actionOnPrimary: '#FFFFFF', link: '#1D4ED8',
    dataCyan: '#0891B2', dataCyanStrong: '#0E7490', dataCyanSoft: '#CFFAFE', dataOnCyan: '#083344',
    success: '#15803D', successSoft: '#DCFCE7', successText: '#14532D', warning: '#D97706', warningSoft: '#FEF3C7', warningText: '#78350F',
    danger: '#DC2626', dangerSoft: '#FEE2E2', dangerText: '#7F1D1D', neutral: '#64748B', neutralSoft: '#F1F5F9', neutralText: '#334155',
    codeBg: '#0F1E33', codeText: '#E6EDF7', codeBorder: '#263B55', codeInlineBg: '#EAF0F6', codeInlineText: '#0E7490', quoteBg: '#F0F7FA', quoteBorder: '#0891B2',
    diffAddBg: '#E8F7ED', diffAddText: '#14532D', diffAddBorder: '#86C99A', diffDeleteBg: '#FDECEC', diffDeleteText: '#7F1D1D', diffDeleteBorder: '#E7A2A2',
    chartSeries1: '#2563EB', chartSeries2: '#0891B2', chartSeries3: '#0F766E', chartSeries4: '#475569', chartSeries5: '#0284C7', chartSeries6: '#334155',
    chartGrid: '#DCE5EF', chartAxis: '#64748B', chartTooltipBg: '#FFFFFF', chartTooltipBorder: '#CBD5E1', chartRail: '#E2E8F0',
    auroraBlue: 'rgba(37,99,235,.10)', auroraCyan: 'rgba(8,145,178,.09)',
    shadowSm: '0 1px 2px rgba(15,23,42,.06)', shadowMd: '0 8px 24px rgba(15,23,42,.08)', shadowLg: '0 20px 60px rgba(15,23,42,.14)',
  },
  dark: {
    bgCanvas: '#081426', bgSurface: '#0D1B2E', bgSubtle: '#102138', bgRaised: '#142842', bgSunken: '#07111F', bgOverlay: 'rgba(2,6,23,.72)',
    navBg: '#0A1729', navHover: '#122842', navSelected: '#17375A', navText: '#D9E5F3', navTextMuted: '#8EA0B8',
    textPrimary: '#E6EDF7', textSecondary: '#B4C0D1', textTertiary: '#8A9AB0', textDisabled: '#5F7086', textInverse: '#07111F',
    borderSubtle: '#1B2E46', borderDefault: '#2C405A', borderStrong: '#49617D', focusRing: 'rgba(34,211,238,.45)', selectionBg: '#17375A',
    actionPrimary: '#60A5FA', actionPrimaryHover: '#93C5FD', actionPrimaryActive: '#3B82F6', actionPrimarySoft: 'rgba(59,130,246,.18)', actionOnPrimary: '#07111F', link: '#60A5FA',
    dataCyan: '#22D3EE', dataCyanStrong: '#67E8F9', dataCyanSoft: 'rgba(34,211,238,.14)', dataOnCyan: '#CFFAFE',
    success: '#4ADE80', successSoft: 'rgba(34,197,94,.14)', successText: '#86EFAC', warning: '#F59E0B', warningSoft: 'rgba(245,158,11,.15)', warningText: '#FCD34D',
    danger: '#F87171', dangerSoft: 'rgba(248,113,113,.14)', dangerText: '#FCA5A5', neutral: '#94A3B8', neutralSoft: '#1E293B', neutralText: '#CBD5E1',
    codeBg: '#06101F', codeText: '#D7E3F4', codeBorder: '#21364F', codeInlineBg: '#162A44', codeInlineText: '#67E8F9', quoteBg: '#102A3B', quoteBorder: '#22D3EE',
    diffAddBg: 'rgba(34,197,94,.14)', diffAddText: '#86EFAC', diffAddBorder: '#22C55E', diffDeleteBg: 'rgba(248,113,113,.14)', diffDeleteText: '#FCA5A5', diffDeleteBorder: '#EF4444',
    chartSeries1: '#60A5FA', chartSeries2: '#22D3EE', chartSeries3: '#2DD4BF', chartSeries4: '#94A3B8', chartSeries5: '#38BDF8', chartSeries6: '#CBD5E1',
    chartGrid: '#243852', chartAxis: '#8A9AB0', chartTooltipBg: '#142842', chartTooltipBorder: '#49617D', chartRail: '#243852',
    auroraBlue: 'rgba(59,130,246,.16)', auroraCyan: 'rgba(34,211,238,.10)',
    shadowSm: '0 1px 2px rgba(0,0,0,.24)', shadowMd: '0 10px 28px rgba(0,0,0,.28)', shadowLg: '0 24px 72px rgba(0,0,0,.36)',
  },
};

const cssVariableNames: Record<keyof ProjectThemeTokens, `--ps-${string}`> = {
  bgCanvas: '--ps-bg-canvas', bgSurface: '--ps-bg-surface', bgSubtle: '--ps-bg-subtle', bgRaised: '--ps-bg-raised', bgSunken: '--ps-bg-sunken', bgOverlay: '--ps-bg-overlay',
  navBg: '--ps-nav-bg', navHover: '--ps-nav-hover', navSelected: '--ps-nav-selected', navText: '--ps-nav-text', navTextMuted: '--ps-nav-text-muted',
  textPrimary: '--ps-text-primary', textSecondary: '--ps-text-secondary', textTertiary: '--ps-text-tertiary', textDisabled: '--ps-text-disabled', textInverse: '--ps-text-inverse',
  borderSubtle: '--ps-border-subtle', borderDefault: '--ps-border-default', borderStrong: '--ps-border-strong', focusRing: '--ps-focus-ring', selectionBg: '--ps-selection-bg',
  actionPrimary: '--ps-action-primary', actionPrimaryHover: '--ps-action-primary-hover', actionPrimaryActive: '--ps-action-primary-active', actionPrimarySoft: '--ps-action-primary-soft', actionOnPrimary: '--ps-action-on-primary', link: '--ps-link',
  dataCyan: '--ps-data-cyan', dataCyanStrong: '--ps-data-cyan-strong', dataCyanSoft: '--ps-data-cyan-soft', dataOnCyan: '--ps-data-on-cyan',
  success: '--ps-success', successSoft: '--ps-success-soft', successText: '--ps-success-text', warning: '--ps-warning', warningSoft: '--ps-warning-soft', warningText: '--ps-warning-text',
  danger: '--ps-danger', dangerSoft: '--ps-danger-soft', dangerText: '--ps-danger-text', neutral: '--ps-neutral', neutralSoft: '--ps-neutral-soft', neutralText: '--ps-neutral-text',
  codeBg: '--ps-code-bg', codeText: '--ps-code-text', codeBorder: '--ps-code-border', codeInlineBg: '--ps-code-inline-bg', codeInlineText: '--ps-code-inline-text', quoteBg: '--ps-quote-bg', quoteBorder: '--ps-quote-border',
  diffAddBg: '--ps-diff-add-bg', diffAddText: '--ps-diff-add-text', diffAddBorder: '--ps-diff-add-border', diffDeleteBg: '--ps-diff-delete-bg', diffDeleteText: '--ps-diff-delete-text', diffDeleteBorder: '--ps-diff-delete-border',
  chartSeries1: '--ps-chart-series-1', chartSeries2: '--ps-chart-series-2', chartSeries3: '--ps-chart-series-3', chartSeries4: '--ps-chart-series-4', chartSeries5: '--ps-chart-series-5', chartSeries6: '--ps-chart-series-6',
  chartGrid: '--ps-chart-grid', chartAxis: '--ps-chart-axis', chartTooltipBg: '--ps-chart-tooltip-bg', chartTooltipBorder: '--ps-chart-tooltip-border', chartRail: '--ps-chart-rail',
  auroraBlue: '--ps-aurora-blue', auroraCyan: '--ps-aurora-cyan', shadowSm: '--ps-shadow-sm', shadowMd: '--ps-shadow-md', shadowLg: '--ps-shadow-lg',
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
      borderRadiusLG: 12,
      controlHeight: 36,
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
      fontFamilyCode: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace',
      motion: !reducedMotion,
      motionDurationFast: '0.15s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.28s',
    },
    components: {
      Layout: { siderBg: tokens.navBg, lightSiderBg: tokens.navBg, headerBg: tokens.bgSurface, bodyBg: tokens.bgCanvas, triggerBg: tokens.navBg, triggerColor: tokens.navText },
      Menu: {
        itemBg: tokens.navBg, subMenuItemBg: tokens.navBg, itemColor: tokens.navText, groupTitleColor: tokens.navTextMuted,
        itemHoverBg: tokens.navHover, itemHoverColor: tokens.navText, itemSelectedBg: tokens.navSelected, itemSelectedColor: tokens.navText,
        itemActiveBg: tokens.navSelected, itemBorderRadius: 8, activeBarBorderWidth: 0,
      },
      Button: { primaryShadow: 'none', primaryColor: tokens.actionOnPrimary, borderRadius: 8 },
      Card: { borderRadiusLG: 12, headerBg: tokens.bgSurface, actionsBg: tokens.bgSubtle, extraColor: tokens.textSecondary },
      Table: {
        headerBg: tokens.bgSubtle, headerColor: tokens.textSecondary, rowHoverBg: tokens.actionPrimarySoft, rowSelectedBg: tokens.selectionBg,
        rowSelectedHoverBg: tokens.selectionBg, rowExpandedBg: tokens.bgSubtle, borderColor: tokens.borderSubtle, headerSplitColor: tokens.borderDefault,
        cellPaddingBlock: 11, cellPaddingInline: 14,
      },
      Progress: { defaultColor: tokens.dataCyan, remainingColor: tokens.chartRail },
      Modal: { headerBg: tokens.bgRaised, contentBg: tokens.bgRaised, footerBg: tokens.bgRaised, titleColor: tokens.textPrimary },
    },
  };
}
