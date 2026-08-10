import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ReactNode } from 'react';

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
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import {
  ContentRequestError,
  archiveContentTask,
  cancelContentTask,
  contentKeys,
  deleteContentTask,
  permanentDeletionPreviewQueryOptions,
  permanentlyDeleteContentTask,
  restoreContentTask,
} from './content.api';
import type {
  ContentTaskActionState,
  ContentTaskAvailableAction,
} from './content-task-actions';

type PermanentDeletionPreview = components['schemas']['ContentTaskPermanentDeletionPreview'];
type PermanentDeletionCounts = components['schemas']['ContentTaskPermanentDeletionCounts'];
type DeletionBlocker = components['schemas']['DeletionBlocker'];

type LifecycleVariables =
  | { action: 'CANCEL'; task: ContentTaskActionState; comment: string }
  | { action: 'DELETE' | 'ARCHIVE' | 'RESTORE'; task: ContentTaskActionState }
  | {
      action: 'PERMANENT_DELETE';
      task: ContentTaskActionState;
      preview: PermanentDeletionPreview;
      confirmationText: string;
    };

type UseContentTaskLifecycleOptions = {
  csrfToken: string | null;
  onDeleted?: (taskId: string) => Promise<void> | void;
  resolveTask: (taskId: string) => ContentTaskActionState | undefined;
};

function useContentTaskLifecycle({
  csrfToken,
  onDeleted,
  resolveTask,
}: UseContentTaskLifecycleOptions) {
  const queryClient = useQueryClient();
  const [cancelTargetId, setCancelTargetId] = useState<string>();
  const [conditionsTargetId, setConditionsTargetId] = useState<string>();
  const [permanentTargetId, setPermanentTargetId] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const lifecycle = useMutation({
    retry: false,
    mutationFn: async (variables: LifecycleVariables) => {
      switch (variables.action) {
        case 'CANCEL':
          return cancelContentTask(variables.task, variables.comment, csrfToken);
        case 'DELETE':
          return deleteContentTask(variables.task, csrfToken);
        case 'ARCHIVE':
          return archiveContentTask(variables.task, csrfToken);
        case 'RESTORE':
          return restoreContentTask(variables.task, csrfToken);
        case 'PERMANENT_DELETE':
          return permanentlyDeleteContentTask(
            variables.task.id,
            variables.preview,
            variables.confirmationText,
            csrfToken,
          );
        default:
          return assertNever(variables);
      }
    },
    onSuccess: async (_, variables) => {
      setNotice(lifecycleSuccessMessage(variables.action));
      if (variables.action === 'CANCEL') setCancelTargetId(undefined);
      if (variables.action === 'PERMANENT_DELETE') setPermanentTargetId(undefined);
      const deleted = variables.action === 'DELETE' || variables.action === 'PERMANENT_DELETE';
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contentKeys.detail(variables.task.id),
          refetchType: deleted ? 'none' : 'active',
        }),
        queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        queryClient.invalidateQueries({
          queryKey: contentKeys.permanentDeletionPreview(variables.task.id),
          refetchType: 'none',
        }),
      ]);
      if (deleted) await onDeleted?.(variables.task.id);
    },
    onError: async (error, variables) => {
      if (error instanceof ContentRequestError && (error.status === 404 || error.status === 409)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(variables.task.id) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
          queryClient.invalidateQueries({
            queryKey: contentKeys.permanentDeletionPreview(variables.task.id),
          }),
        ]);
      }
    },
  });
  const { mutate, reset } = lifecycle;

  const handleCommand = useCallback((
    command: string,
    task: ContentTaskActionState,
    focusReturn?: HTMLElement | null,
  ) => {
    reset();
    setNotice(null);
    switch (command) {
      case 'cancel-content-task':
        focusReturnRef.current = focusReturn ?? null;
        setCancelTargetId(task.id);
        return;
      case 'delete-content-task':
        mutate({ action: 'DELETE', task });
        return;
      case 'archive-content-task':
        mutate({ action: 'ARCHIVE', task });
        return;
      case 'restore-content-task':
        mutate({ action: 'RESTORE', task });
        return;
      case 'permanently-delete-content-task':
        focusReturnRef.current = focusReturn ?? null;
        setPermanentTargetId(task.id);
        return;
      case 'view-delete-conditions':
        focusReturnRef.current = focusReturn ?? null;
        setConditionsTargetId(task.id);
        return;
      default:
        throw new Error(`Content Tasks 收到未知页面命令：${command}`);
    }
  }, [mutate, reset]);

  const pendingAction = lifecycle.isPending ? lifecycle.variables?.action : undefined;
  const cancelTarget = cancelTargetId ? resolveTask(cancelTargetId) : undefined;
  const conditionsTarget = conditionsTargetId ? resolveTask(conditionsTargetId) : undefined;
  const permanentTarget = permanentTargetId ? resolveTask(permanentTargetId) : undefined;
  const dialogs = (
    <>
      <CancelTaskDialog
        error={lifecycle.error}
        finalFocus={() => resolveFocusReturn(focusReturnRef)}
        onClose={() => setCancelTargetId(undefined)}
        onSubmit={(comment) => {
          if (cancelTarget) lifecycle.mutate({ action: 'CANCEL', task: cancelTarget, comment });
        }}
        open={Boolean(cancelTarget)}
        pending={lifecycle.isPending && lifecycle.variables?.action === 'CANCEL'}
        task={cancelTarget}
      />
      <DeletionConditionsDialog
        finalFocus={() => resolveFocusReturn(focusReturnRef)}
        onClose={() => setConditionsTargetId(undefined)}
        onRefresh={() => Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(conditionsTargetId ?? '') }),
          queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        ]).then(() => undefined)}
        open={Boolean(conditionsTarget?.deletion?.blockers.length)}
        task={conditionsTarget}
      />
      <PermanentDeleteTaskDialog
        error={lifecycle.error}
        finalFocus={() => resolveFocusReturn(focusReturnRef)}
        onClose={() => setPermanentTargetId(undefined)}
        onSubmit={(preview, confirmationText) => {
          if (permanentTarget) {
            lifecycle.mutate({
              action: 'PERMANENT_DELETE',
              task: permanentTarget,
              preview,
              confirmationText,
            });
          }
        }}
        open={Boolean(permanentTarget)}
        pending={lifecycle.isPending && lifecycle.variables?.action === 'PERMANENT_DELETE'}
        task={permanentTarget}
      />
    </>
  );

  return {
    dialogs,
    error: lifecycle.error,
    handleCommand,
    notice,
    pendingAction: pendingAction as ContentTaskAvailableAction | undefined,
    reset,
  };
}

