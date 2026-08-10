import type { OverflowRowAction, PrimaryRowAction } from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';

type ContentTaskDetailTask = components['schemas']['ContentTaskDetailTask'];
type ContentTaskActionState = Pick<
  ContentTaskDetailTask,
  'id' | 'identifier' | 'primary_task' | 'available_actions' | 'deletion' | 'revision'
>;
type ContentTaskPrimaryTask = ContentTaskActionState['primary_task'];
type ContentTaskAvailableAction = ContentTaskActionState['available_actions'][number];

type PrimaryActionOptions = {
  surface: 'list' | 'detail';
  publicationWorkId?: string;
};

function resolveContentTaskPrimaryAction(
  task: ContentTaskActionState,
  options: PrimaryActionOptions = { surface: 'list' },
): PrimaryRowAction {
  const taskId = encodeURIComponent(task.id);
  const detailHref = `/content/tasks/${taskId}`;
  const action: ContentTaskPrimaryTask = task.primary_task;
  switch (action) {
    case 'CREATE_FIRST_DRAFT':
      return primaryLink(action, '创建初稿', `${detailHref}/editor`);
    case 'VIEW_GENERATION_PROGRESS':
      return primaryLink(
        action,
        '查看生成进度',
        options.surface === 'detail' ? '#generation' : detailHref,
      );
    case 'HANDLE_GENERATION_FAILURE':
      return primaryLink(
        action,
        '处理生成失败',
        options.surface === 'detail' ? '#generation' : detailHref,
      );
    case 'EDIT_AND_SUBMIT_REVIEW':
      return primaryLink(action, '编辑并提交审核', `${detailHref}/editor`);
    case 'REVIEW_CONTENT':
      return primaryLink(action, '审核内容', `${detailHref}/review`);
    case 'REVISE_CONTENT':
      return primaryLink(action, '修订内容', `${detailHref}/editor`);
    case 'START_PUBLICATION':
      return primaryLink(action, '开始发布', '/publishing/work');
    case 'CONTINUE_PUBLICATION':
      if (options.surface === 'detail' && !options.publicationWorkId) {
        throw new Error(`Content Task Detail ${task.id} 缺少当前发布工作`);
      }
      return primaryLink(
        action,
        '继续发布',
        options.surface === 'detail'
          ? `/publishing/work/${encodeURIComponent(options.publicationWorkId ?? '')}`
          : detailHref,
      );
    case 'VIEW_FULL_LINEAGE':
      return primaryLink(
        action,
        '查看完整链路',
        options.surface === 'detail' ? '#activity' : detailHref,
      );
    case 'VIEW_CANCELLATION':
      return primaryLink(
        action,
        '查看取消记录',
        options.surface === 'detail' ? '#summary' : detailHref,
      );
    default:
      return assertNever(action);
  }
}

function primaryLink(
  key: ContentTaskPrimaryTask,
  label: string,
  href: string,
): PrimaryRowAction {
  return { key, label, href, intent: 'primary', enabled: true };
}

function resolveContentTaskOverflowActions(
  task: ContentTaskActionState,
  pendingAction?: ContentTaskAvailableAction,
): OverflowRowAction[] {
  const actions: OverflowRowAction[] = task.available_actions.map((action) => {
    const pending = action === pendingAction;
    switch (action) {
      case 'CANCEL':
        return {
          ...commandAction(
            action,
            pending ? '正在取消…' : '取消任务',
            'cancel-content-task',
            pending,
          ),
          confirmation: 'custom' as const,
        };
      case 'DELETE':
        if (!task.deletion || task.deletion.blockers.length > 0) {
          throw new Error(`Content Tasks API 为 ${task.id} 返回了矛盾的 DELETE projection`);
        }
        return {
          key: action,
          label: pending ? '正在删除…' : '删除任务',
          intent: 'danger' as const,
          enabled: !pending,
          command: 'delete-content-task',
          disabledReason: pending ? '删除请求正在处理' : undefined,
          confirmation: {
            title: `确认删除任务“${task.identifier}”`,
            description: '将删除未成功发布的完整内部任务聚合；服务端会在执行时重新检查全部删除条件。',
            confirmLabel: '确认删除',
          },
        };
      case 'ARCHIVE':
        return {
          ...commandAction(action, pending ? '正在归档…' : '归档任务', 'archive-content-task', pending),
          confirmation: {
            title: `归档任务“${task.identifier}”`,
            description: '任务将移出当前任务视图，之后可以从已归档视图恢复。',
            confirmLabel: '确认归档',
            intent: 'default' as const,
          },
        };
      case 'RESTORE':
        return {
          ...commandAction(action, pending ? '正在恢复…' : '恢复任务', 'restore-content-task', pending),
          confirmation: {
            title: `恢复任务“${task.identifier}”`,
            description: '任务将恢复到当前任务视图，业务状态不会改变。',
            confirmLabel: '确认恢复',
            intent: 'default' as const,
          },
        };
      case 'PERMANENT_DELETE':
        return {
          key: action,
          label: pending ? '正在永久删除…' : '永久删除',
          intent: 'danger' as const,
          enabled: !pending,
          command: 'permanently-delete-content-task',
          disabledReason: pending ? '永久删除请求正在处理' : undefined,
          confirmation: 'custom' as const,
        };
      case 'CREATE_GENERATION_JOB':
        return linkAction(action, '使用 AI 创建初稿', `/content/tasks/${encodeURIComponent(task.id)}/editor`);
      case 'CREATE_MANUAL_VERSION':
        return linkAction(action, '手动创建初稿', `/content/tasks/${encodeURIComponent(task.id)}/editor`);
      default:
        return assertNever(action);
    }
  });
  if (task.deletion?.blockers.length && !task.available_actions.includes('DELETE')) {
    actions.push({
      key: 'VIEW_DELETE_CONDITIONS',
      label: '查看删除条件',
      intent: 'secondary',
      enabled: true,
      command: 'view-delete-conditions',
    });
  }
  return actions;
}

function commandAction(
  key: ContentTaskAvailableAction,
  label: string,
  command: string,
  pending: boolean,
): OverflowRowAction {
  return {
    key,
    label,
    intent: 'secondary',
    enabled: !pending,
    command,
    disabledReason: pending ? '请求正在处理' : undefined,
  };
}

function linkAction(
  key: ContentTaskAvailableAction,
  label: string,
  href: string,
): OverflowRowAction {
  return { key, label, intent: 'secondary', enabled: true, href };
}

function assertNever(value: never): never {
  throw new Error(`Content Tasks 收到未处理的合同 token：${String(value)}`);
}

export { resolveContentTaskOverflowActions, resolveContentTaskPrimaryAction };
export type { ContentTaskActionState, ContentTaskAvailableAction };
