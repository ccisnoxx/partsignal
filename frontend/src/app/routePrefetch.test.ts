/** 路由空闲预取只在不会明显浪费弱网流量时启用。 */
import { describe, expect, it } from 'vitest';
import { canIdlePrefetch, navigationLoaderKey } from './routePrefetch';

describe('canIdlePrefetch', () => {
  it('允许普通网络和缺少 Network Information API 的浏览器预取', () => {
    expect(canIdlePrefetch(undefined)).toBe(true);
    expect(canIdlePrefetch({ effectiveType: '3g' })).toBe(true);
    expect(canIdlePrefetch({ effectiveType: '4g', saveData: false })).toBe(true);
  });

  it('禁止 saveData 和 2g 网络执行空闲预取', () => {
    expect(canIdlePrefetch({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(canIdlePrefetch({ effectiveType: '2g' })).toBe(false);
    expect(canIdlePrefetch({ effectiveType: 'slow-2g' })).toBe(false);
  });
});

describe('navigationLoaderKey', () => {
  it('将配置父入口和五个叶子路由映射到各自 loader', () => {
    expect(navigationLoaderKey('/configuration')).toBe('aiChannels');
    expect(navigationLoaderKey('/configuration/ai')).toBe('aiChannels');
    expect(navigationLoaderKey('/configuration/platform-types')).toBe('platformTypes');
    expect(navigationLoaderKey('/configuration/platforms')).toBe('platforms');
    expect(navigationLoaderKey('/configuration/prompts')).toBe('platformPrompts');
    expect(navigationLoaderKey('/configuration/audit')).toBe('auditLog');
  });

  it('渠道详情只映射详情 loader，未知路径不预取', () => {
    expect(navigationLoaderKey('/configuration/ai/channels/channel-1')).toBe('aiChannelDetail');
    expect(navigationLoaderKey('/configuration/unknown')).toBeUndefined();
  });
});
