/** PartSignal 设计 Token：工程纸张、深绿控制台和橙色信号。 */
import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  cssVar: { prefix: 'ps' },
  token: {
    colorPrimary: '#b74320',
    colorInfo: '#1f5a7a',
    colorSuccess: '#216e4e',
    colorWarning: '#9a6700',
    colorError: '#b42318',
    colorText: '#17342e',
    colorTextSecondary: '#475c56',
    colorTextTertiary: '#475c56',
    colorTextDescription: '#475c56',
    colorBgBase: '#fffdf9',
    colorBgLayout: '#f4f0e8',
    colorBgContainer: '#fffdf9',
    colorBorder: '#cfc7ba',
    colorBorderSecondary: '#e2dbd0',
    borderRadius: 6,
    controlHeight: 36,
    fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
  },
  components: {
    Layout: { siderBg: '#0b2d25', headerBg: '#f4f0e8', bodyBg: '#f4f0e8' },
    Menu: { darkItemBg: '#0b2d25', darkSubMenuItemBg: '#0b2d25', darkItemSelectedBg: '#b74320', darkItemHoverBg: '#254a42' },
    Button: { primaryShadow: 'none', borderRadius: 4 },
    Card: { borderRadiusLG: 6 },
    Table: { headerBg: '#f1ece3', headerColor: '#17342e', rowHoverBg: '#faf4eb' },
    Tag: { borderRadiusSM: 2 },
  },
};
