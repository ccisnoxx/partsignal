import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import {
  createPublishedContentRepairTask,
  mapPublicationError,
  publishedContentRepairContextQueryOptions,
  resolvePublishedContentIssue,
  type PublicationStartErrorMapping,
} from './publication.api';
import {
  repairIssueFormSchema,
  resolveIssueFormSchema,
  type PublishedContentIssueWorkspaceContext,
} from './published-content-issue.model';

type IssueCommand = 'CREATE_REPAIR_TASK' | 'RESOLVE';
type AcceptedCommand =
  | { action: 'CREATE_REPAIR_TASK'; taskId: string }
  | { action: 'RESOLVE'; outcome: 'RESTORED' | 'RETIRED' };

type PublishedContentIssueWorkspaceActionsProps = {
  context: PublishedContentIssueWorkspaceContext;
  csrfToken: string | null;
  onCanonicalChange: (
    continuation: PrincipalContinuation,
    repairTaskId?: string,
  ) => Promise<PublishedContentIssueWorkspaceContext | undefined>;
  onReload: () => Promise<PublishedContentIssueWorkspaceContext>;
};

function PublishedContentIssueWorkspaceActions({
  context,
  csrfToken,
  onCanonicalChange,
  onReload,
}: PublishedContentIssueWorkspaceActionsProps) {
  const queryClient = useQueryClient();
  const [openAction, setOpenAction] = useState<IssueCommand>();
  const [factVersionId, setFactVersionId] = useState('');
  const [outcome, setOutcome] = useState<'RESTORED' | 'RETIRED'>('RESTORED');
  const [comment, setComment] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const [contextStale, setContextStale] = useState(false);
  const [draftAction, setDraftAction] = useState<IssueCommand>();
  const [draftSnapshot, setDraftSnapshot] = useState<string>();
  const [acceptedCommand, setAcceptedCommand] = useState<AcceptedCommand>();
  const [operationPending, setOperationPending] = useState(false);
  const operationInFlightRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const repairOptions = publishedContentRepairContextQueryOptions(context.issue.id);
  const repair = useQuery({ ...repairOptions, enabled: openAction === 'CREATE_REPAIR_TASK' });
  const mutation = useMutation({
    mutationFn: async (command: |
      { action: 'CREATE_REPAIR_TASK'; factVersionId: string; revision: number }
      | { action: 'RESOLVE'; outcome: 'RESTORED' | 'RETIRED'; comment: string; revision: number }
    ) => {
      if (command.action === 'CREATE_REPAIR_TASK') {
        return createPublishedContentRepairTask(context.issue.id, {
          fact_version_id: command.factVersionId,
          expected_issue_revision: command.revision,
        }, csrfToken);
      }
      return resolvePublishedContentIssue(context.issue.id, {
        outcome: command.outcome,
        comment: command.comment,
        expected_revision: command.revision,
      }, csrfToken);
    },
  });

  const stale = contextStale || (draftSnapshot !== undefined
    && draftSnapshot !== issueActionSnapshot(context));
  const busy = operationPending || mutation.isPending;
  const blocked = busy || stale || Boolean(acceptedCommand);

  if (context.issue.available_actions.length === 0 && !openAction && !blocked) return null;

  const actions: StickyAction[] = context.issue.available_actions.map((action) => ({
    key: action,
    label: action === 'CREATE_REPAIR_TASK' ? '创建修复任务' : '解决内容问题',
    intent: action === 'RESOLVE' && context.issue.primary_task !== 'CONFIRM_RESOLUTION'
      ? 'secondary' as const
      : 'primary' as const,
    enabled: !blocked,
    disabledReason: acceptedCommand
      ? '命令已提交，请先显式重载'
      : stale ? '问题已变化，请先显式重载' : '正在提交',
    onSelect: () => {
      if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
      if (draftAction !== action) {
        setFactVersionId('');
        setOutcome('RESTORED');
        setComment('');
      }
      setDraftAction(action);
      setDraftSnapshot(issueActionSnapshot(context));
      setFieldError(undefined);
      setServerError(undefined);
      setOpenAction(action);
    },
  }));

  const errors: ErrorSummaryItem[] = [
    ...(fieldError ? [{ id: 'field', message: fieldError }] : []),
    ...(repair.error ? [{ id: 'repair-options', message: errorMessage(repair.error) }] : []),
    ...(serverError ? [
      { id: 'server', message: serverError.message },
      ...(serverError.requestId
        ? [{ id: 'request-id', message: `请求 ID：${serverError.requestId}` }]
        : []),
    ] : []),
  ];

  async function submitRepair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationInFlightRef.current || blocked || openAction !== 'CREATE_REPAIR_TASK') return;
    setFieldError(undefined);
    const parsed = repairIssueFormSchema.safeParse({ factVersionId });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '请选择 Fact Version');
      return;
    }
    if (!repair.data?.issue.available_actions.includes('CREATE_REPAIR_TASK')
      || issueActionSnapshot(repair.data) !== issueActionSnapshot(context)) {
      setContextStale(true);
      setServerError({ message: '修复选项已变化，请显式重载最新问题。', status: 409 });
      return;
    }
    if (!repair.data.fact_candidates.some(({ version }) => version.id === parsed.data.factVersionId)) {
      setFieldError('所选 Fact Version 已不在最新候选中，请重新选择');
      return;
    }
    operationInFlightRef.current = true;
    setOperationPending(true);
    let commandAccepted = false;
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const task = await mutation.mutateAsync({
        action: 'CREATE_REPAIR_TASK',
        factVersionId: parsed.data.factVersionId,
        revision: context.issue.revision,
      });
      if (!continuation.isCurrent()) return;
      commandAccepted = true;
      const accepted: AcceptedCommand = { action: 'CREATE_REPAIR_TASK', taskId: task.id };
      setAcceptedCommand(accepted);
      await syncAcceptedCommand(accepted, continuation, task.id);
      if (!continuation.isCurrent()) return;
      setOpenAction(undefined);
      setFactVersionId('');
      setDraftAction(undefined);
      setDraftSnapshot(undefined);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      if (!commandAccepted) handleError(error);
    } finally {
      if (continuation.isCurrent()) {
        operationInFlightRef.current = false;
        setOperationPending(false);
      }
    }
  }

  async function submitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationInFlightRef.current || blocked || openAction !== 'RESOLVE') return;
    setFieldError(undefined);
    const parsed = resolveIssueFormSchema.safeParse({ outcome, comment });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '请检查解决信息');
      return;
    }
    operationInFlightRef.current = true;
    setOperationPending(true);
    let commandAccepted = false;
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await mutation.mutateAsync({ action: 'RESOLVE', ...parsed.data, revision: context.issue.revision });
      if (!continuation.isCurrent()) return;
      commandAccepted = true;
      const accepted: AcceptedCommand = { action: 'RESOLVE', outcome: parsed.data.outcome };
      setAcceptedCommand(accepted);
      await syncAcceptedCommand(accepted, continuation, context.repair_task?.id);
      if (!continuation.isCurrent()) return;
      setOpenAction(undefined);
      setComment('');
      setDraftAction(undefined);
      setDraftSnapshot(undefined);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      if (!commandAccepted) handleError(error);
    } finally {
      if (continuation.isCurrent()) {
        operationInFlightRef.current = false;
        setOperationPending(false);
      }
    }
  }

  async function syncAcceptedCommand(
    accepted: AcceptedCommand,
    continuation: PrincipalContinuation,
    repairTaskId?: string,
  ) {
    try {
      const latest = await onCanonicalChange(continuation, repairTaskId);
      if (!continuation.isCurrent() || !latest) return;
      assertAcceptedCommand(latest, accepted);
      setAcceptedCommand(undefined);
      setContextStale(false);
      setServerError(undefined);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      const mapped = mapPublicationError(error);
      setServerError({
        ...mapped,
        message: `命令已提交，但最新工作区未能确认：${mapped.message}。请显式重载，勿重复提交。`,
      });
      throw error;
    }
  }

  function handleError(error: unknown) {
    const mapped = mapPublicationError(error);
    setServerError(mapped);
    if (mapped.status === 409) setContextStale(true);
  }

  async function reloadContext() {
    if (operationInFlightRef.current) return;
    try {
      const [latest, refreshedRepair] = await Promise.all([
        onReload(),
        draftAction === 'CREATE_REPAIR_TASK' && !acceptedCommand ? repair.refetch() : undefined,
      ]);
      if (refreshedRepair?.error) throw refreshedRepair.error;
      if (acceptedCommand) assertAcceptedCommand(latest, acceptedCommand);
      if (refreshedRepair?.data
        && issueActionSnapshot(refreshedRepair.data) !== issueActionSnapshot(latest)) {
        throw new Error('修复选项与最新问题工作区不一致，请重新重载');
      }
      setContextStale(false);
      setAcceptedCommand(undefined);
      setServerError(undefined);
      setDraftSnapshot(issueActionSnapshot(latest));
      if (acceptedCommand) {
        setOpenAction(undefined);
        setDraftAction(undefined);
        setDraftSnapshot(undefined);
        setFactVersionId('');
        setComment('');
        return;
      }
      if (openAction && !latest.issue.available_actions.includes(openAction)) {
        setOpenAction(undefined);
        setDraftAction(undefined);
        setDraftSnapshot(undefined);
      }
    } catch (error) {
      const mapped = mapPublicationError(error);
      setServerError(acceptedCommand ? {
        ...mapped,
        message: `命令已提交，但最新工作区未能确认：${mapped.message}。请显式重载，勿重复提交。`,
      } : mapped);
    }
  }

  return (
    <>
      <StickyActionBar
        actions={actions}
        status={stale || acceptedCommand
          ? <span className="flex flex-wrap items-center gap-2 text-destructive">
            {acceptedCommand ? '命令已提交；等待确认最新工作区。' : '问题已变化；输入已保留。'}
            <Button disabled={busy} onClick={() => void reloadContext()} size="sm" type="button" variant="outline">显式重载最新问题</Button>
          </span>
          : `服务端修订号 ${context.issue.revision}`}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!busy && !open) {
            setOpenAction(undefined);
            setServerError(undefined);
            setFieldError(undefined);
            if (!stale && !acceptedCommand) {
              setDraftAction(undefined);
              setDraftSnapshot(undefined);
              setFactVersionId('');
              setComment('');
            }
          }
        }}
        open={Boolean(openAction)}
      >
        <DialogContent finalFocus={() => returnFocusRef.current} showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{openAction === 'CREATE_REPAIR_TASK' ? '创建修复任务' : '解决内容问题'}</DialogTitle>
            <DialogDescription>服务端会在提交时重新校验权限、状态、修订号和候选资格。</DialogDescription>
          </DialogHeader>
          <ErrorSummary errors={errors} title="内容问题操作未完成" />
          {(stale || acceptedCommand) && (
            <Button disabled={busy} onClick={() => void reloadContext()} type="button" variant="outline">
              显式重载最新问题
            </Button>
          )}
          {openAction === 'CREATE_REPAIR_TASK' && (
            <form className="space-y-4" onSubmit={submitRepair}>
              {repair.isPending ? (
                <p aria-busy="true" className="text-sm text-text-secondary">正在读取可用 Fact Version…</p>
              ) : repair.data ? (
                <label className="block space-y-1.5" htmlFor="issue-repair-fact-version">
                  <span className="font-medium">修复依据</span>
                  <Select
                    disabled={blocked}
                    items={repair.data.fact_candidates.map((candidate) => ({
                      value: candidate.version.id,
                      label: `FactVersion v${candidate.version.version} · ${candidate.version.change_summary}`,
                    }))}
                    onValueChange={(value) => setFactVersionId(value ?? '')}
                    value={factVersionId || null}
                  >
                    <SelectTrigger id="issue-repair-fact-version"><SelectValue placeholder="请选择批准事实版本" /></SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {repair.data.fact_candidates.map((candidate) => (
                        <SelectItem key={candidate.version.id} value={candidate.version.id}>
                          FactVersion v{candidate.version.version} · {candidate.version.change_summary}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
              <DialogFooter>
                <DialogClose disabled={busy} render={<Button variant="outline" />}>取消</DialogClose>
                <Button disabled={blocked || !repair.data} type="submit">
                  {busy ? '正在创建…' : '确认创建'}
                </Button>
              </DialogFooter>
            </form>
          )}
          {openAction === 'RESOLVE' && (
            <form className="space-y-4" onSubmit={submitResolution}>
              <label className="block space-y-1.5" htmlFor="issue-resolution-outcome">
                <span className="font-medium">解决结果</span>
                <Select
                  disabled={blocked}
                  items={[
                    { value: 'RESTORED', label: '已恢复' },
                    { value: 'RETIRED', label: '已退役' },
                  ]}
                  onValueChange={(value) => value && setOutcome(value as 'RESTORED' | 'RETIRED')}
                  value={outcome}
                >
                  <SelectTrigger id="issue-resolution-outcome"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RESTORED">已恢复</SelectItem>
                    <SelectItem value="RETIRED">已退役</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1.5" htmlFor="issue-resolution-comment">
                <span className="font-medium">解决说明</span>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
                  disabled={blocked}
                  id="issue-resolution-comment"
                  onChange={(event) => setComment(event.target.value)}
                  value={comment}
                />
              </label>
              <DialogFooter>
                <DialogClose disabled={busy} render={<Button variant="outline" />}>取消</DialogClose>
                <Button disabled={blocked} type="submit">
                  {busy ? '正在提交…' : '确认解决'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function issueActionSnapshot(context: Pick<PublishedContentIssueWorkspaceContext, 'issue'>) {
  const { issue } = context;
  return JSON.stringify([
    issue.id,
    issue.revision,
    issue.status,
    issue.workflow_stage,
    issue.primary_task,
    issue.repair_task_id,
    [...issue.available_actions].sort(),
  ]);
}

function assertAcceptedCommand(
  latest: PublishedContentIssueWorkspaceContext,
  accepted: AcceptedCommand,
) {
  if (accepted.action === 'CREATE_REPAIR_TASK') {
    if (latest.repair_task?.id !== accepted.taskId
      || latest.issue.available_actions.includes('CREATE_REPAIR_TASK')) {
      throw new Error('最新问题工作区尚未确认已创建的修复任务');
    }
    return;
  }
  if (latest.issue.status !== 'RESOLVED'
    || latest.issue.resolution_outcome !== accepted.outcome
    || latest.issue.available_actions.length > 0) {
    throw new Error('最新问题工作区尚未确认解决记录');
  }
}

export { PublishedContentIssueWorkspaceActions };
export type { PublishedContentIssueWorkspaceActionsProps };
