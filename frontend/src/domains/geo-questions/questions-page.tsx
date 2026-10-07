import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/design-system/primitives/sheet';
import type { components } from '@/shared/api/generated/schema';
import { QuestionRequestError, questionDetailOptions, questionKeys } from './questions.api';
import { questionEditorIdentity, questionSearchSchema, type PromptVariant, type QuestionSearch } from './questions.model';
import type { QuestionCommand } from './question-actions';
import { QuestionNotice, questionErrorMessage } from './question-controls';
import { QuestionDetail, type QuestionDetailHandle } from './question-detail';
import { QuestionForm } from './question-form';
import { QuestionList } from './question-list';

function QuestionsPage({ search, csrfToken, onSearchChange }: {
  search: QuestionSearch; csrfToken: string | null;
  onSearchChange: (next: QuestionSearch, replace?: boolean, ignoreBlocker?: boolean) => void;
}) {
  const client = useQueryClient();
  const selectedId = search.selected ?? search.copy;
  const detail = useQuery(questionDetailOptions(selectedId ?? '', Boolean(selectedId)));
  const [request, setRequest] = useState<{ id: string; command?: QuestionCommand }>();
  const [refreshError, setRefreshError] = useState<unknown>();
  const latestSearch = useRef(search);
  const mounted = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const detailActions = useRef<QuestionDetailHandle | null>(null);
  useEffect(() => { latestSearch.current = search; }, [search]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = questionEditorIdentity(search);
  const open = useCallback((variant: PromptVariant, command?: QuestionCommand, focus?: HTMLElement | null) => {
    returnFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (latestSearch.current.selected === variant.id && command && command !== 'COPY') {
      detailActions.current?.request(command, focus);
      return;
    }
    setRequest({ id: variant.id, command });
    onSearchChange(questionSearchSchema.parse({ ...latestSearch.current, new: undefined, selected: command === 'COPY' ? undefined : variant.id, copy: command === 'COPY' ? variant.id : undefined }));
  }, [onSearchChange]);
  async function refreshLists() {
    let continuation: PrincipalContinuation | undefined;
    setRefreshError(undefined);
    try {
      continuation = capturePrincipalContinuation(client);
      await client.cancelQueries({ queryKey: questionKeys.lists() });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.invalidateQueries({ queryKey: questionKeys.lists() }, { throwOnError: true });
    }
    catch (error) { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshError(error); }
  }
  function saved(variant: PromptVariant) {
    void refreshLists();
    const current = latestSearch.current;
    if (current.new || current.copy) onSearchChange(questionSearchSchema.parse({ ...current, new: undefined, copy: undefined, selected: variant.id }), true, true);
  }
  function deleted(id: string) {
    // 在清理 URL 前过滤集合，详情 observer 仍活跃时只标记失效，避免重新 GET 已删除对象。
    client.setQueriesData<components['schemas']['GeoPromptVariantListPage']>({ queryKey: questionKeys.lists() }, (current) => current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current);
    void client.invalidateQueries({ queryKey: questionKeys.detail(id), refetchType: 'none' });
    onSearchChange(questionSearchSchema.parse({ ...latestSearch.current, selected: undefined }), true, true);
    void refreshLists();
  }
  async function reload() {
    const requestedId = selectedId;
    if (!requestedId) throw new Error('没有可读取的问题变体');
    const continuation = capturePrincipalContinuation(client);
    const requestedIdentity = identity;
    await client.cancelQueries({ queryKey: questionKeys.detail(requestedId) });
    continuation.assertCurrent();
    const canonical = await client.fetchQuery({ ...questionDetailOptions(requestedId), staleTime: 0 });
    continuation.assertCurrent();
    if (!mounted.current || questionEditorIdentity(latestSearch.current) !== requestedIdentity) throw new Error('当前变体已切换，已丢弃旧读取结果');
    return canonical;
  }
  const close = () => onSearchChange(questionSearchSchema.parse({ ...latestSearch.current, selected: undefined, copy: undefined, new: undefined }));
  const unrecoverable = detail.error instanceof QuestionRequestError && (detail.error.status === 403 || detail.error.status === 404);
  const readState = <>
    {detail.data && detail.error && <QuestionNotice error>后台读取失败，本地输入已保留：{questionErrorMessage(detail.error)}{!unrecoverable && <Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情读取</Button>}{unrecoverable && <p>资源已不可访问，当前输入保留供核对；请关闭详情。</p>}</QuestionNotice>}
    {detail.isFetching && <p role="status">正在读取变体详情…</p>}
    {!detail.data && (detail.isPending ? <QuestionNotice>正在读取变体…</QuestionNotice> : <QuestionNotice error>{questionErrorMessage(detail.error)}{!unrecoverable && <Button onClick={() => void detail.refetch()} type="button" variant="outline">重试详情读取</Button>}<Button onClick={close} type="button" variant="outline">关闭详情</Button></QuestionNotice>)}
  </>;
  return <section aria-labelledby="questions-title" className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><h1 className="type-page-title" id="questions-title">问题库</h1><p className="max-w-3xl text-text-secondary">管理主题下的实际提问变体，显式维护点名属性、语言、地区和优先级。</p></div><Button onClick={(event) => { returnFocus.current = event.currentTarget; onSearchChange(questionSearchSchema.parse({ ...search, selected: undefined, copy: undefined, new: 1 })); }} type="button">新建问题变体</Button></header>
    {Boolean(refreshError) && <QuestionNotice error>操作已完成，但列表刷新失败：{questionErrorMessage(refreshError)}<Button onClick={() => void refreshLists()} type="button" variant="outline">重新读取列表</Button></QuestionNotice>}
    <QuestionList onChange={onSearchChange} onOpen={open} search={search} />
    {(search.new || search.copy) && <section aria-label="问题变体创建工作区" className="space-y-4 rounded-xl border border-border-default bg-surface-panel p-4"><h2 className="type-section-title">{search.copy ? '复制为新变体' : '新建问题变体'}</h2>{search.copy && readState}{search.new || detail.data ? <QuestionForm copying={Boolean(search.copy)} csrfToken={csrfToken} key={identity} onCancel={close} onSaved={saved} readBlocked={Boolean(search.copy) && unrecoverable} variant={search.copy ? detail.data : undefined} /> : null}</section>}
    <Sheet onOpenChange={(open) => { if (!open) close(); }} open={Boolean(search.selected)}>
      {search.selected && <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : null}>
        <SheetHeader><SheetTitle>问题变体工作区</SheetTitle><SheetDescription>查看完整语义、服务端动作与删除条件。</SheetDescription></SheetHeader>
        <div className="min-w-0 space-y-4 px-4 pb-6">{readState}{detail.data && <QuestionDetail csrfToken={csrfToken} initialAction={request?.id === search.selected ? request.command : undefined} key={identity} onCopy={() => onSearchChange(questionSearchSchema.parse({ ...latestSearch.current, selected: undefined, copy: search.selected }))} onDeleted={deleted} onReload={reload} onSaved={saved} readBlocked={unrecoverable} ref={detailActions} variant={detail.data} />}</div>
      </SheetContent>}
    </Sheet>
  </section>;
}
export { QuestionsPage };
