import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { ErrorSummary, FormActions } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { beginReviewCommand, finishReviewCommand, readReviewCommand, subscribeReviewCommands } from './review-command';
import { ReviewFields, reviewIssues } from './review-fields';
import { currentAnalysis, currentCorrection, reviewFormSchema, reviewPayload, reviewValues, severeClaims, type Analysis, type Detail, type ReviewValues } from './review.model';
import { runDetailOptions, runKeys, RunRequestError, submitRunReview } from './runs.api';
import { shouldBlockManualNavigation } from './manual.model';
import { CorrectionHistory } from './run-analysis';

type Props = { detail: Detail; csrfToken: string | null; blocked: boolean; readError?: unknown };
function RunReview(props: Props) {
  const client = useQueryClient();
  const [started, setStarted] = useState<Detail>();
  const [message, setMessage] = useState('');
  const [discard, setDiscard] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const discardTarget = useRef<HTMLElement | null>(null);
  const command = useSyncExternalStore((listener) => subscribeReviewCommands(client, listener), () => readReviewCommand(client, props.detail.run.id));
  const offered = props.detail.analysis.available_actions.includes('REVIEW');
  const selected = currentAnalysis(props.detail);
  function close() {
    setStarted(undefined);
    queueMicrotask(() => trigger.current?.isConnected && trigger.current.focus({ preventScroll: true }));
  }
  return <div className="min-w-0 space-y-3">
    {message && <p role="status" className="text-sm">{message}</p>}
    {!started && (offered || command) && <Button disabled={props.blocked || (!selected && !command)} onClick={() => { setMessage(''); setStarted(props.detail); }} ref={trigger} type="button" variant="outline">{command ? '查看人工复核提交结果' : '开始人工复核'}</Button>}
    {started && <ReviewEditor {...props} initial={started} onClose={close} onDiscard={() => { if (document.activeElement instanceof HTMLElement) discardTarget.current = document.activeElement; setDiscard(true); }} onCompleted={() => { setMessage('人工复核已追加；正在读取服务端当前有效结果。'); close(); }} />}
    <Dialog onOpenChange={setDiscard} open={discard}><DialogContent finalFocus={() => started ? discardTarget.current?.isConnected ? discardTarget.current : null : trigger.current?.isConnected ? trigger.current : null}><DialogHeader><DialogTitle>放弃本次复核？</DialogTitle><DialogDescription>尚未提交的本地修改将丢失。已经发送的请求不会取消，结果未知时仍需读取复核历史。</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDiscard(false)} type="button" variant="outline">继续复核</Button><Button onClick={() => { setDiscard(false); close(); }} type="button" variant="destructive">放弃本次复核</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function ReviewEditor({ initial, detail, csrfToken, blocked, readError, onClose, onCompleted, onDiscard }: Props & { initial: Detail; onClose: () => void; onCompleted: () => void; onDiscard: () => void }) {
  const client = useQueryClient();
  const initialAnalysis = currentAnalysis(initial);
  if (!initialAnalysis) return <p role="alert">当前分析不可读取；请关闭详情后重新读取复核历史。</p>;
  return <ReviewForm initial={initial} initialAnalysis={initialAnalysis} latestDetail={detail} csrfToken={csrfToken} blocked={blocked} inaccessible={readError instanceof RunRequestError && [401, 403, 404].includes(readError.status ?? 0)} onClose={onClose} onCompleted={onCompleted} onDiscard={onDiscard} client={client} />;
}
function ReviewForm({ initial, initialAnalysis, latestDetail, csrfToken, blocked, inaccessible, onClose, onCompleted, onDiscard, client }: {
  initial: Detail; initialAnalysis: Analysis; latestDetail: Detail; csrfToken: string | null; blocked: boolean;
  inaccessible: boolean; onClose: () => void; onCompleted: () => void; onDiscard: () => void; client: ReturnType<typeof useQueryClient>;
}) {
  const [context, setContext] = useState(initial);
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const form = useForm<ReviewValues>({ defaultValues: reviewValues(initial, initialAnalysis), resolver: zodResolver(reviewFormSchema(analysis)), mode: 'onChange' });
  const [frozen, setFrozen] = useState(false);
  const [operation, setOperation] = useState<'submit' | 'read'>();
  const [error, setError] = useState<unknown>();
  const [changedAnalysis, setChangedAnalysis] = useState<Detail>();
  const [principalLost, setPrincipalLost] = useState(false);
  const mounted = useRef(false);
  const working = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const command = useSyncExternalStore((listener) => subscribeReviewCommands(client, listener), () => readReviewCommand(client, initial.run.id));
  useEffect(() => {
    mounted.current = true;
    title.current?.focus({ preventScroll: true });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => client.getQueryCache().subscribe((event) => {
    if (!owner.isCurrent()) {
      // 清除旧主体的输入与提示；迟到 continuation 也不能失效新主体的 query。
      setPrincipalLost(true);
      form.reset();
      setError(undefined);
      setChangedAnalysis(undefined);
      return;
    }
    if (event.type === 'updated' && event.action.type === 'error' && event.query.queryKey[2] === 'detail' && event.query.queryKey[3] === initial.run.id) {
      setFrozen(true);
      setError(event.query.state.error);
    }
  }), [client, form, initial.run.id, owner]);
  const outdated = context.run.revision !== latestDetail.run.revision || analysis.analysis.id !== latestDetail.analysis.selection.current_analysis_revision_id;
  const offered = latestDetail.analysis.available_actions.includes('REVIEW');
  const busy = Boolean(operation) || command?.phase === 'pending';
  const unknown = command?.phase === 'unknown';
  const unavailable = blocked || !offered || frozen || outdated || principalLost || !owner.isCurrent();
  const guarded = !principalLost && (form.formState.isDirty || busy || Boolean(command));
  async function submit(values: ReviewValues) {
    if (working.current || command || unavailable || !csrfToken || !mounted.current || !owner.isCurrent()) return;
    working.current = true;
    setOperation('submit'); setError(undefined);
    let started: ReturnType<typeof beginReviewCommand> = undefined;
    let dispatched = false;
    try {
      owner.assertCurrent();
      await client.cancelQueries({ queryKey: runKeys.detail(context.run.id), exact: true });
      if (!mounted.current || !owner.isCurrent()) return;
      const canonical = client.getQueryData<Detail>(runKeys.detail(context.run.id));
      if (!canonical || canonical.run.revision !== context.run.revision || canonical.analysis.selection.current_analysis_revision_id !== analysis.analysis.id || !canonical.analysis.available_actions.includes('REVIEW')) {
        setFrozen(true);
        throw new Error('编辑起点或复核动作已变化，请显式读取最新上下文并重新核对');
      }
      started = beginReviewCommand(client, context.run.id, reviewPayload(values, analysis.analysis.id, context.run.revision));
      if (!started) return;
      dispatched = true;
      await submitRunReview(context.run.id, started.payload, csrfToken);
      if (!owner.isCurrent()) return;
      // 成功先取消旧读取，再失效 canonical root；不拼接或猜测有效结果。
      await client.cancelQueries({ queryKey: runKeys.root() });
      if (!owner.isCurrent()) return;
      finishReviewCommand(client, context.run.id, started);
      void client.invalidateQueries({ queryKey: runKeys.root(), refetchType: 'active' });
      if (!mounted.current) return;
      form.reset(values);
      onCompleted();
    } catch (failure) {
      if (!owner.isCurrent()) return;
      const explicit = failure instanceof RunRequestError && failure.detail && failure.status !== undefined && failure.status >= 400 && failure.status < 500;
      if (started && dispatched) finishReviewCommand(client, context.run.id, started, explicit ? undefined : failure);
      if (!mounted.current) return;
      setError(failure);
      if (explicit && failure.status !== 422) setFrozen(true);
    } finally {
      working.current = false;
      if (mounted.current && owner.isCurrent()) setOperation(undefined);
    }
  }
  async function reread() {
    if (working.current || command?.phase === 'pending' || !owner.isCurrent()) return;
    working.current = true; setOperation('read'); setError(undefined);
    try {
      await client.cancelQueries({ queryKey: runKeys.detail(initial.run.id), exact: true });
      if (!mounted.current || !owner.isCurrent()) return;
      const fresh = await client.fetchQuery({ ...runDetailOptions(initial.run.id), staleTime: 0 });
      if (!mounted.current || !owner.isCurrent()) return;
      if (command) {
        setError(new Error('已读取真实复核历史。请核对新记录、复核人及说明；读取不能证明原请求结果，原命令仍不会重放。'));
        return;
      }
      const selected = currentAnalysis(fresh);
      if (!selected || selected.analysis.id !== analysis.analysis.id) { setChangedAnalysis(fresh); setFrozen(true); return; }
      setContext(fresh);
      setAnalysis(selected);
      form.setValue('checked', severeClaims(selected).map(() => false), { shouldDirty: true });
      form.clearErrors();
      setFrozen(false);
    } catch (failure) {
      if (mounted.current && owner.isCurrent()) { setError(failure); setFrozen(true); }
    } finally {
      working.current = false;
      if (mounted.current && owner.isCurrent()) setOperation(undefined);
    }
  }
  function restart() {
    if (!changedAnalysis || command || !owner.isCurrent()) return;
    const selected = currentAnalysis(changedAnalysis);
    if (!selected || !changedAnalysis.analysis.available_actions.includes('REVIEW')) return;
    setContext(changedAnalysis); setAnalysis(selected);
    form.reset(reviewValues(changedAnalysis, selected));
    setChangedAnalysis(undefined); setFrozen(false); setError(undefined);
    title.current?.focus({ preventScroll: true });
  }
  if (principalLost || !owner.isCurrent()) return <p role="alert">认证主体已变化，旧复核输入已清除。请重新进入运行详情。</p>;
  const visibleError = error ?? command?.error;
  return <FormProvider {...form}>
    <DirtyGuard description={command ? '复核请求可能已写入。离开会丢失本地草稿，请先读取历史核对；本会话不会重放原命令。' : undefined} shouldBlockNavigation={({ current, next }) => shouldBlockManualNavigation(current, next)} when={guarded} />
    <form aria-label="人工复核表单" className="min-w-0 space-y-4 rounded-lg border border-border-default p-4" noValidate onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(submit)(event); }}>
      <h4 className="font-medium" ref={title} tabIndex={-1}>人工复核</h4>
      <p className="break-all text-sm">编辑起点：Analysis {analysis.analysis.id} · Run Revision {context.run.revision}</p>
      <p aria-live="polite" className="text-sm">{busy ? operation === 'read' ? '正在读取历史…' : '正在提交…' : unknown ? '提交结果未知' : form.formState.isDirty ? '本地未提交' : '尚未修改'}</p>
      {currentCorrection(context) && <p className="text-sm">当前人工修正已完整载入。提交本次复核会整体替换它；请明确选择希望保留的行。</p>}
      <fieldset disabled={busy || unknown || unavailable} className="min-w-0"><ReviewFields analysis={analysis} detail={context} disabled={busy || Boolean(unknown) || unavailable} /></fieldset>
      <ErrorSummary errors={reviewIssues(form.formState.errors)} />
      {Boolean(visibleError) && <p className="break-words text-sm text-danger" role="alert">{visibleError instanceof Error ? visibleError.message : '复核失败，请核对上下文'}</p>}
      {(unavailable || command) && <div className="space-y-2 text-sm" role="status">
        <p>{command ? '提交结果尚未确认，输入已冻结。仅允许读取真实历史，不会自动或手动重放原命令。' : '复核上下文已变化或暂不可用。本地输入保留，显式读取后必须重新核对严重声明。'}</p>
        {command && <><p className="break-all">原请求：Analysis {command.payload.analysis_revision_id} · Run Revision {command.payload.expected_run_revision} · {command.payload.decision}</p><p className="whitespace-pre-wrap break-words">原请求说明：{command.payload.comment || '空'}</p>{command.payload.correction_payload && 'schema_version' in command.payload.correction_payload && <CorrectionHistory correction={command.payload.correction_payload} />}</>}
        <Button disabled={busy || inaccessible} onClick={() => void reread()} type="button" variant="outline">{command ? '读取复核历史核对结果' : '读取最新复核上下文并保留输入'}</Button>
      </div>}
      {changedAnalysis && <div className="space-y-2 text-sm" role="alert">
        <p>当前分析已变化，旧分析的修正不可用于新分析。旧草稿仍保留；重新开始会用最新分析替换它。</p>
        <Button disabled={!currentAnalysis(changedAnalysis) || !changedAnalysis.analysis.available_actions.includes('REVIEW')} onClick={restart} type="button" variant="outline">以最新分析重新开始复核（替换本地草稿）</Button>
      </div>}
      <FormActions>
        <Button disabled={busy} onClick={() => guarded ? onDiscard() : onClose()} type="button" variant="outline">取消本次复核</Button>
        <Button disabled={busy || Boolean(command) || unavailable || !csrfToken} type="submit">{operation === 'submit' ? '提交中…' : '提交人工复核'}</Button>
      </FormActions>
    </form>
  </FormProvider>;
}
export { RunReview };
