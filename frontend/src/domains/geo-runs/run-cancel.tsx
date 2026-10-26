import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { Button } from '@/design-system/primitives/button';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import { manualEntryOptions, runDetailOptions, runKeys, RunRequestError } from './runs.api';
import { cancelManualRun, cancellationReason, type Cancellation, type CancelRequest } from './run-cancel.api';
import { timestamp } from './runs.model';

type Detail = components['schemas']['GeoRunDetail'];
type Context = components['schemas']['GeoManualEntryContext'];
export function RunCancel({ detail, csrfToken, blocked, readError }: { detail: Detail; csrfToken: string | null; blocked: boolean; readError?: unknown }) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<Context>();
  const [reading, setReading] = useState(false);
  const [held, setHeld] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState<Cancellation>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const form = useForm({ defaultValues: { reason: '' }, resolver: zodResolver(cancellationReason), mode: 'onChange' });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const current = () => mounted.current && owner.isCurrent();
  const mutation = useMutation({
    retry: false, gcTime: 0,
    mutationFn: async ({ body, requestId }: { body: CancelRequest; requestId: string }) => {
      owner.assertCurrent();
      if (!csrfToken || !controller.current) throw new Error('人工取消缺少会话或取消边界');
      return cancelManualRun(detail.run.id, body, csrfToken, requestId, controller.current.signal);
    },
  });
  const record = accepted ?? detail.cancellation;
  const offered = detail.run.available_actions.includes('CANCEL');
  const denied = [error, readError].some((value) => value instanceof RunRequestError && [401, 403, 404].includes(value.status ?? 0));
  const busy = reading || mutation.isPending || form.formState.isSubmitting;
  const stale = Boolean(context && context.run_revision !== detail.run.revision);
  const permitted = offered && context?.available_actions.includes('CANCEL');
  const locked = busy || blocked || held || stale || denied || unknown || !permitted || !csrfToken || Boolean(record);

  async function readContext() {
    if (inFlight.current || !current() || !offered || denied) return;
    inFlight.current = true; setReading(true); setError(undefined);
    try {
      await client.cancelQueries({ queryKey: runKeys.manual(detail.run.id) });
      owner.assertCurrent();
      const value = await client.fetchQuery({ ...manualEntryOptions(detail.run.id), staleTime: 0 });
      if (!current()) return;
      if (value.run_id !== detail.run.id) throw new RunRequestError('人工上下文身份不符');
      setContext(value); setHeld(false);
      setMessage('已读取当前运行和已保存草稿版本，请核对后确认取消。');
    } catch (failure) {
      if (current()) { setError(failure); setHeld(true); }
    } finally { inFlight.current = false; if (current()) setReading(false); }
  }
  async function submit(values: { reason: string }) {
    if (inFlight.current || locked || !context || !current()) return;
    inFlight.current = true; controller.current = new AbortController(); setError(undefined); setMessage('');
    let committed = false;
    try {
      const result = await mutation.mutateAsync({ body: { expected_revision: context.run_revision, expected_draft_revision: context.draft_revision, reason: values.reason }, requestId: crypto.randomUUID() });
      if (!current()) return;
      committed = true; setAccepted(result); setOpen(false); setContext(undefined); form.reset();
      setMessage('取消已接受；已保存草稿和文件引用未删除，已提交回答不受影响。');
      await client.cancelQueries({ queryKey: runKeys.root() });
      owner.assertCurrent();
      await client.invalidateQueries({ queryKey: runKeys.root() });
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (committed) { setMessage('取消已接受，后续刷新失败；请重读详情，不会重发。'); return; }
      const known = failure instanceof RunRequestError && failure.detail && failure.status && failure.status >= 400 && failure.status < 500;
      setUnknown(!known); setHeld(Boolean(known && failure.status === 409)); setChecked(false);
    } finally { inFlight.current = false; controller.current = null; if (current()) mutation.reset(); }
  }
  async function reconcile() {
    if (inFlight.current || !current() || denied) return;
    inFlight.current = true; setReading(true); setError(undefined);
    try {
      await client.cancelQueries({ queryKey: runKeys.detail(detail.run.id) });
      owner.assertCurrent();
      const fresh = await client.fetchQuery({ ...runDetailOptions(detail.run.id), staleTime: 0 });
      if (!current()) return;
      if (fresh.cancellation) {
        setAccepted(fresh.cancellation); setUnknown(false); setOpen(false); form.reset();
        setMessage('已读取实际取消记录；这不证明原请求由谁提交成功，没有重发。');
        await client.invalidateQueries({ queryKey: runKeys.root() });
      } else {
        setChecked(true);
        setMessage('当前未读到取消记录，原请求结果仍未知。可继续重读，或结束核对后重新准备新的显式操作。');
      }
    } catch (failure) { if (current()) setError(failure); }
    finally { inFlight.current = false; if (current()) setReading(false); }
  }
  if (!owner.isCurrent()) return <p role="alert">认证主体已变化，请重新进入运行详情。</p>;
  if (denied) return <p role="alert">当前账号不能继续读取或取消该运行，请重新核对访问权限。</p>;
  if (!offered && !open && !record && !error) return null;
  return <section aria-label="人工运行取消" className="min-w-0 space-y-3">
    <DirtyGuard when={open && (form.formState.isDirty || busy || unknown)} shouldBlockNavigation={({ current, next }) => current.pathname !== next.pathname || (current.search as Record<string, unknown>).run_id !== (next.search as Record<string, unknown>).run_id || (current.search as Record<string, unknown>).edit !== (next.search as Record<string, unknown>).edit} />
    {record && <CancellationRecord value={record} />}
    {message && <p role="status" className="text-sm">{message}</p>}
    {Boolean(error) && <p role="alert" className="break-words text-sm text-danger">{error instanceof Error ? error.message : '人工取消未完成'}</p>}
    {offered && !record && !open && <Button type="button" variant="outline" disabled={blocked || !csrfToken} onClick={() => { setOpen(true); setContext(undefined); setHeld(false); setMessage(''); void readContext(); }}>取消未提交人工运行</Button>}
    {open && !record && <div className="space-y-3 rounded-lg border border-border-default p-4">
      <h3 className="type-section-title">确认取消人工运行</h3>
      <p className="text-sm">取消后不能继续编辑或提交本次运行。不会删除已保存草稿及文件引用；临时草稿继续按既有保留策略管理。尚未保存的页面输入请先自行保存。</p>
      {reading && <p role="status">正在核对运行与草稿版本…</p>}
      {context && <p className="text-sm">运行 revision {context.run_revision} · 已保存草稿 revision {context.draft_revision}。{context.draft ? '存在已保存草稿，取消时予以保留。' : '当前没有已保存草稿。'}</p>}
      {(held || stale || !permitted) && !unknown && <p className="text-sm">资格或版本已变化，原因保留；请显式重读后重新确认。</p>}
      <FormProvider {...form}><form className="space-y-3" aria-label="人工运行取消表单" onSubmit={(event) => void form.handleSubmit(submit)(event)}>
        <FormField name="reason" id="manual-cancel-reason" label="取消原因" required render={({ field, inputId, ...aria }) => <Textarea {...field} id={inputId} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} rows={3} maxLength={2000} disabled={locked} />} />
        <div className="flex flex-wrap gap-2">
          {!unknown && <Button type="submit" disabled={locked || !form.formState.isValid}>确认取消本次人工运行</Button>}
          {!unknown && <Button type="button" variant="outline" disabled={busy || denied} onClick={() => void readContext()}>重读取消条件并保留原因</Button>}
          {unknown && <><p className="basis-full text-sm">提交结果未知，仅重读实际记录核对，不会重发取消请求。</p><Button type="button" variant="outline" disabled={busy} onClick={() => void reconcile()}>重读运行核对取消结果</Button>{checked && <Button type="button" variant="outline" disabled={busy} onClick={() => { setUnknown(false); setChecked(false); setHeld(true); setContext(undefined); setMessage('已结束原请求核对。须重新读取条件并确认，后续操作是新的显式请求。'); }}>结束核对并保留原因</Button>}</>}
          <Button type="button" variant="ghost" disabled={busy || unknown} onClick={() => { setOpen(false); setContext(undefined); form.reset(); setError(undefined); }}>关闭取消表单</Button>
        </div>
      </form></FormProvider>
    </div>}
  </section>;
}
function CancellationRecord({ value }: { value: Cancellation }) {
  return <section aria-label="人工取消记录，只读" className="min-w-0 space-y-2 rounded-lg border border-border-default p-4 text-sm">
    <h3 className="type-section-title">人工取消记录 · 只读</h3>
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">原因：{value.reason}</p>
    <p className="break-all">取消人 ID：{value.cancelled_by} · {timestamp(value.cancelled_at)}</p>
    <p>取消后运行 revision {value.run_revision} · 当时已保存草稿 revision {value.draft_revision}。</p>
    <p>取消不删除草稿或文件引用；临时草稿继续遵循原有保留策略。已提交回答和其他历史证据保留。</p>
  </section>;
}
