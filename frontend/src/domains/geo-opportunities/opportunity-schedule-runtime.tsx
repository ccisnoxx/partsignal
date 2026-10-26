import { Link } from '@tanstack/react-router';
import { evaluationReason } from './opportunity-evaluation.model';
import { blockedLabels, type ScheduleDetail } from './opportunity-schedule.api';
import { formatTime } from './opportunities.model';

const statusLabels = {
  UNCONFIGURED: '尚未配置',
  DISABLED: '未启用',
  ACTIVE: '已启用',
  PAUSED: '已暂停',
} satisfies Record<ScheduleDetail['status'], string>;
export function ScheduleRuntime({ detail }: { detail: ScheduleDetail }) {
  const window = detail.latest_window;
  const cfg = detail.configuration;
  return (
    <section
      aria-label="自动评估运行进展"
      className="min-w-0 space-y-3 text-sm"
    >
      <p>
        {statusLabels[detail.status]} · 配置 revision {detail.revision} ·
        下一次尝试：
        {detail.next_run_at ? formatTime(detail.next_run_at) : '未安排'}
      </p>
      {cfg && (
        <div className="space-y-1 break-words">
          <p>
            已保存：每 {cfg.interval_hours} 小时 · 回看 {cfg.lookback_days} 天 ·
            固定规则 revision {cfg.rule_set_revision} · 范围 {cfg.scope === 'ALL' ? '全部对象' : '明确筛选对象'}
          </p>
          <p>
            授权管理员 ID：{detail.authorizer_id}
            。保存或启用、恢复会重新绑定当前管理员授权；账号失效不会继续冒用权限。
          </p>
          <p className="break-all">
            Subject：{cfg.subject_ids?.join('、') || '不限'} · Surface：
            {cfg.engine_surface_ids?.join('、') || '不限'} · Profile：
            {cfg.collection_profile_ids?.join('、') || '不限'} · Mode：
            {cfg.collection_modes?.join('、') || '不限'}
          </p>
        </div>
      )}
      {detail.blocked_reason && (
        <p role="status">
          {blockedLabels[detail.blocked_reason]}
          ；请核对开关或通过保存、启用/恢复重新授权。
        </p>
      )}
      {window ? (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p>
            最近窗口：{formatTime(window.scheduled_for)} ·{' '}
            {window.status === 'COMPLETED'
              ? '评估已完成'
              : window.status === 'FAILED'
                ? '评估失败'
                : '已错过'}{' '}
            · 当时配置 revision {window.configuration_revision} / 规则{' '}
            {window.configuration.rule_set_revision}
          </p>
          {window.covered_until && (
            <p>错过区间结束（不含）：{formatTime(window.covered_until)}</p>
          )}
          {window.error_code && <p>原因码：{window.error_code}</p>}
          {window.receipt && (
            <div aria-label="自动评估冻结回执" className="space-y-2">
              <p className="break-all">
                评估 ID：{window.receipt.evaluation_run_id} · 捕获时点：
                {formatTime(window.receipt.as_of)}
              </p>
              <p>
                评估单元：{window.receipt.evaluated_cells} · 新建：
                {window.receipt.created} · 已有复用：
                {window.receipt.existing_reused} · 跳过：
                {window.receipt.skipped}
              </p>
              {window.receipt.unavailable_reasons.length ? (
                <ul className="list-inside list-disc break-words">
                  {window.receipt.unavailable_reasons.map((reason) => (
                    <li key={reason.code}>
                      {evaluationReason(reason.code)} × {reason.count}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>本次没有未生成原因。</p>
              )}
              <Link
                className="inline-flex min-h-11 items-center text-interaction-primary underline"
                to="/geo/opportunities"
                search={{}}
              >
                查看机会结果
              </Link>
            </div>
          )}
        </div>
      ) : (
        <p>尚无已处理的自动评估窗口。</p>
      )}
    </section>
  );
}
