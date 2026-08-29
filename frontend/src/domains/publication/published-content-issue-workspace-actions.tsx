import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

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

type PublishedContentIssueWorkspaceActionsProps = {
  context: PublishedContentIssueWorkspaceContext;
  csrfToken: string | null;
  onCanonicalChange: (repairTaskId?: string) => Promise<void>;
  onReload: () => Promise<PublishedContentIssueWorkspaceContext>;
};

function PublishedContentIssueWorkspaceActions({
  context,
  csrfToken,
  onCanonicalChange,
  onReload,
}: PublishedContentIssueWorkspaceActionsProps) {
  const [openAction, setOpenAction] = useState<IssueCommand>();
  const [factVersionId, setFactVersionId] = useState('');
  const [outcome, setOutcome] = useState<'RESTORED' | 'RETIRED'>('RESTORED');
  const [comment, setComment] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const [contextStale, setContextStale] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const repairOptions = publishedContentRepairContextQueryOptions(context.issue.id);
  const repair = useQuery({ ...repairOptions, enabled: openAction === 'CREATE_REPAIR_TASK' });
  const mutation = useMutation({
    mutationFn: async (command: |
      { action: 'CREATE_REPAIR_TASK'; factVersionId: string; revision: number }
      | { action: 'RESOLVE'; outcome: 'RESTORED' | 'RETIRED'; comment: string }
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
        expected_revision: context.issue.revision,
      }, csrfToken);
    },
  });

  if (context.issue.available_actions.length === 0) return null;

  const actions: StickyAction[] = context.issue.available_actions.map((action) => ({
    key: action,
    label: action === 'CREATE_REPAIR_TASK' ? '创建修复任务' : '解决内容问题',
    intent: action === 'RESOLVE' && context.issue.primary_task !== 'CONFIRM_RESOLUTION'
      ? 'secondary' as const
      : 'primary' as const,
    enabled: !mutation.isPending && !contextStale,
    disabledReason: contextStale ? '问题已变化，请先显式重载' : '正在提交',
    onSelect: () => {
      if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
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
    setFieldError(undefined);
    const parsed = repairIssueFormSchema.safeParse({ factVersionId });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '请选择 Fact Version');
      return;
    }
    if (!repair.data?.issue.available_actions.includes('CREATE_REPAIR_TASK')) {
      setContextStale(true);
      setServerError({ message: '修复选项已变化，请显式重载最新问题。', status: 409 });
      return;
    }
    if (!repair.data.fact_candidates.some(({ version }) => version.id === parsed.data.factVersionId)) {
      setFieldError('所选 Fact Version 已不在最新候选中，请重新选择');
      return;
    }
    try {
      const task = await mutation.mutateAsync({
        action: 'CREATE_REPAIR_TASK',
        factVersionId: parsed.data.factVersionId,
        revision: repair.data.issue.revision,
      });
      await onCanonicalChange(task.id);
      setOpenAction(undefined);
      setFactVersionId('');
    } catch (error) {
      handleError(error);
    }
  }

  async function submitResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(undefined);
    const parsed = resolveIssueFormSchema.safeParse({ outcome, comment });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '请检查解决信息');
      return;
    }
    try {
      await mutation.mutateAsync({ action: 'RESOLVE', ...parsed.data });
      await onCanonicalChange(context.repair_task?.id);
      setOpenAction(undefined);
      setComment('');
    } catch (error) {
      handleError(error);
    }
  }

  function handleError(error: unknown) {
    const mapped = mapPublicationError(error);
    setServerError(mapped);
    if (mapped.status === 409) setContextStale(true);
  }

  async function reloadContext() {
    try {
      const [latest, refreshedRepair] = await Promise.all([
        onReload(),
        openAction === 'CREATE_REPAIR_TASK' ? repair.refetch() : undefined,
      ]);
      if (refreshedRepair?.error) throw refreshedRepair.error;
      setContextStale(false);
      setServerError(undefined);
      if (openAction && !latest.issue.available_actions.includes(openAction)) {
        setOpenAction(undefined);
      }
    } catch (error) {
      setServerError(mapPublicationError(error));
    }
  }

  return (
    <>
      <StickyActionBar
        actions={actions}
        status={contextStale
          ? <span className="text-destructive">问题已变化；输入已保留，请显式重载。</span>
          : `服务端修订号 ${context.issue.revision}`}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!mutation.isPending && !open) {
            setOpenAction(undefined);
            setServerError(undefined);
            setFieldError(undefined);
          }
        }}
        open={Boolean(openAction)}
      >
        <DialogContent finalFocus={() => returnFocusRef.current} showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>{openAction === 'CREATE_REPAIR_TASK' ? '创建修复任务' : '解决内容问题'}</DialogTitle>
            <DialogDescription>服务端会在提交时重新校验权限、状态、修订号和候选资格。</DialogDescription>
          </DialogHeader>
          <ErrorSummary errors={errors} title="内容问题操作未完成" />
          {contextStale && (
            <Button onClick={() => void reloadContext()} type="button" variant="outline">
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
                    disabled={mutation.isPending || contextStale}
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
                <DialogClose disabled={mutation.isPending} render={<Button variant="outline" />}>取消</DialogClose>
                <Button disabled={mutation.isPending || contextStale || !repair.data} type="submit">
                  {mutation.isPending ? '正在创建…' : '确认创建'}
                </Button>
              </DialogFooter>
            </form>
          )}
          {openAction === 'RESOLVE' && (
            <form className="space-y-4" onSubmit={submitResolution}>
              <label className="block space-y-1.5" htmlFor="issue-resolution-outcome">
                <span className="font-medium">解决结果</span>
                <Select
                  disabled={mutation.isPending || contextStale}
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
                  disabled={mutation.isPending || contextStale}
                  id="issue-resolution-comment"
                  onChange={(event) => setComment(event.target.value)}
                  value={comment}
                />
              </label>
              <DialogFooter>
                <DialogClose disabled={mutation.isPending} render={<Button variant="outline" />}>取消</DialogClose>
                <Button disabled={mutation.isPending || contextStale} type="submit">
                  {mutation.isPending ? '正在提交…' : '确认解决'}
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

export { PublishedContentIssueWorkspaceActions };
export type { PublishedContentIssueWorkspaceActionsProps };
