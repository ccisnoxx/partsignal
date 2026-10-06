import { useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { assertPrincipalCommandOpen, capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { RowActions } from '@/design-system/data-table/row-actions';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import { CatalogNotice } from './catalog-controls';
import { browserSessionKeys, browserSessionQueryOptions, BrowserSessionRequestError, checkBrowserSessionHealth, importBrowserSession, purgeBrowserSessions, revokeBrowserSession, type BrowserSessionAction, type BrowserSessionContext } from './browser-session.api';
import { surfacesKeys } from './surfaces.api';
import { shouldBlockSurfacesNavigation } from './surfaces-search.model';

const labels = { IMPORT: '导入浏览器会话', CHECK_HEALTH: '检查存储健康', REVOKE: '撤销浏览器会话', PURGE: '清理已撤销会话' } satisfies Record<BrowserSessionAction, string>;
const healthLabels = { AVAILABLE: '受保护材料完整且在有效期内', EXPIRED: '已过期', REVOKED: '已撤销', MISSING: '受保护材料缺失', UNREADABLE: '受保护材料无法读取' } satisfies Record<NonNullable<BrowserSessionContext['session']>['health'], string>;
const importSchema = z.object({
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now(), '请选择未来的有效期。'),
  approved: z.boolean().refine(Boolean, '请确认此专用账号已获批准。'),
});
type ImportFields = z.infer<typeof importSchema>;
type Intent = { action: BrowserSessionAction; revision: number; reference: string | null };

function BrowserSessionPanel({ profileId, token, unavailable = false }: { profileId: string; token: string | null; unavailable?: boolean }) {
  const client = useQueryClient();
  const key = browserSessionKeys.context(profileId);
  const form = useForm<ImportFields>({ resolver: zodResolver(importSchema), defaultValues: { expiresAt: '', approved: false } });
  const [intent, setIntent] = useState<Intent>();
  const [failure, setFailure] = useState<BrowserSessionRequestError>();
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [message, setMessage] = useState('');
  const [expiredPrincipal, setExpiredPrincipal] = useState(false);
  const query = useQuery({ ...browserSessionQueryOptions(profileId), enabled: !expiredPrincipal });
  const file = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  function releaseFile() { file.current = null; if (fileInput.current) fileInput.current.value = ''; }
  useEffect(() => {
    mounted.current = true;
    const lifetime = capturePrincipalContinuation(client);
    let invalidated = false;
    const unsubscribe = client.getQueryCache().subscribe(() => {
      if (!invalidated && !lifetime.isCurrent()) {
        invalidated = true;
        releaseFile(); controller.current?.abort();
        setHasFile(false); setIntent(undefined); setExpiredPrincipal(true); form.reset();
      }
    });
    return () => { mounted.current = false; releaseFile(); controller.current?.abort(); unsubscribe(); };
  }, [client, profileId, token, form]);

  const context = query.data;
  const terminal = [query.error, failure].some((error) => error instanceof BrowserSessionRequestError && [401, 403, 404].includes(error.status ?? 0));
  const readable = Boolean(context && !query.isFetching && !query.error && !terminal && !unavailable && !expiredPrincipal && token);
  const matching = Boolean(intent && context && intent.revision === context.profile_revision && intent.reference === (context.session?.session_reference ?? null));
  const canConfirm = Boolean(readable && matching && intent && context?.available_actions.includes(intent.action));
  const snapshot = (action: BrowserSessionAction, value: BrowserSessionContext): Intent => ({ action, revision: value.profile_revision, reference: value.session?.session_reference ?? null });

  function close() { if (inFlight.current) return; releaseFile(); setHasFile(false); form.reset(); setIntent(undefined); if (!terminal) setFailure(undefined); }
  function begin(action: BrowserSessionAction, focus?: HTMLElement | null) {
    if (!context || !readable || busy) return;
    returnFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setFailure(undefined); setMessage(''); setIntent(snapshot(action, context));
  }
  async function reload() {
    if (inFlight.current || terminal) return;
    inFlight.current = true; setBusy(true);
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      await client.cancelQueries({ queryKey: key, exact: true });
      continuation.assertCurrent();
      const current = await client.fetchQuery({ ...browserSessionQueryOptions(profileId), staleTime: 0 });
      if (!continuation.isCurrent() || !mounted.current) return;
      setHeld(false); setFailure(undefined);
      if (intent) setIntent(snapshot(intent.action, current));
      form.setValue('approved', false);
      setMessage('已重新读取，请核对当前会话并再次确认。');
    } catch (error) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) setFailure(error instanceof BrowserSessionRequestError ? error : new BrowserSessionRequestError('重新读取未完成。'));
    } finally { inFlight.current = false; if ((!continuation || continuation.isCurrent()) && mounted.current) setBusy(false); }
  }

  async function confirm() {
    if (!intent || inFlight.current || held || !canConfirm) return;
    const state = client.getQueryState(key);
    const current = client.getQueryData<BrowserSessionContext>(key);
    if (!current || state?.fetchStatus === 'fetching' || state?.error || !current.available_actions.includes(intent.action) || current.profile_revision !== intent.revision || (current.session?.session_reference ?? null) !== intent.reference) {
      setFailure(new BrowserSessionRequestError('当前会话已经变化，请重新读取并重新确认。')); return;
    }
    // 同步锁覆盖字段验证、File.text 与网络等待，重复确认只能产生一次写请求。
    inFlight.current = true; setBusy(true);
    let continuation: PrincipalContinuation | undefined;
    let committed = false;
    const requestController = new AbortController(); controller.current = requestController;
    try {
      continuation = capturePrincipalContinuation(client);
      let canonical: BrowserSessionContext;
      if (intent.action === 'IMPORT') {
        if (!await form.trigger(undefined, { shouldFocus: true })) return;
        const selected = file.current;
        if (!selected || selected.size === 0 || selected.size > 131072) throw new BrowserSessionRequestError('请选择非空且不超过 128 KiB 的会话 JSON 文件。');
        // 明文只存在于本次调用的局部变量，不经过 MutationCache、表单或 QueryCache。
        const storageState = await selected.text();
        continuation.assertCurrent(); assertPrincipalCommandOpen(client); requestController.signal.throwIfAborted();
        if (!mounted.current) return;
        const latest = client.getQueryData<BrowserSessionContext>(key);
        const latestState = client.getQueryState(key);
        if (!latest || latestState?.fetchStatus === 'fetching' || latestState?.error || latest.profile_revision !== current.profile_revision || !latest.available_actions.includes('IMPORT')) throw new BrowserSessionRequestError('文件读取期间会话已经变化，请重新读取并重新确认。', 409);
        const values = form.getValues();
        canonical = await importBrowserSession(profileId, { expected_revision: current.profile_revision, storage_state: storageState, expires_at: new Date(values.expiresAt).toISOString(), approved_account: true }, token, requestController.signal);
      } else if (intent.action === 'PURGE') {
        continuation.assertCurrent(); assertPrincipalCommandOpen(client);
        canonical = await purgeBrowserSessions(profileId, current.profile_revision, token, requestController.signal);
      } else {
        if (!current.session) throw new BrowserSessionRequestError('当前响应缺少会话引用，请重新读取。');
        const body = { expected_revision: current.profile_revision, session_reference: current.session.session_reference };
        continuation.assertCurrent(); assertPrincipalCommandOpen(client);
        canonical = intent.action === 'CHECK_HEALTH' ? await checkBrowserSessionHealth(profileId, body, token, requestController.signal) : await revokeBrowserSession(profileId, body, token, requestController.signal);
      }
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: key, exact: true });
      if (!continuation.isCurrent() || !mounted.current) return;
      client.setQueryData(key, canonical); committed = true;
      releaseFile(); setHasFile(false); form.reset(); setIntent(undefined); setFailure(undefined);
      setMessage(`${labels[intent.action]}已完成。${canonical.cleanup_pending_count ? `仍有 ${canonical.cleanup_pending_count} 份已撤销材料待清理，请使用清理操作。` : ''}`);
      const consumers = { predicate: (value: { queryKey: readonly unknown[] }) => value.queryKey[0] === 'geo' && value.queryKey[1] === 'surface-management' && value.queryKey[2] === 'list' && value.queryKey[3] === 'profiles' };
      await Promise.all([client.cancelQueries({ queryKey: surfacesKeys.profile(profileId), exact: true }), client.cancelQueries(consumers)]);
      if (!continuation.isCurrent() || !mounted.current) return;
      await Promise.all([client.invalidateQueries({ queryKey: surfacesKeys.profile(profileId), exact: true }, { throwOnError: true }), client.invalidateQueries(consumers, { throwOnError: true })]);
    } catch (error) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) {
        const safe = error instanceof BrowserSessionRequestError ? error : new BrowserSessionRequestError('浏览器会话请求未完成，请重新读取以核实结果。');
        if (committed) setMessage('会话操作已完成，但采集配置刷新失败，请重新读取配置详情。');
        else {
          setFailure(safe); if (safe.status === 409 || safe.requiresReload) setHeld(true);
          if (safe.status !== 409) { releaseFile(); setHasFile(false); }
        }
      }
    } finally {
      inFlight.current = false;
      if ((!continuation || continuation.isCurrent()) && mounted.current) { setBusy(false); controller.current = null; }
    }
  }

  return <section aria-label="浏览器会话" className="min-w-0 space-y-3 border-t border-border-subtle pt-3">
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockSurfacesNavigation(current, next)} when={busy} />
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="type-section-title">浏览器会话</h3>{context && <RowActions objectLabel="浏览器会话" onCommand={(action, focus) => {
      if (action === 'IMPORT' || action === 'CHECK_HEALTH' || action === 'REVOKE' || action === 'PURGE') begin(action, focus);
      else throw new Error('浏览器会话返回未知动作');
    }} overflow={context.available_actions.map((action) => ({ key: action, command: action, label: labels[action], enabled: readable && !busy, intent: action === 'REVOKE' ? 'danger' : 'secondary', confirmation: 'custom' }))} />}</header>
    <p className="text-sm text-text-secondary">存储健康只证明受保护材料完整性与有效期，不证明平台登录仍有效。在线登录探测尚未实现（{context?.login_probe ?? 'NOT_IMPLEMENTED'}）。导入不启用采集配置。</p>
    {query.isPending && <CatalogNotice>正在读取浏览器会话…</CatalogNotice>}
    {query.error && <CatalogNotice error>{query.error instanceof BrowserSessionRequestError ? query.error.message : '浏览器会话读取失败。'}{context && <p>上次会话信息仍显示，当前操作已暂停。</p>}{!terminal && <Button disabled={busy || query.isFetching} onClick={() => void reload()} type="button" variant="outline">重新读取会话</Button>}</CatalogNotice>}
    {query.isFetching && context && <p role="status">正在刷新浏览器会话，当前操作已暂停…</p>}
    {context && <><p className="text-sm">会话上下文 Revision {context.profile_revision}</p>{context.session ? <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-text-muted">存储健康</dt><dd>{healthLabels[context.session.health]}</dd></div>
      <div><dt className="text-text-muted">会话引用</dt><dd className="break-all">{context.session.session_reference}</dd></div>
      <div><dt className="text-text-muted">有效期</dt><dd>{new Date(context.session.expires_at).toLocaleString('zh-CN')}</dd></div>
      <div><dt className="text-text-muted">最近检查</dt><dd>{new Date(context.session.last_checked_at).toLocaleString('zh-CN')}</dd></div>
      {context.session.revoked_at && <div><dt className="text-text-muted">撤销时间</dt><dd>{new Date(context.session.revoked_at).toLocaleString('zh-CN')}。旧引用无法恢复；请重新导入创建新引用。</dd></div>}
      {context.session.purged_at && <div><dt className="text-text-muted">清理时间</dt><dd>{new Date(context.session.purged_at).toLocaleString('zh-CN')}</dd></div>}
    </dl> : <CatalogNotice>尚未导入浏览器会话。使用已获批准的专用账号人工登录后导出的 Playwright storage state。</CatalogNotice>}
      {context.cleanup_pending_count > 0 && <CatalogNotice>有 {context.cleanup_pending_count} 份已撤销材料待清理；撤销已生效，请从更多操作执行清理。</CatalogNotice>}
      {!context.available_actions.length && <CatalogNotice>服务端当前未提供会话管理动作。</CatalogNotice>}
    </>}
    {message && <CatalogNotice>{message}</CatalogNotice>}
    {failure && !intent && <CatalogNotice error>{failure.message}</CatalogNotice>}
    {held && !intent && <CatalogNotice error>旧会话上下文已冻结，请重新读取后再操作。<Button disabled={busy || query.isFetching} onClick={() => void reload()} type="button" variant="outline">重新读取会话</Button></CatalogNotice>}
    <Dialog onOpenChange={(open) => { if (!open) close(); }} open={Boolean(intent)}>
      <DialogContent className="sm:max-w-lg" finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : null} showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{intent ? labels[intent.action] : '浏览器会话'}</DialogTitle><DialogDescription>当前会话上下文 Revision {context?.profile_revision}。{intent?.action === 'IMPORT' ? '文件仅用于此次导入，不显示内容。新导入会替换并永久撤销旧引用；采集配置仍保持停用。' : intent?.action === 'REVOKE' ? '撤销立即阻断旧引用访问且不可复活；恢复需要重新导入。材料删除失败会明确保留清理待办。' : intent?.action === 'PURGE' ? '仅清理已撤销材料，不改变有效会话或撤销历史。' : '只检查受保护材料完整性与有效期，不访问平台、不探测登录。'}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
          {intent?.action === 'IMPORT' && <>
            <div className="space-y-2"><label htmlFor="browser-session-file">会话 JSON 文件</label><Input accept=".json,application/json" disabled={busy} id="browser-session-file" onChange={(event) => { file.current = event.target.files?.[0] ?? null; setHasFile(Boolean(file.current)); }} ref={fileInput} type="file" /><p className="text-sm text-text-muted">仅接受人工导出的 Playwright storage state，最大 128 KiB。不会预览 Cookie 或存储正文。</p></div>
            <div className="space-y-2"><label htmlFor="browser-session-expiry">有效期（本地时间）</label><Input {...form.register('expiresAt')} aria-describedby="browser-session-expiry-error" aria-invalid={Boolean(form.formState.errors.expiresAt)} disabled={busy} id="browser-session-expiry" type="datetime-local" />{form.formState.errors.expiresAt && <p className="text-sm text-danger" id="browser-session-expiry-error" role="alert">{form.formState.errors.expiresAt.message}</p>}</div>
            <div className="space-y-2"><label className="flex items-start gap-2"><input {...form.register('approved')} aria-describedby="browser-session-approved-error" aria-invalid={Boolean(form.formState.errors.approved)} disabled={busy} type="checkbox" /><span>确认此专用账号已获批准用于此观测面</span></label>{form.formState.errors.approved && <p className="text-sm text-danger" id="browser-session-approved-error" role="alert">{form.formState.errors.approved.message}</p>}</div>
          </>}
          {failure && <CatalogNotice error>{failure.message}</CatalogNotice>}
          {!canConfirm && <CatalogNotice error>当前上下文不可用于此操作，请显式重新读取并确认。</CatalogNotice>}
          {(held || failure || !canConfirm) && !terminal && <Button disabled={busy || query.isFetching} onClick={() => void reload()} type="button" variant="outline">重新读取并重新确认</Button>}
          <DialogFooter><Button disabled={busy} onClick={close} type="button" variant="outline">取消</Button><Button disabled={busy || held || !canConfirm || intent?.action === 'IMPORT' && !hasFile} type="submit" variant={intent?.action === 'REVOKE' ? 'destructive' : 'default'}>{busy ? '提交中…' : '确认操作'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}

export { BrowserSessionPanel };
