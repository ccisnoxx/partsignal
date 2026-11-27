import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { statusLabels, type PlanDetail } from './plans.model';
function PlanSelect({ label, value, choices, onChange, disabled, id, describedBy, invalid, required }: {
  label: string; value: string; choices: readonly { value: string; label: string }[]; onChange: (value: string) => void;
  disabled?: boolean; id?: string; describedBy?: string; invalid?: boolean; required?: boolean;
}) {
  return <Select disabled={disabled} items={choices} onValueChange={(next) => { if (next !== null) onChange(next); }} value={value}><SelectTrigger aria-describedby={describedBy} aria-invalid={invalid} aria-label={label} aria-required={required} className="w-full min-w-0" id={id}><SelectValue /></SelectTrigger><SelectContent>{choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent></Select>;
}
function PlanNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <InlineBanner tone={error ? 'danger' : 'info'}>{children}</InlineBanner>;
}
function UnsupportedPlanNotice({ plan }: { plan: PlanDetail }) {
  return <PlanNotice>
    <p>历史CRON未登记到期调度。此历史计划只读，不能编辑、复制、删除或运行，不会自动创建批次（Batch）。</p>
    <p>历史状态：{statusLabels[plan.status]}（{plan.status}）。原配置与历史记录保留；历史状态不表示当前正在调度。</p>
    <p>运行入口不可用（{plan.run_entry.reason_code}）。<Link className="text-interaction-primary underline" to="/geo/runs" search={{ plan_id: plan.id }}>查看批次历史</Link></p>
  </PlanNotice>;
}
function planErrorMessage(error: unknown) { return error instanceof Error ? error.message : '监测计划请求发生未知错误'; }
export { PlanNotice, PlanSelect, UnsupportedPlanNotice, planErrorMessage };
