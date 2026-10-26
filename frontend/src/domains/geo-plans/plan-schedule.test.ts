import { describe, expect, it } from 'vitest';
import { formatScheduleTime } from './plan-schedule';

describe('计划时区展示', () => {
  it('按计划时区显示，ICU不支持的合法服务端时区明确保留UTC时间', () => {
    expect(
      formatScheduleTime('2026-10-25T01:00:00Z', 'Asia/Shanghai'),
    ).toContain('09:00:00');
    expect(formatScheduleTime('2026-10-25T09:00:00+08:00', 'Factory')).toBe(
      '2026-10-25T01:00:00.000Z（UTC；浏览器无法显示计划时区）',
    );
  });
});
