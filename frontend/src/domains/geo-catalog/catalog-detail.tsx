import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { RowActions } from '@/design-system/data-table/row-actions';
import type { OverflowRowAction } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import { CatalogRequestError, catalogKeys, deleteAlias, deleteDomain, deleteSubject, setSubjectActive } from './catalog.api';
import { aliasKindLabels, blockerLabels, domainRelationLabels, stageLabels, subjectTypeLabels, shouldBlockCatalogNavigation, type Subject } from './catalog.model';
import { CatalogNotice, catalogErrorMessage } from './catalog-controls';
import { CatalogSubjectForm } from './catalog-subject-form';
import { CatalogAliasForm, CatalogDomainForm } from './catalog-dictionary-form';

type Editor = { kind: 'subject' } | { kind: 'alias'; alias?: Subject['aliases'][number] } | { kind: 'domain' };
type Intent = { kind: 'ENABLE' | 'DISABLE' | 'DELETE' | 'ALIAS_DELETE' | 'DOMAIN_DELETE'; revision: number; childId?: string; label: string; focus: HTMLElement | null };
function CatalogDetail({ subject, csrfToken, onSaved, onDeleted, onReload, onParentFilter }: {
  subject: Subject; csrfToken: string | null; onSaved: (subject: Subject) => void; onDeleted: () => void;
  onReload: () => Promise<Subject>; onParentFilter: () => void;
}) {
  const client = useQueryClient();
  const [editor, setEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [intent, setIntent] = useState<Intent>();
  const [commandError, setCommandError] = useState<unknown>();
  const [reloadPending, setReloadPending] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const finalFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ target, continuation }: { target: Intent; continuation: PrincipalContinuation }) => {
      await client.cancelQueries({ queryKey: catalogKeys.detail(subject.id) });
      continuation.assertCurrent();
      switch (target.kind) {
        case 'ENABLE': return setSubjectActive(subject.id, target.revision, true, csrfToken);
        case 'DISABLE': return setSubjectActive(subject.id, target.revision, false, csrfToken);
        case 'DELETE': await deleteSubject(subject.id, target.revision, csrfToken); return undefined;
        case 'ALIAS_DELETE': return deleteAlias(subject.id, target.childId!, target.revision, csrfToken);
        case 'DOMAIN_DELETE': return deleteDomain(subject.id, target.childId!, target.revision, csrfToken);
      }
    },
  });
  function begin(kind: Intent['kind'], label: string, childId?: string, focus?: HTMLElement | null) {
    setCommandError(undefined);
    finalFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setIntent({ kind, label, childId, revision: subject.revision, focus: focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) });
  }
  async function confirm() {
    if (!intent || inFlight.current || !canConfirm || held) return;
    let continuation: PrincipalContinuation | undefined;
    inFlight.current = true;
    const target = intent;
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ target, continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: catalogKeys.detail(subject.id) });
      if (!continuation.isCurrent() || !mounted.current) return;
      setIntent(undefined);
      setCommandError(undefined);
      if (canonical) {
        client.setQueryData(catalogKeys.detail(canonical.id), canonical);
        onSaved(canonical);
        setMessage(`${target.label}已完成。`);
      } else onDeleted();
    } catch (error) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) setCommandError(error);
    } finally { inFlight.current = false; }
  }
  async function reloadIntent() {
    let continuation: PrincipalContinuation | undefined;
    setReloadPending(true);
    try {
      continuation = capturePrincipalContinuation(client);
      const latest = await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      setIntent((current) => current ? { ...current, revision: latest.revision } : undefined);
      setCommandError(undefined);
    } catch (error) { if ((!continuation || continuation.isCurrent()) && mounted.current) setCommandError(error); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setReloadPending(false); }
  }
  function saved(canonical: Subject) {
    onSaved(canonical);
    setMessage('已保存当前配置；历史快照保持不变。');
    setDirty(false);
    if (editor?.kind !== 'subject') setEditor(undefined);
  }
  function closeEditor() { if (dirty) setDiscard(true); else setEditor(undefined); }
  const held = commandError instanceof CatalogRequestError && commandError.status === 409;
  const canConfirm = intent?.kind === 'ALIAS_DELETE'
    ? subject.aliases.some((item) => item.id === intent.childId && item.available_actions.includes('DELETE'))
    : intent?.kind === 'DOMAIN_DELETE'
      ? subject.domains.some((item) => item.id === intent.childId && item.available_actions.includes('DELETE'))
      : intent ? subject.available_actions.includes(intent.kind) : false;
  const common = { subject, csrfToken, onSaved: saved, onReload, onCancel: closeEditor, onDirtyChange };
  const overflow: OverflowRowAction[] = subject.available_actions.flatMap((action): OverflowRowAction[] => {
    switch (action) {
      case 'UPDATE': return [{ key: action, command: action, label: '编辑对象', enabled: !editor, intent: 'secondary' }];
      case 'ENABLE': return [{ key: action, command: action, label: '启用对象', enabled: !editor, intent: 'secondary', confirmation: 'custom' }];
      case 'DISABLE': return [{ key: action, command: action, label: '停用对象', enabled: !editor, intent: 'secondary', confirmation: 'custom' }];
      case 'DELETE': return [{ key: action, command: action, label: '删除对象', enabled: !editor, intent: 'danger', confirmation: 'custom' }];
      case 'CREATE_ALIAS': case 'CREATE_DOMAIN': return [];
      default: return assertNever(action);
    }
  });
  return <section aria-label="监测对象详情" className="min-w-0 space-y-5 rounded-xl border border-border-default bg-surface-panel p-4">
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockCatalogNavigation(current, next)} when={mutation.isPending || reloadPending} />
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <h2 className="type-section-title break-words">{subject.display_name}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{subjectTypeLabels[subject.subject_type]}</Badge><Badge variant={subject.workflow_stage === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[subject.workflow_stage]}</Badge><span>Revision {subject.revision}</span></div>
      </div>
      <div className="shrink-0"><RowActions objectLabel={subject.display_name} onCommand={(action, focus) => {
        if (action === 'UPDATE') setEditor({ kind: 'subject' });
        else if (action === 'ENABLE' || action === 'DISABLE' || action === 'DELETE') begin(action, action === 'ENABLE' ? '启用对象' : action === 'DISABLE' ? '停用对象' : '删除对象', undefined, focus);
        else throw new Error(`未处理的 Catalog 命令：${action}`);
      }} overflow={overflow} /></div>
    </header>
    {message && <CatalogNotice>{message}</CatalogNotice>}
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-text-muted">规范名称</dt><dd className="break-words">{subject.canonical_name}</dd></div>
      <div><dt className="text-text-muted">父级品牌</dt><dd className="break-words">{subject.parent?.display_name ?? '无父级'}{subject.parent && !subject.parent.is_active && '（停用）'}</dd></div>
      {subject.product && <div><dt className="text-text-muted">当前产品身份（只读）</dt><dd className="break-words">{subject.product.brand} · {subject.product.part_number} · {subject.product.category} · Product Revision {subject.product.revision}</dd></div>}
      <div><dt className="text-text-muted">监测说明</dt><dd className="whitespace-pre-wrap break-words">{subject.description || '未填写'}</dd></div>
    </dl>
    {subject.available_actions.length === 0 && <CatalogNotice>当前为只读视图。监测对象、别名和域名由管理员维护。</CatalogNotice>}
    {editor?.kind === 'subject' && <CatalogSubjectForm {...common} />}
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="type-section-title">别名</h3>{subject.available_actions.includes('CREATE_ALIAS') && !editor && <Button onClick={() => setEditor({ kind: 'alias' })} type="button" variant="outline">新增别名</Button>}</div>
      <p className="text-sm text-text-muted">同对象别名唯一；跨对象同名保留歧义候选。当前字典修改只影响未来快照。</p>
      {subject.aliases.length === 0 ? <p role="status">尚无别名。</p> : <ul className="space-y-2">{subject.aliases.map((alias) => <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-2" key={alias.id}>
        <div className="min-w-0"><p className="break-words font-medium">{alias.alias}</p><p className="text-sm text-text-muted">{aliasKindLabels[alias.alias_kind]} · {alias.language_code ?? '未指定语言'} · {alias.is_active ? '启用' : '停用'}</p></div>
        <div className="shrink-0"><RowActions objectLabel={alias.alias} onCommand={(action, focus) => { if (action === 'UPDATE') setEditor({ kind: 'alias', alias }); else if (action === 'DELETE') begin('ALIAS_DELETE', `删除别名 ${alias.alias}`, alias.id, focus); else throw new Error(`未处理的别名命令：${action}`); }} overflow={alias.available_actions.map((action): OverflowRowAction => {
          switch (action) {
            case 'UPDATE': return { key: action, command: action, label: '编辑别名', enabled: !editor, intent: 'secondary' };
            case 'DELETE': return { key: action, command: action, label: '删除别名', enabled: !editor, intent: 'danger', confirmation: 'custom' };
            default: return assertNever(action);
          }
        })} /></div>
      </li>)}</ul>}
      {editor?.kind === 'alias' && <CatalogAliasForm {...common} alias={editor.alias} key={editor.alias?.id ?? 'new-alias'} />}
    </section>
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="type-section-title">域名</h3>{subject.available_actions.includes('CREATE_DOMAIN') && !editor && <Button onClick={() => setEditor({ kind: 'domain' })} type="button" variant="outline">新增域名</Button>}</div>
      <p className="text-sm text-text-muted">精确 hostname 配置；不执行网络验证。修改域名需删除后重建。</p>
      {subject.domains.length === 0 ? <p role="status">尚无域名。</p> : <ul className="space-y-2">{subject.domains.map((domain) => <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-2" key={domain.id}>
        <div className="min-w-0"><p className="break-all font-medium">{domain.hostname}</p><p className="text-sm text-text-muted">{domainRelationLabels[domain.relation_type]}</p></div>
        <div className="shrink-0"><RowActions objectLabel={domain.hostname} onCommand={(action, focus) => { if (action !== 'DELETE') throw new Error(`未处理的域名命令：${action}`); begin('DOMAIN_DELETE', `删除域名 ${domain.hostname}`, domain.id, focus); }} overflow={domain.available_actions.map((action): OverflowRowAction => {
          switch (action) {
            case 'DELETE': return { key: action, command: action, label: '删除域名', enabled: !editor, intent: 'danger', confirmation: 'custom' };
            default: return assertNever(action);
          }
        })} /></div>
      </li>)}</ul>}
      {editor?.kind === 'domain' && <CatalogDomainForm {...common} />}
    </section>
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <h3 className="type-section-title">直接引用与删除条件</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><li>子对象 {subject.references.child_subject_count}</li><li>监测计划 {subject.references.monitoring_plan_count}</li><li>观测运行 {subject.references.observation_run_count}</li><li>分析 {subject.references.analysis_count}</li><li>机会 {subject.references.opportunity_count}</li></ul>
      {subject.deletion && <CatalogNotice>{subject.deletion.blockers.length === 0 ? '服务端当前未返回删除阻断；删除命令会再次核实引用和版本。' : <><p>当前不能删除，可维护配置或停用。阻断由服务端返回：</p><ul>{subject.deletion.blockers.map((blocker) => <li key={blocker.type}>{blockerLabels[blocker.type]}：{blocker.count}{blocker.type === 'CHILD_SUBJECT' && <Button onClick={onParentFilter} size="sm" type="button" variant="link">查看子对象</Button>}</li>)}</ul></>}</CatalogNotice>}
    </section>
    <Dialog onOpenChange={(open) => { if (!open && !mutation.isPending) setIntent(undefined); }} open={Boolean(intent)}>
      <DialogContent finalFocus={() => finalFocus.current?.isConnected ? finalFocus.current : null} showCloseButton={!mutation.isPending}>
        <DialogHeader><DialogTitle>确认{intent?.label}</DialogTitle><DialogDescription>{intent?.kind === 'DELETE' ? '删除对象会清理其当前别名和域名，不能撤销；不会删除产品或历史引用。' : intent?.kind === 'ENABLE' || intent?.kind === 'DISABLE' ? '只改变当前监测身份的启用状态，不改写历史。' : '只删除当前字典条目，不改写历史快照。'}版本 {intent?.revision}。</DialogDescription></DialogHeader>
        {Boolean(commandError) && <CatalogNotice error>{catalogErrorMessage(commandError)}</CatalogNotice>}
        {!canConfirm && <p role="alert">服务端当前未提供该动作，请关闭或重新读取。</p>}
        {(held || !canConfirm) && <Button disabled={reloadPending} onClick={() => void reloadIntent()} type="button" variant="outline">重新读取并重新确认</Button>}
        <DialogFooter><Button disabled={mutation.isPending} onClick={() => setIntent(undefined)} type="button" variant="outline">关闭</Button><Button disabled={!canConfirm || held || mutation.isPending || reloadPending} onClick={() => void confirm()} type="button" variant={intent?.kind.includes('DELETE') ? 'destructive' : 'default'}>{mutation.isPending ? '提交中…' : '确认操作'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={setDiscard} open={discard}><DialogContent><DialogHeader><DialogTitle>放弃未保存的修改？</DialogTitle><DialogDescription>关闭编辑会丢弃当前表单的本地输入。</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDiscard(false)} type="button" variant="outline">继续编辑</Button><Button onClick={() => { setDiscard(false); setEditor(undefined); setDirty(false); }} type="button" variant="destructive">放弃修改并关闭</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
function assertNever(value: never): never { throw new Error(`Catalog 返回未知动作：${String(value)}`); }
export { CatalogDetail };
