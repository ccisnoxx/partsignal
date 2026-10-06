import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import { actionLabels, assertNever, type PromptVariant } from './questions.model';

type QuestionCommand = PromptVariant['available_actions'][number];
function questionPrimary(variant: PromptVariant): PrimaryRowAction | undefined {
  switch (variant.primary_task) {
    case 'EDIT': return { key: 'UPDATE', command: 'UPDATE', label: '编辑', intent: 'primary', enabled: true };
    case 'VIEW_DETAILS': return undefined;
    default: return assertNever(variant.primary_task);
  }
}
function questionOverflow(variant: PromptVariant, disabled = false): OverflowRowAction[] {
  const actions = variant.available_actions.flatMap((action): OverflowRowAction[] => {
    if (action === 'UPDATE' && variant.primary_task === 'EDIT') return [];
    switch (action) {
      case 'UPDATE': case 'COPY': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'secondary' }];
      case 'ENABLE': case 'DISABLE': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'secondary', confirmation: 'custom' }];
      case 'DELETE': return [{ key: action, command: action, label: actionLabels[action], enabled: !disabled, intent: 'danger', confirmation: 'custom' }];
      default: return assertNever(action);
    }
  });
  if (variant.deletion.blockers.length) actions.push({ key: 'VIEW_DELETION_CONDITIONS', command: 'VIEW_DELETION_CONDITIONS', label: '查看删除条件', enabled: true, intent: 'secondary' });
  return actions;
}
function parseQuestionCommand(value: string): QuestionCommand {
  switch (value) { case 'UPDATE': case 'ENABLE': case 'DISABLE': case 'DELETE': case 'COPY': return value; default: throw new Error(`问题库返回未知命令：${value}`); }
}
export { parseQuestionCommand, questionOverflow, questionPrimary };
export type { QuestionCommand };