function CancelTaskDialog({
  error,
  finalFocus,
  onClose,
  onSubmit,
  open,
  pending,
  task,
}: {
  error: unknown;
  finalFocus: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (comment: string) => void;
  open: boolean;
  pending: boolean;
  task?: ContentTaskActionState;
}) {
  const [comment, setComment] = useState('');
  return (
    <Dialog
      onOpenChange={(next) => !next && !pending && onClose()}
      onOpenChangeComplete={(next) => !next && setComment('')}
      open={open}
    >
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>取消任务“{task?.identifier}”</DialogTitle>
          <DialogDescription>取消后任务进入终态；请按实际情况填写说明。</DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-sm">
          <span className="font-medium">取消说明</span>
          <textarea
            className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => setComment(event.currentTarget.value)}
            value={comment}
          />
        </label>
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">{errorMessage(error)}</p>
        )}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>返回</DialogClose>
          <Button
            disabled={pending}
            onClick={() => onSubmit(comment)}
            type="button"
            variant="destructive"
          >
            {pending ? '正在取消…' : '确认取消'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const blockerLabels = {
  FACT_VERSION: '事实版本',
  CONTENT_TASK: '内容任务',
  GEO_OBSERVATION: 'GEO 观测',
  CONTENT_VERSION: '内容版本',
  GENERATION_JOB: '运行中的生成作业',
  PUBLISHED_ARTICLE: '已发布成果',
  PLATFORM_PROFILE: '具体平台',
  PLATFORM_ACCOUNT: '平台账号',
  PUBLICATION_WORK: '发布工作',
  PROTECTED_CONTENT_VERSION: '受保护内容版本',
  PUBLISHED_CONTENT_ISSUE: '发布内容问题',
  GEO_OPTIMIZATION_SOURCE: 'GEO 优化来源',
  USER_BUSINESS_HISTORY: '用户业务历史',
} satisfies Record<DeletionBlocker['type'], string>;

function DeletionConditionsDialog({
  finalFocus,
  onClose,
  onRefresh,
  open,
  task,
}: {
  finalFocus: () => HTMLElement | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  open: boolean;
  task?: ContentTaskActionState;
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>任务“{task?.identifier}”暂不可删除</DialogTitle>
          <DialogDescription>请先处理以下服务端权威阻断关系，再重新检查。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {task?.deletion?.blockers.map((blocker) => (
            <li className="flex justify-between gap-4 rounded-lg border p-3" key={blocker.type}>
              <span>{blockerLabels[blocker.type]}</span>
              <span className="font-mono">{blocker.count}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>返回</DialogClose>
          <Button onClick={() => void onRefresh()} type="button">重新检查</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const deletionCountFields = [
  ['content_versions', '内容版本'],
  ['content_review_records', '内容审核记录'],
  ['generation_jobs', '生成作业'],
  ['publication_works', '发布工作'],
  ['publication_events', '发布事件'],
  ['publication_verifications', '发布核验'],
  ['published_articles', '发布成果'],
  ['published_content_issues', '内容问题'],
  ['geo_article_relations', 'GEO 文章关系'],
  ['exclusive_geo_observation_chains', '独占 GEO 观测链'],
  ['attachment_relations', '附件关系'],
] as const satisfies readonly [keyof PermanentDeletionCounts, string][];

function PermanentDeleteTaskDialog({
  error,
  finalFocus,
  onClose,
  onSubmit,
  open,
  pending,
  task,
}: {
  error: unknown;
  finalFocus: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (preview: PermanentDeletionPreview, confirmationText: string) => void;
  open: boolean;
  pending: boolean;
  task?: ContentTaskActionState;
}) {
  const [confirmationText, setConfirmationText] = useState('');
  const preview = useQuery({
    ...permanentDeletionPreviewQueryOptions(task?.id ?? 'closed'),
    enabled: open && task !== undefined,
  });
  return (
    <Dialog
      onOpenChange={(next) => !next && !pending && onClose()}
      onOpenChangeComplete={(next) => !next && setConfirmationText('')}
      open={open}
    >
      <DialogContent className="sm:max-w-lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>永久删除任务“{task?.identifier}”</DialogTitle>
          <DialogDescription>服务端会在执行时重新计算以下范围；外部页面不会被删除。</DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <p role="status">正在读取实时删除范围…</p>
        ) : preview.error ? (
          <div className="space-y-2" role="alert">
            <p className="text-destructive">{errorMessage(preview.error)}</p>
            <Button onClick={() => void preview.refetch()} variant="outline">重试</Button>
          </div>
        ) : preview.data ? (
          <>
            <dl className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border p-3">
              {deletionCountFields.map(([field, label]) => (
                <div className="contents" key={field}>
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="text-right font-mono">{preview.data.counts[field]}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-1">
              <p className="font-medium">登记的外部 URL</p>
              {preview.data.external_urls.length > 0 ? (
                <ul className="max-h-24 list-disc overflow-y-auto pl-5 text-xs text-text-secondary">
                  {preview.data.external_urls.map((url) => <li key={url}>{url}</li>)}
                </ul>
              ) : <p className="text-xs text-text-muted">无外部登记 URL</p>}
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">输入“{preview.data.confirmation_text}”确认永久删除</span>
              <Input
                autoComplete="off"
                onChange={(event) => setConfirmationText(event.currentTarget.value)}
                value={confirmationText}
              />
            </label>
          </>
        ) : null}
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">{errorMessage(error)}</p>
        )}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>返回</DialogClose>
          <Button
            disabled={
              pending
              || !preview.data
              || confirmationText !== preview.data.confirmation_text
            }
            onClick={() => preview.data && onSubmit(preview.data, confirmationText)}
            type="button"
            variant="destructive"
          >
            {pending ? '正在永久删除…' : '永久删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lifecycleSuccessMessage(action: LifecycleVariables['action']) {
  switch (action) {
    case 'CANCEL': return '内容任务已取消。';
    case 'DELETE': return '内容任务已删除。';
    case 'ARCHIVE': return '内容任务已归档。';
    case 'RESTORE': return '内容任务已恢复。';
    case 'PERMANENT_DELETE': return '内容任务已永久删除。';
    default: return assertNever(action);
  }
}

function resolveFocusReturn(focusReturnRef: { current: HTMLElement | null }) {
  const previous = focusReturnRef.current;
  if (!previous || previous.isConnected) return previous;
  const label = previous.getAttribute('aria-label');
  if (!label) return null;
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-label]'))
    .find((element) => element.getAttribute('aria-label') === label) ?? null;
}

function errorMessage(error: unknown): ReactNode {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Content Tasks 收到未处理值：${String(value)}`);
}

export { useContentTaskLifecycle };
