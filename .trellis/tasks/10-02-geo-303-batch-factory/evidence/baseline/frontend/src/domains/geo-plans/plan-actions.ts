import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import { actionLabels, assertNever, type PlanAction, type PlanDetail } from './plans.model';
function planPrimary(plan: PlanDetail): PrimaryRowAction | undefined {
  let command: PlanAction;
  switch (plan.primary_task) {
    case 'COMPLETE_CONFIGURATION': command = 'UPDATE'; break;
    case 'ACTIVATE': command = 'ACTIVATE'; break;
    case 'RESUME': command = 'RESUME'; break;
    case 'VIEW_RUNTIME': case 'VIEW_HISTORY': return undefined;
    default: return assertNever(plan.primary_task);
  }
  return { key: command, command, label: command === 'UPDATE' ? '完善配置' : actionLabels[command], enabled: plan.available_actions.includes(command), disabledReason: '服务端当前未提供该动作', intent: 'primary' };
}
function planOverflow(plan: PlanDetail, disabled = false): OverflowRowAction[] {
  const primary = planPrimary(plan);
  const actions = plan.available_actions.flatMap((action): OverflowRowAction[] => {
    if (action === primary?.key) return [];
    switch (action) {
      case 'UPDATE': case 'CREATE_REVISION': case 'PREVIEW': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'secondary' }];
      case 'COPY': case 'ACTIVATE': case 'PAUSE': case 'RESUME': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'secondary', confirmation: 'custom' }];
      case 'ARCHIVE': case 'DELETE': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'danger', confirmation: 'custom' }];
      default: return assertNever(action);
    }
  });
  if (plan.deletion.blockers.length) actions.push({ key: 'VIEW_DELETION_CONDITIONS', command: 'VIEW_DELETION_CONDITIONS', label: '查看删除条件', enabled: !disabled, intent: 'secondary' });
  return actions;
}
function parsePlanCommand(value: string): PlanAction | 'VIEW_DELETION_CONDITIONS' {
  switch (value) { case 'UPDATE': case 'CREATE_REVISION': case 'PREVIEW': case 'ACTIVATE': case 'PAUSE': case 'RESUME': case 'ARCHIVE': case 'COPY': case 'DELETE': case 'VIEW_DELETION_CONDITIONS': return value; default: throw new Error(`计划返回未知命令：${value}`); }
}
export { parsePlanCommand, planOverflow, planPrimary };
