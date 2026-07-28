/** 仅在受保护路由加载 Ant Design 主题，避免匿名入口注入组件样式。 */
import { ConfigProvider, theme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useMemo, type ReactNode } from 'react';
import { useThemeMode } from './ThemeProvider';
import { projectThemes, visualConstants, type ResolvedTheme } from './theme';

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
      colorBorder: tokens.borderStrong,
      colorBorderSecondary: tokens.borderSubtle,
      colorSplit: tokens.borderSubtle,
      colorFillSecondary: tokens.bgSunken,
      colorFillTertiary: tokens.bgSubtle,
      borderRadius: visualConstants.radiusSm,
      borderRadiusLG: visualConstants.radiusLg,
      controlHeight: 36,
      fontFamily: 'var(--ps-font-sans)',
      fontFamilyCode: 'var(--ps-font-mono)',
      motion: !reducedMotion,
      motionDurationFast: visualConstants.motionFast,
      motionDurationMid: visualConstants.motionBase,
      motionDurationSlow: visualConstants.motionSlow,
    },
    components: {
      Layout: { siderBg: tokens.glassSurface, lightSiderBg: tokens.glassSurface, headerBg: tokens.glassSurface, bodyBg: tokens.bgCanvas, triggerBg: tokens.glassSurface, triggerColor: tokens.navText },
      Menu: {
        itemBg: tokens.navBg, subMenuItemBg: tokens.navBg, itemColor: tokens.navText, groupTitleColor: tokens.navTextMuted,
        itemHoverBg: tokens.navHover, itemHoverColor: tokens.navText, itemSelectedBg: tokens.navSelected, itemSelectedColor: tokens.navText,
        itemActiveBg: tokens.navSelected, itemBorderRadius: visualConstants.radiusSm, activeBarBorderWidth: 0,
      },
      Button: { primaryShadow: 'none', primaryColor: tokens.actionOnPrimary, borderRadius: visualConstants.radiusSm },
      Card: { borderRadiusLG: visualConstants.radiusLg, headerBg: tokens.bgSurface, actionsBg: tokens.bgSubtle, extraColor: tokens.textSecondary },
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

export function AntThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme, reducedMotion } = useThemeMode();
  const antTheme = useMemo(() => createAntTheme(resolvedTheme, reducedMotion), [resolvedTheme, reducedMotion]);
  return <ConfigProvider locale={zhCN} theme={antTheme}>{children}</ConfigProvider>;
}
