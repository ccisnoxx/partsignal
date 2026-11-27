import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import {
  updateWorkAssignment,
  workAssignmentQueryOptions,
  workbenchAssigneesQueryOptions,
  workbenchKeys,
} from './workbench.api';
import {
  formatWorkbenchDateTime,
  inboxPriorityPresentations,
  type WorkAssignmentTargetType,
  type WorkPriority,
} from './workbench.model';

type WorkAssignmentDetail = components['schemas']['WorkAssignmentDetail'];

const UNASSIGNED_VALUE = '__UNASSIGNED__';
const PRIORITY_VALUES: readonly WorkPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function toLocalDateTimeValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTimeValue(
  localValue: string,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = localValue.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, value: parsed.toISOString() };
}

type WorkAssignmentDialogButtonProps = {
  targetType: WorkAssignmentTargetType;
  targetId: string;
  csrfToken: string | null;
  onUpdated?: () => void;
};

function WorkAssignmentDialogButton({
  targetType,
  targetId,
  csrfToken,
  onUpdated,
}: WorkAssignmentDialogButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        分派与 SLA
      </Button>
      {open && (
        <WorkAssignmentDialog
          csrfToken={csrfToken}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
          targetId={targetId}
          targetType={targetType}
        />
      )}
    </>
  );
}

