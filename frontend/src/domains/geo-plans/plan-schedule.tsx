import { Link } from '@tanstack/react-router';
import type { PlanDetail } from './plans.model';

const statuses = {
  CREATED: '已创建批次',
  FAILED: '建批失败',
  MISSED: '已错过窗口',
} as const;
/** Python/PG接受的IANA名称（例如Factory）可能不被浏览器ICU支持。 */
export function formatScheduleTime(value: string, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'long',
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${new Date(value).toISOString()}（UTC；浏览器无法显示计划时区）`;
  }
  return formatter.format(new Date(value));
}
export function PlanSchedule({ plan }: { plan: PlanDetail }) {
  if (!plan.schedule) return null;
  const time = (value: string) => formatScheduleTime(value, plan.timezone);
  const latest = plan.schedule.latest_window;
  return (
    <section
      aria-label="定时运行进展"
      className="min-w-0 space-y-3 rounded-lg border border-border-subtle p-3 text-sm"
    >
      <h3 className="type-section-title">定时运行进展</h3>
      <p>
        下一次运行：
        {plan.schedule.next_run_at
          ? time(plan.schedule.next_run_at)
          : '尚未启用、已暂停或已归档'}{' '}
        · 时区：{plan.timezone}
      </p>
      <p>
        启用后到期创建观测批次；人工采集只生成待录入任务，不会自动去平台提问。恢复从未来窗口开始。每次扫描最多建一批，其余已到期窗口记为错过区间；超过5分钟整段错过，不集中补建。
      </p>
      {latest ? (
        <div className="space-y-2">
          <p>
            最近窗口：{time(latest.scheduled_for)} · {statuses[latest.status]} ·
            配置 revision {latest.plan_revision}
          </p>
          {latest.covered_until && (
            <p>错过区间结束（不含）：{time(latest.covered_until)}</p>
          )}
          {latest.error_code && <p>原因码：{latest.error_code}</p>}
          {latest.batch_id && (
            <Link
              className="inline-flex min-h-11 items-center break-all text-interaction-primary underline"
              to="/geo/runs"
              search={{
                view: 'batches',
                batch_id: latest.batch_id,
                plan_id: plan.id,
              }}
            >
              查看本次批次
            </Link>
          )}
        </div>
      ) : (
        <p>尚无已处理窗口。</p>
      )}
      <Link
        className="inline-flex min-h-11 items-center text-interaction-primary underline"
        to="/geo/runs"
        search={{ plan_id: plan.id, view: 'batches' }}
      >
        查看计划批次历史
      </Link>
    </section>
  );
}
