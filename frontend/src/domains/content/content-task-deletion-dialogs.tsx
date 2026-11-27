import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { contentKeys, contentTaskDetailQueryOptions, permanentDeletionPreviewQueryOptions } from './content.api';
import type { ContentTaskActionState } from './content-task-actions';

type PermanentDeletionPreview = components['schemas']['ContentTaskPermanentDeletionPreview'];
type PermanentDeletionCounts = components['schemas']['ContentTaskPermanentDeletionCounts'];

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


type PermanentDeleteTaskDialogProps = {
  finalFocus: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (preview: PermanentDeletionPreview, confirmationText: string) => void;
  open: boolean;
  pending: boolean;
  task?: ContentTaskActionState;
};

function PermanentDeleteTaskDialog(props: PermanentDeleteTaskDialogProps) {
  return (
    <Dialog onOpenChange={(next) => !next && !props.pending && props.onClose()} open={props.open}>
      <DialogContent className="sm:max-w-lg" finalFocus={props.finalFocus}>
        <DialogHeader>
          <DialogTitle>永久删除任务“{props.task?.identifier}”</DialogTitle>
          <DialogDescription>服务端会在执行时重新计算以下范围；外部页面不会被删除。</DialogDescription>
        </DialogHeader>
        {props.task && <PermanentDeletionSession key={props.task.id} {...props} task={props.task} />}
      </DialogContent>
    </Dialog>
  );
}

function PermanentDeletionSession({ task, open, pending, onSubmit }: PermanentDeleteTaskDialogProps & { task: ContentTaskActionState }) {
  const queryClient = useQueryClient();
  const options = permanentDeletionPreviewQueryOptions(task.id);
  const [acknowledgedErrors, setAcknowledgedErrors] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const preview = useQuery({
    ...options,
    enabled: open,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // 同值后台刷新也会推进读取版本，必须撤销旧确认。
    notifyOnChangeProps: 'all',
  });
  const state = queryClient.getQueryState<PermanentDeletionPreview>(options.queryKey);
  const version = state?.dataUpdateCount ?? 0;
  const blocked = preview.errorUpdateCount > acknowledgedErrors;
  const available = !pending && !preview.isFetching && !preview.isError && !blocked
    && task.available_actions.includes('PERMANENT_DELETE');

  async function reload() {
    const continuation = capturePrincipalContinuation(queryClient);
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    if (!continuation.isCurrent() || !mounted.current) return;
    const result = await preview.refetch();
    if (!continuation.isCurrent() || !mounted.current || result.isError) return;
    setAcknowledgedErrors(queryClient.getQueryState(options.queryKey)?.errorUpdateCount ?? 0);
  }

  function submit(confirmationText: string) {
    const current = queryClient.getQueryState<PermanentDeletionPreview>(options.queryKey);
    if (!available || !current?.data || current.status !== 'success' || current.fetchStatus !== 'idle'
      || current.errorUpdateCount > acknowledgedErrors || current.dataUpdateCount !== version
      || confirmationText !== current.data.confirmation_text) return;
    onSubmit(current.data, confirmationText);
  }

  return (
    <>
      {preview.isPending ? <p role="status">正在读取实时删除范围…</p> : blocked || preview.error ? (
        <div className="space-y-2" role="alert">
          <p className="text-destructive">{preview.error?.message ?? '删除范围读取曾失败，旧预览和确认已失效。'}</p>
          <Button disabled={preview.isFetching} onClick={() => void reload()} variant="outline">重新读取删除范围</Button>
        </div>
      ) : null}
      <PermanentDeletionConfirmation
        key={`${version}:${preview.errorUpdateCount}`}
        available={available}
        onSubmit={submit}
        pending={pending}
        preview={!blocked && !preview.error ? preview.data : undefined}
      />
    </>
  );
}

function PermanentDeletionConfirmation({ available, onSubmit, pending, preview }: {
  available: boolean;
  onSubmit: (text: string) => void;
  pending: boolean;
  preview?: PermanentDeletionPreview;
}) {
  const [confirmationText, setConfirmationText] = useState('');
  return (
    <>
      {preview && (
        <>
          <dl className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border p-3">
            {deletionCountFields.map(([field, label]) => (
              <div className="contents" key={field}>
                <dt className="text-text-secondary">{label}</dt>
                <dd className="text-right font-mono">{preview.counts[field]}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1">
            <p className="font-medium">登记的外部 URL</p>
            {preview.external_urls.length > 0 ? (
              <ul className="max-h-24 list-disc overflow-y-auto pl-5 text-xs text-text-secondary">
                {preview.external_urls.map((url) => <li key={url}>{url}</li>)}
              </ul>
            ) : <p className="text-xs text-text-muted">无外部登记 URL</p>}
          </div>
          <label className="space-y-1 text-sm">
            <span className="font-medium">输入“{preview.confirmation_text}”确认永久删除</span>
            <Input autoComplete="off" disabled={!available} onChange={(event) => setConfirmationText(event.currentTarget.value)} value={confirmationText} />
          </label>
        </>
      )}
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button variant="outline" />}>返回</DialogClose>
        <Button disabled={!available || !preview || confirmationText !== preview.confirmation_text}
          onClick={() => onSubmit(confirmationText)} type="button" variant="destructive">
          {pending ? '正在永久删除…' : '永久删除'}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeletionRecoveryDialog({ task, error, onClose, onRecovered, finalFocus }: {
  task: ContentTaskActionState;
  error: Error;
  onClose: () => void;
  onRecovered: () => void;
  finalFocus: () => HTMLElement | null;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState<Error>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function reload() {
    if (pending) return;
    const continuation = capturePrincipalContinuation(queryClient);
    setPending(true);
    try {
      await queryClient.cancelQueries({ queryKey: contentKeys.detail(task.id), exact: true });
      if (!continuation.isCurrent() || !mounted.current) return;
      await queryClient.fetchQuery({ ...contentTaskDetailQueryOptions(task.id), staleTime: 0 });
      if (!continuation.isCurrent() || !mounted.current) return;
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists() }, { throwOnError: true });
      if (continuation.isCurrent() && mounted.current) onRecovered();
    } catch (failure) {
      if (continuation.isCurrent() && mounted.current) setReadError(failure as Error);
    } finally {
      if (continuation.isCurrent() && mounted.current) setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>重新检查任务“{task.identifier}”的删除条件</DialogTitle>
          <DialogDescription>旧删除确认已失效。重新读取成功后，请重新打开删除操作并确认。</DialogDescription>
        </DialogHeader>
        <p role="alert">{readError?.message ?? error.message}</p>
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>返回</DialogClose>
          <Button disabled={pending} onClick={() => void reload()}>{pending ? '正在重新读取…' : '重新读取删除条件'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DeletionRecoveryDialog, PermanentDeleteTaskDialog };