function WorkAssignmentDialog({
  targetType,
  targetId,
  csrfToken,
  onClose,
  onUpdated,
}: WorkAssignmentDialogButtonProps & { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const detailQuery = useQuery(workAssignmentQueryOptions(targetType, targetId));
  const assigneesQuery = useQuery(workbenchAssigneesQueryOptions());

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>责任人与 SLA 分派</DialogTitle>
          <DialogDescription>
            软归属协作模式：任意活跃管理员或内容工程师均可改派责任人、优先级、截止时间与阻塞说明。
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isPending ? (
          <p className="text-sm text-text-secondary" aria-busy="true">正在读取当前分派与 SLA…</p>
        ) : detailQuery.isError || !detailQuery.data ? (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <p>{detailQuery.error instanceof Error ? detailQuery.error.message : '读取分派信息失败'}</p>
            <div className="flex gap-2">
              <Button onClick={() => void detailQuery.refetch()} size="sm" type="button" variant="outline">
                重试
              </Button>
              <Button onClick={onClose} size="sm" type="button" variant="ghost">关闭</Button>
            </div>
          </div>
        ) : (
          <WorkAssignmentForm
            assignees={assigneesQuery.data?.items ?? []}
            assigneesError={
              assigneesQuery.isError
                ? (assigneesQuery.error instanceof Error
                  ? assigneesQuery.error.message
                  : '读取可分派成员失败')
                : undefined
            }
            assigneesLoading={assigneesQuery.isPending}
            assigneesReady={assigneesQuery.isSuccess}
            csrfToken={csrfToken}
            detail={detailQuery.data}
            key={`${detailQuery.data.target_id}:${detailQuery.data.revision}`}
            onClose={onClose}
            onRefreshDetail={() => void detailQuery.refetch()}
            onRetryAssignees={() => void assigneesQuery.refetch()}
            onSavingChange={setSaving}
            onUpdated={onUpdated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkAssignmentForm({
  assignees,
  assigneesError,
  assigneesLoading,
  assigneesReady,
  csrfToken,
  detail,
  onClose,
  onRefreshDetail,
  onRetryAssignees,
  onSavingChange,
  onUpdated,
}: {
  assignees: components['schemas']['WorkAssigneeOption'][];
  assigneesError?: string;
  assigneesLoading: boolean;
  assigneesReady: boolean;
  csrfToken: string | null;
  detail: WorkAssignmentDetail;
  onClose: () => void;
  onRefreshDetail: () => void;
  onRetryAssignees: () => void;
  onSavingChange: (saving: boolean) => void;
  onUpdated?: () => void;
}) {
  const queryClient = useQueryClient();
  const initialDueLocal = toLocalDateTimeValue(detail.assignment.due_at);
  const [assigneeId, setAssigneeId] = useState(detail.assignment.assignee?.id ?? '');
  const [priority, setPriority] = useState<WorkPriority>(detail.assignment.priority);
  const [dueLocal, setDueLocal] = useState(initialDueLocal);
  const [blockedReason, setBlockedReason] = useState(detail.assignment.blocked_reason ?? '');
  const [error, setError] = useState<string>();

  const saveMutation = useMutation({
    mutationFn: (dueAt: string | null) =>
      updateWorkAssignment(
        detail.target_type,
        detail.target_id,
        {
          expected_revision: detail.revision,
          assignee_id: assigneeId || null,
          priority: detail.priority_mutable ? priority : null,
          due_at: dueAt,
          blocked_reason: blockedReason.trim() || null,
        },
        csrfToken,
      ),
  });

  const assigneeItems = [
    { value: UNASSIGNED_VALUE, label: '未分派' },
    ...assignees.map((user) => ({
      value: user.id,
      label: `${user.display_name}（${user.username}）`,
    })),
  ];
  if (
    detail.assignment.assignee
    && !assigneeItems.some((item) => item.value === detail.assignment.assignee?.id)
  ) {
    assigneeItems.push({
      value: detail.assignment.assignee.id,
      label: assigneesReady
        ? `${detail.assignment.assignee.display_name}（历史保留）`
        : `${detail.assignment.assignee.display_name}（${detail.assignment.assignee.username}）`,
    });
  }

  async function handleSave() {
    setError(undefined);
    if (blockedReason.trim().length > 500) {
      setError('阻塞原因不能超过 500 字');
      return;
    }
    let nextDueAt: string | null;
    if (dueLocal === initialDueLocal) {
      // 未修改日期输入框时保留原始精确时间戳，避免分钟截断破坏 no-op 或悄悄提前 SLA。
      nextDueAt = detail.assignment.due_at;
    } else {
      const parsed = parseLocalDateTimeValue(dueLocal);
      if (!parsed.ok) {
        setError('SLA 截止时间格式无效，请重新选择或清空');
        return;
      }
      nextDueAt = parsed.value;
    }
    onSavingChange(true);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      await saveMutation.mutateAsync(nextDueAt);
      if (!continuation.isCurrent()) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workbenchKeys.assignment(detail.target_type, detail.target_id),
        }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.inboxAll() }),
      ]);
      if (!continuation.isCurrent()) return;
      onUpdated?.();
      onClose();
    } catch (err) {
      if (continuation && !continuation.isCurrent()) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      onSavingChange(false);
    }
  }

  const readOnly = !detail.editable || saveMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>当前版本 r{detail.revision}</span>
        {detail.assignment.is_overdue && <Badge variant="destructive">已超时</Badge>}
        {!detail.editable && <Badge variant="secondary">已终态/归档冻结</Badge>}
      </div>

      {detail.assignment.assigned_by && detail.assignment.assigned_at && (
        <p className="text-xs text-text-muted">
          最近分派：{detail.assignment.assigned_by.display_name} 于{' '}
          {formatWorkbenchDateTime(detail.assignment.assigned_at)}
        </p>
      )}

      {assigneesError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning-foreground" role="alert">
          <span>可分派成员加载失败：{assigneesError}</span>
          <Button onClick={onRetryAssignees} size="sm" type="button" variant="outline">
            重试
          </Button>
        </div>
      )}

      {error && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
          <p>{error}</p>
          <Button onClick={onRefreshDetail} size="sm" type="button" variant="outline">
            刷新最新状态
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="work-assignee-select">
            当前负责人{assigneesLoading ? '（加载中…）' : ''}
          </label>
          <Select
            disabled={readOnly || assigneesLoading || Boolean(assigneesError)}
            items={assigneeItems}
            onValueChange={(next) => setAssigneeId(next === UNASSIGNED_VALUE || !next ? '' : next)}
            value={assigneeId || UNASSIGNED_VALUE}
          >
            <SelectTrigger id="work-assignee-select">
              <SelectValue placeholder="未分派" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {assigneeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="work-priority-select">
            优先级{!detail.priority_mutable ? '（规则冻结）' : ''}
          </label>
          <Select
            disabled={readOnly || !detail.priority_mutable}
            items={PRIORITY_VALUES.map((item) => ({
              value: item,
              label: inboxPriorityPresentations[item].label,
            }))}
            onValueChange={(next) => next && setPriority(next as WorkPriority)}
            value={priority}
          >
            <SelectTrigger id="work-priority-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {PRIORITY_VALUES.map((item) => (
                <SelectItem key={item} value={item}>
                  {inboxPriorityPresentations[item].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="work-due-input">
          SLA 截止时间（可选）
        </label>
        <div className="flex gap-2">
          <Input
            disabled={readOnly}
            id="work-due-input"
            onChange={(event) => setDueLocal(event.target.value)}
            type="datetime-local"
            value={dueLocal}
          />
          {dueLocal && !readOnly && (
            <Button onClick={() => setDueLocal('')} size="sm" type="button" variant="ghost">
              清除
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-text-secondary" htmlFor="work-blocked-reason">
          阻塞原因（可选，最多 500 字）
        </label>
        <Textarea
          disabled={readOnly}
          id="work-blocked-reason"
          maxLength={500}
          onChange={(event) => setBlockedReason(event.target.value)}
          placeholder="例如：等待产品 FAE 补充热阻曲线确认"
          rows={3}
          value={blockedReason}
        />
      </div>

      <DialogFooter>
        <Button disabled={saveMutation.isPending} onClick={onClose} type="button" variant="outline">
          {detail.editable ? '取消' : '关闭'}
        </Button>
        {detail.editable && (
          <Button disabled={saveMutation.isPending} onClick={() => void handleSave()} type="button">
            {saveMutation.isPending ? '保存中…' : '保存分派'}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

export { WorkAssignmentDialogButton };
