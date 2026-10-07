import { Button } from '@/design-system/primitives/button';
import { PlanNotice } from './plan-controls';
import { blockerDestination, blockerLabels, warningLabels } from './plan-preview.model';
import type { PlanPreview } from './plans.model';

function PlanPreviewPanel({ preview, onFix }: { preview: PlanPreview; onFix?: (step: number, resourceId?: string | null) => void }) {
  const cost = preview.estimated_cost;
  const counts = [
    ['问题变体数', preview.prompt_count], ['采集配置数', preview.profile_count], ['重复次数', preview.repeat_count], ['总运行数', preview.run_count],
    ['人工待录入数', preview.manual_run_count], ['API 运行数', preview.api_run_count], ['浏览器运行数', preview.browser_run_count], ['未解析运行数', preview.unresolved_run_count],
  ] as const;
  return <section aria-label="服务端运行预览" className="min-w-0 space-y-4">
    <p className="break-words text-sm text-text-secondary">服务端运行矩阵：{preview.prompt_count} × {preview.profile_count} × {preview.repeat_count} = {preview.run_count}。保存时服务端会重新校验当前资源与运行资格。</p>
    <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">{counts.map(([label, count]) => <div className="min-w-0 rounded-lg border border-border-subtle p-3" key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{count}</dd></div>)}</dl>
    <section aria-label="费用估算" className="space-y-2">
      <h3 className="font-medium">费用估算</h3>
      <p className="text-sm">估价覆盖：{{ NONE: '全部未知', PARTIAL: '部分已知', COMPLETE: '全部已知' }[cost.coverage]} · 已知费用运行数 {cost.known_run_count} · 未知费用运行数 {cost.unknown_run_count}</p>
      <p className="text-sm">已知部分小计：{cost.value === null ? '未知或无法合并' : cost.value} · 币种：{cost.currency === null ? '未知或多个币种' : cost.currency}</p>
      {cost.known_costs.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{cost.known_costs.map((item) => <li key={item.currency}>{item.currency} 已知小计：{item.value}</li>)}</ul>}
      <p className="text-xs text-text-muted">未知费用不按零计入。已知小计不能作为全部运行的最终费用；预算不执行预留或扣费。</p>
    </section>
    {preview.blockers.length > 0 ? <PlanNotice error><h3 className="font-medium">运行阻断（{preview.blockers.length}）</h3><ul className="space-y-3">{preview.blockers.map((blocker, index) => {
      const destination = blockerDestination(blocker);
      return <li className="min-w-0 space-y-1" key={`${blocker.code}:${blocker.field}:${blocker.resource_id}:${blocker.related_resource_id}:${index}`}>
        <p>{blockerLabels[blocker.code]} <span className="text-xs">（{blocker.code}）</span></p>
        <p className="break-all text-xs">字段：{blocker.field} · 资源：{blocker.resource_id ?? '无'} · 关联资源：{blocker.related_resource_id ?? '无'}</p>
        <div className="flex flex-wrap items-center gap-3">{onFix && <Button className="min-h-11 sm:min-h-8" onClick={() => onFix(destination.step, blocker.resource_id)} type="button" variant="outline">修正此项：{destination.field}</Button>}{destination.href && <a className="break-words underline underline-offset-2" href={destination.href} rel="noopener noreferrer" target="_blank">查看资源配置（新标签页）</a>}</div>
      </li>;
    })}</ul><p className="text-xs">工程师可查看非敏感摘要；涉及配置权限、系统开关、凭据或批准时，请联系管理员处理。</p></PlanNotice> : <PlanNotice>当前服务端预览没有运行阻断；预览结果不替代保存和状态操作的服务端裁决。</PlanNotice>}
    {preview.warnings.length > 0 && <section aria-label="预览警告" className="space-y-2 rounded-lg border border-warning/30 p-3 text-sm"><h3 className="font-medium">警告（{preview.warnings.length}）</h3><ul className="space-y-2">{preview.warnings.map((warning, index) => <li className="break-words" key={`${warning.code}:${warning.resource_id}:${warning.related_resource_id}:${index}`}><p>{warningLabels[warning.code]}（{warning.code}）</p><p className="break-all text-xs text-text-secondary">字段：{warning.field} · 资源：{warning.resource_id ?? '无'} · 关联资源：{warning.related_resource_id ?? '无'}</p></li>)}</ul></section>}
  </section>;
}
export { PlanPreviewPanel };
