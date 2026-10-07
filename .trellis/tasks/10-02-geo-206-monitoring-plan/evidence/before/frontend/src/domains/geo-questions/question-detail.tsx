import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { RowActions } from '@/design-system/data-table/row-actions';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { deleteQuestion, QuestionRequestError, questionKeys, setQuestionActive } from './questions.api';
import { actionLabels, assertNever, intentLabels, mentionLabels, priorityLabels, shouldBlockQuestionNavigation, stageLabels, type PromptVariant } from './questions.model';
import { parseQuestionCommand, questionOverflow, type QuestionCommand } from './question-actions';
import { QuestionNotice, questionErrorMessage } from './question-controls';
import { QuestionForm } from './question-form';

type CommandIntent = { action: 'ENABLE' | 'DISABLE' | 'DELETE'; revision: number };
type QuestionDetailHandle = { request: (action: QuestionCommand, focus?: HTMLElement | null) => void };
function QuestionDetail({ variant, csrfToken, initialAction, onSaved, onDeleted, onReload, onCopy, readBlocked = false, ref }: {
  variant: PromptVariant; csrfToken: string | null; initialAction?: QuestionCommand;
  onSaved: (variant: PromptVariant) => void; onDeleted: (id: string) => void;
  onReload: () => Promise<PromptVariant>; onCopy: () => void;
  readBlocked?: boolean;
  ref?: Ref<QuestionDetailHandle>;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(initialAction === 'UPDATE');
  const [intent, setIntent] = useState<CommandIntent | undefined>(() => initialAction === 'ENABLE' || initialAction === 'DISABLE' || initialAction === 'DELETE' ? { action: initialAction, revision: variant.revision } : undefined);
  const [error, setError] = useState<unknown>();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [discard, setDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const finalFocus = useRef<HTMLElement | null>(null);
  const deletionConditions = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ retry: false, mutationFn: async ({ target, continuation }: { target: CommandIntent; continuation: PrincipalContinuation }) => {
    await client.cancelQueries({ queryKey: questionKeys.detail(variant.id) });
    continuation.assertCurrent();
    if (target.action === 'DELETE') { await deleteQuestion(variant.id, target.revision, csrfToken); return undefined; }
    return setQuestionActive(variant.id, target.revision, target.action === 'ENABLE', csrfToken);
  } });
  const held = error instanceof QuestionRequestError && error.status === 409;
  const canConfirm = !readBlocked && intent && variant.available_actions.includes(intent.action);
  function begin(command: QuestionCommand, focus?: HTMLElement | null) {
    if (readBlocked || mutation.isPending || refreshing || editing) return;
    switch (command) {
      case 'UPDATE': if (variant.available_actions.includes('UPDATE')) setEditing(true); break;
      case 'COPY': onCopy(); break;
      case 'ENABLE': case 'DISABLE': case 'DELETE':
        finalFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        setIntent({ action: command, revision: variant.revision }); setError(undefined); break;
      default: assertNever(command);
    }
  }
  // 同一资源的新动作是事件，不是新的编辑身份；保留已挂载表单及其草稿。
  useImperativeHandle(ref, () => ({ request: begin }));
  async function confirm() {
    if (!intent || !canConfirm || held || inFlight.current) return;
    inFlight.current = true;
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ target: intent, continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: questionKeys.detail(variant.id) });
      if (!continuation.isCurrent() || !mounted.current) return;
      setError(undefined); setIntent(undefined);
      if (canonical) { client.setQueryData(questionKeys.detail(canonical.id), canonical); onSaved(canonical); setMessage(`${actionLabels[intent.action]}已完成。`); }
      else onDeleted(variant.id);
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { inFlight.current = false; }
  }
  async function reloadIntent() {
    if (refreshing || inFlight.current) return;
    setRefreshing(true);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      const latest = await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      setIntent((current) => current ? { ...current, revision: latest.revision } : undefined); setError(undefined);
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false); }
  }
  return <section aria-label="问题变体详情" className="min-w-0 space-y-5">
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockQuestionNavigation(current, next)} when={mutation.isPending || refreshing} />
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={variant.workflow_stage === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[variant.workflow_stage]}</Badge><span className="text-sm">Revision {variant.revision} · {variant.is_active ? '启用' : '停用'}</span></div><RowActions objectLabel="当前变体" onCommand={(action, focus) => { if (action === 'VIEW_DELETION_CONDITIONS') deletionConditions.current?.focus(); else begin(parseQuestionCommand(action), focus); }} overflow={questionOverflow(variant, editing || mutation.isPending || readBlocked)} /></header>
    {message && <QuestionNotice>{message}</QuestionNotice>}
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-text-muted">完整问题文本</dt><dd className="whitespace-pre-wrap break-words">{variant.prompt_text}</dd></div>
      <div className="sm:col-span-2"><dt className="text-text-muted">所属主题</dt><dd className="break-words">{variant.query_topic.canonical_question} · {intentLabels[variant.query_topic.intent_type]} · Topic Revision {variant.query_topic.revision}</dd></div>
      <div><dt className="text-text-muted">点名属性</dt><dd>{mentionLabels[variant.mention_mode]}</dd></div><div><dt className="text-text-muted">优先级</dt><dd>{priorityLabels[variant.priority]}</dd></div>
      <div><dt className="text-text-muted">语言 / 地区</dt><dd>{variant.language_code} / {variant.region_code}</dd></div><div><dt className="text-text-muted">首次历史引用</dt><dd>{variant.first_referenced_at ? new Date(variant.first_referenced_at).toLocaleString('zh-CN') : '尚未引用'}</dd></div>
    </dl>
    <section aria-label="运行入口" className="space-y-2 border-t border-border-subtle pt-4"><h3 className="type-section-title">运行入口</h3><Button aria-describedby="question-run-reason" disabled focusableWhenDisabled type="button" variant="outline">立即运行</Button><p className="text-sm text-text-muted" id="question-run-reason">{runReason(variant.run_entry.reason_code)}</p></section>
    <section aria-label="删除条件" className="space-y-2 border-t border-border-subtle pt-4" ref={deletionConditions} tabIndex={-1}><h3 className="type-section-title">删除条件</h3>{variant.deletion.blockers.length ? <QuestionNotice>{variant.deletion.blockers.map((blocker) => <p key={blocker}>{blockerReason(blocker)}</p>)}</QuestionNotice> : <p className="text-sm text-text-secondary">服务端当前未返回历史引用阻断；删除会再次验证版本和引用。</p>}</section>
    {variant.available_actions.includes('UPDATE') && !editing && <Button disabled={readBlocked} onClick={() => setEditing(true)} type="button">编辑变体</Button>}
    {editing && <div className="space-y-3 border-t border-border-subtle pt-4"><h3 className="type-section-title">编辑问题变体</h3><QuestionForm csrfToken={csrfToken} onCancel={() => dirty ? setDiscard(true) : setEditing(false)} onDirtyChange={setDirty} onReload={onReload} onSaved={(canonical) => { setDirty(false); onSaved(canonical); }} readBlocked={readBlocked} variant={variant} /></div>}
    <Dialog onOpenChange={(open) => { if (!open && !mutation.isPending) setIntent(undefined); }} open={Boolean(intent)}><DialogContent finalFocus={() => finalFocus.current?.isConnected ? finalFocus.current : null} showCloseButton={!mutation.isPending}><DialogHeader><DialogTitle>确认{intent ? actionLabels[intent.action] : '操作'}</DialogTitle><DialogDescription>{intent?.action === 'DELETE' ? '删除后不能恢复。已有历史引用的变体无法删除；服务端会再次检查。' : '只改变变体启用状态，不改写历史语义。'} Revision {intent?.revision}。</DialogDescription></DialogHeader>{Boolean(error) && <QuestionNotice error>{questionErrorMessage(error)}</QuestionNotice>}{!canConfirm && <p role="alert">服务端当前未提供该动作，请关闭或重新读取。</p>}{(held || !canConfirm) && <Button disabled={refreshing} onClick={() => void reloadIntent()} type="button" variant="outline">重新读取并重新确认</Button>}<DialogFooter><Button disabled={mutation.isPending} onClick={() => setIntent(undefined)} type="button" variant="outline">取消</Button><Button disabled={!canConfirm || held || mutation.isPending || refreshing || !csrfToken} onClick={() => void confirm()} type="button" variant={intent?.action === 'DELETE' ? 'destructive' : 'default'}>{mutation.isPending ? '提交中…' : '确认操作'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog onOpenChange={setDiscard} open={discard}><DialogContent><DialogHeader><DialogTitle>放弃未保存的修改？</DialogTitle><DialogDescription>关闭表单会丢弃当前输入。</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDiscard(false)} type="button" variant="outline">继续编辑</Button><Button onClick={() => { setDiscard(false); setEditing(false); setDirty(false); }} type="button" variant="destructive">放弃修改并关闭</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
function runReason(code: PromptVariant['run_entry']['reason_code']) { switch (code) { case 'NOT_IMPLEMENTED': return '运行能力尚未实现（NOT_IMPLEMENTED），当前只能维护问题变体。'; default: return assertNever(code); } }
function blockerReason(code: PromptVariant['deletion']['blockers'][number]) { switch (code) { case 'HISTORY_REFERENCE': return '已有历史引用（HISTORY_REFERENCE），不能编辑或删除语义；可停用，或复制形成新变体。'; default: return assertNever(code); } }
export { QuestionDetail };
export type { QuestionDetailHandle };
