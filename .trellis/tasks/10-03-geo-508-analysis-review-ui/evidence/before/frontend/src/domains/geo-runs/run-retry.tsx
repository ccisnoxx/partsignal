import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import type { components } from '@/shared/api/generated/schema';
import { retryRun, runDetailOptions, runKeys, RunRequestError } from './runs.api';
import { beginRetryCommand, readRetryCommand, subscribeRetryCommands, updateRetryCommand } from './run-retry-command';

type Detail = components['schemas']['GeoRunDetail'];
function RunRetry({ detail, csrfToken, blocked, onCreated }: {
  detail: Detail; csrfToken: string | null; blocked: boolean; onCreated: (id: string) => void;
}) {
  const client = useQueryClient();
  const command = useSyncExternalStore(
    (listener) => subscribeRetryCommands(client, listener),
    () => readRetryCommand(client, detail.run.id),
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Detail['run']>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<unknown>();
  const working = useRef(false);
  const mounted = useRef(true);
  const focusReturn = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const target = command?.target ?? selected;
  const held = command?.phase;
  const pending = reading || held === 'pending';
  const error = readError ?? command?.error;
  const offered = detail.run.available_actions.includes('RETRY');
  const canConfirm = Boolean(target && offered && !blocked && !held && target.revision === detail.run.revision);
  async function created(id: string, continuation: PrincipalContinuation, previousId: string) {
    // 返回稳定身份后失效读取，不以本地猜测的新状态替换 canonical 投影。
    continuation.assertCurrent();
    updateRetryCommand(client, previousId, continuation, { phase: 'created' });
    await client.cancelQueries({ queryKey: runKeys.root() });
    if (!continuation.isCurrent()) return;
    void client.invalidateQueries({ queryKey: runKeys.root(), refetchType: 'active' });
    if (!mounted.current) return;
    setOpen(false);
    onCreated(id);
  }
  async function confirm() {
    if (!target || !canConfirm || working.current || !csrfToken) return;
    const started = beginRetryCommand(client, target);
    if (!started) return;
    const continuation = started.owner;
    setReadError(undefined);
    try {
      await client.cancelQueries({ queryKey: runKeys.detail(target.id) });
      continuation.assertCurrent();
      if (!mounted.current) { updateRetryCommand(client, target.id, continuation); return; }
      const result = await retryRun(target.id, target.revision, csrfToken);
      if (!continuation.isCurrent()) return;
      if (result.batch_id !== target.batch_id || result.attempt_no !== target.attempt_no + 1)
        throw new RunRequestError('新尝试回执与原运行不一致，结果未知，请读取尝试链确认');
      await created(result.run_id, continuation, target.id);
    } catch (failure) {
      updateRetryCommand(client, target.id, continuation, {
        error: failure,
        phase: failure instanceof RunRequestError && failure.detail && failure.status && failure.status < 500 ? 'rejected' : 'unknown',
      });
    }
  }
  async function reload() {
    if (!target || working.current) return;
    const continuation = command?.owner ?? capturePrincipalContinuation(client);
    working.current = true; setReading(true); setReadError(undefined);
    try {
      await client.cancelQueries({ queryKey: runKeys.detail(target.id) });
      continuation.assertCurrent();
      if (!mounted.current) return;
      const fresh = await client.fetchQuery({ ...runDetailOptions(target.id), staleTime: 0 });
      if (!mounted.current || !continuation.isCurrent()) return;
      const successor = fresh.attempts.find((attempt) => attempt.previous_attempt_id === target.id);
      if (successor) { await created(successor.id, continuation, target.id); return; }
      setSelected(fresh.run);
      const current = readRetryCommand(client, target.id);
      if (current?.phase === 'unknown' || current?.phase === 'pending') {
        setReadError(new Error('当前尚无已确认后继；原命令结果仍未知。请稍后再次读取尝试链，不会重发创建请求。'));
      } else { updateRetryCommand(client, target.id, continuation); }
    } catch (failure) {
      if (mounted.current && continuation.isCurrent()) setReadError(failure);
    } finally {
      if (mounted.current && continuation.isCurrent()) { working.current = false; setReading(false); }
    }
  }
  if (!offered && !command && !target) return null;
  return <>
    {(offered || held === 'unknown' || held === 'pending') && <Button disabled={blocked || reading || held === 'created'} onClick={() => {
      if (!target || !held) setSelected(detail.run);
      setOpen(true);
    }} ref={focusReturn} type="button" variant="outline">{held === 'unknown' || held === 'pending' ? '查看新尝试创建结果' : '创建新采集尝试'}</Button>}
    <Dialog onOpenChange={(next) => { if (!pending) setOpen(next); }} open={open}>
      <DialogContent finalFocus={() => focusReturn.current?.isConnected ? focusReturn.current : null} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>确认创建新采集尝试</DialogTitle>
          <DialogDescription>新尝试可能再次产生外部调用及费用。原尝试和证据保留；服务端会重新校验资格、预算和配置。尝试 {target?.attempt_no} · Revision {target?.revision}。</DialogDescription>
        </DialogHeader>
        {Boolean(error) && <p className="break-words text-sm text-danger" role="alert">{error instanceof Error ? error.message : '创建失败'}{held === 'unknown' || held === 'pending' ? ' 结果未知，仅允许读取尝试链确认。' : ' 请重新读取运行并再次确认。'}</p>}
        {!canConfirm && !held && <p className="text-sm">运行正在刷新、已变化或当前没有重试动作，请重新读取。</p>}
        {(held || !canConfirm) && <Button disabled={reading} onClick={() => void reload()} type="button" variant="outline">读取最新尝试链</Button>}
        <DialogFooter>
          <Button disabled={pending} onClick={() => setOpen(false)} type="button" variant="outline">取消</Button>
          <Button disabled={!canConfirm || pending || !csrfToken} onClick={() => void confirm()} type="button">{pending ? '处理中…' : '确认创建新尝试'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
export { RunRetry };
