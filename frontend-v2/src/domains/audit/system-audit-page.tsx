import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/design-system/primitives/sheet';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { AuditDetailContent, OutcomeBadge, actorLabel, formatTime } from './audit-detail-content';
import {
  auditDetailQueryOptions,
  auditFilterOptionsQueryOptions,
  auditListQueryOptions,
} from './audit.api';
import {
  auditActionLabel,
  auditModuleLabels,
  auditModuleValues,
  auditOutcomeLabels,
  auditOutcomeValues,
  auditResetSearch,
  fromBeijingDateTimeInput,
  normalizeAuditPageSize,
  toBeijingDateTimeInput,
  type AuditLog,
  type AuditSearch,
} from './audit.model';

const columnRoles = ['date', 'metadata', 'metadata', 'primary', 'metadata', 'status', 'metadata'] as const satisfies readonly ColumnRole[];
const desktopQuery = '(min-width: 1280px)';

type SystemAuditPageProps = {
  onSearchChange: (search: AuditSearch, replace?: boolean) => Promise<void> | void;
  search: AuditSearch;
};

function SystemAuditPage({ onSearchChange, search }: SystemAuditPageProps) {
  const logs = useQuery(auditListQueryOptions(search));
  const options = useQuery(auditFilterOptionsQueryOptions());
  const desktop = useSyncExternalStore(subscribeToDesktop, isDesktop, () => false);
  const finalFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const normalizingPage = useRef<number | undefined>(undefined);
  const previousLogId = useRef(search.logId);
  const rows = logs.data?.items ?? [];
  const total = logs.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);

  useEffect(() => {
    if (previousLogId.current && !search.logId) {
      (finalFocus.current?.isConnected ? finalFocus.current : heading.current)?.focus({ preventScroll: true });
    }
    previousLogId.current = search.logId;
  }, [search.logId]);

  useEffect(() => {
    if (logs.data && total > 0 && rows.length === 0 && search.page > pageCount && normalizingPage.current !== search.page) {
      normalizingPage.current = search.page;
      void onSearchChange({ ...search, logId: undefined, page: pageCount }, true);
    }
  }, [logs.data, onSearchChange, pageCount, rows.length, search, total]);

  function changeList(changes: Partial<AuditSearch>, resetPage = true) {
    void onSearchChange({
      ...search,
      ...changes,
      logId: undefined,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  function openDetail(log: AuditLog, trigger: HTMLElement) {
    finalFocus.current = trigger;
    void onSearchChange({ ...search, logId: log.id });
  }

  const list = (
    <div className="min-w-0 space-y-4">
      {logs.data && logs.error && (
        <Notice message={`刷新失败，已保留当前列表：${errorMessage(logs.error)}`} onRetry={() => void logs.refetch()} />
      )}
      {options.error && (
        <Notice message={`筛选项加载失败：${errorMessage(options.error)}`} onRetry={() => void options.refetch()} />
      )}
      <AuditFilters
        key={JSON.stringify(search)}
        actions={options.data?.actions ?? []}
        onChange={(next) => changeList(next)}
        search={search}
        targetTypes={options.data?.target_types ?? []}
      />
      <div className="flex justify-end">
        <Button onClick={() => void logs.refetch()} type="button" variant="outline">刷新当前页</Button>
      </div>
      <TableShell className="audit-list-table" regionLabel="系统审计日志">
        <thead>
          <tr>
            <th data-column-role="date" scope="col">时间</th>
            <th data-column-role="metadata" scope="col">操作者</th>
            <th data-column-role="metadata" scope="col">模块</th>
            <th data-column-role="primary" scope="col">动作</th>
            <th data-column-role="metadata" scope="col">对象</th>
            <th data-column-role="status" scope="col">结果</th>
            <th data-column-role="metadata" scope="col">Request ID</th>
          </tr>
        </thead>
        {logs.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : logs.error && !logs.data ? (
          <EmptyTable action={<Button onClick={() => void logs.refetch()} variant="outline">重试</Button>} colSpan={7} description={errorMessage(logs.error)} kind="error" title="审计日志加载失败" />
        ) : total === 0 ? (
          <EmptyTable action={<Button onClick={() => changeList(auditResetSearch())} variant="outline">重置筛选</Button>} colSpan={7} description="当前筛选范围没有审计记录。" kind="filtered-empty" title="未找到审计日志" />
        ) : rows.length === 0 ? (
          <EmptyTable action={<Button onClick={() => changeList({ page: pageCount }, false)} variant="outline">返回最后一页</Button>} colSpan={7} description="URL 指定的页码已超过当前结果范围。" kind="filtered-empty" title="当前页已超出范围" />
        ) : (
          <tbody>
            {rows.map((log) => (
              <AuditRow key={log.id} log={log} onOpen={openDetail} selected={log.id === search.logId} />
            ))}
          </tbody>
        )}
      </TableShell>
      {!logs.isPending && !(logs.error && !logs.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeList({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeList({ pageSize: normalizeAuditPageSize(pageSize) })}
          pageCount={pageCount}
          pageIndex={search.page - 1}
          pageSize={search.pageSize}
          totalItems={total}
        />
      )}
    </div>
  );

  return (
    <section aria-labelledby="system-audit-title" className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="type-page-title outline-none" id="system-audit-title" ref={heading} tabIndex={-1}>系统审计</h1>
        <p className="max-w-3xl text-text-secondary">查询追加式业务审计，并按需查看服务端安全投影的单条详情。</p>
      </header>
      {desktop ? (
        <div className={`grid min-w-0 items-start gap-4${search.logId ? ' grid-cols-[minmax(0,1fr)_28rem]' : ''}`}>
          {list}
          {search.logId && (
            <aside aria-label="审计详情" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border-subtle bg-surface-panel p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div><h2 className="type-section-title">审计详情</h2><p className="text-sm text-text-muted">只展示已登记的安全字段。</p></div>
                <Button aria-label="关闭审计详情" onClick={() => void onSearchChange({ ...search, logId: undefined })} size="sm" variant="ghost">关闭</Button>
              </div>
              <AuditDetailSurface auditLogId={search.logId} />
            </aside>
          )}
        </div>
      ) : (
        <>
          {list}
          <Sheet onOpenChange={(open) => !open && void onSearchChange({ ...search, logId: undefined })} open={Boolean(search.logId)}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-xl" finalFocus={finalFocus}>
              <SheetHeader>
                <SheetTitle>审计详情</SheetTitle>
                <SheetDescription>只展示已登记的安全字段。</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">{search.logId && <AuditDetailSurface auditLogId={search.logId} />}</div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </section>
  );
}

function AuditRow({ log, onOpen, selected }: { log: AuditLog; onOpen: (log: AuditLog, trigger: HTMLElement) => void; selected: boolean }) {
  const action = auditActionLabel(log.action);
  return (
    <tr
      aria-label={`查看审计详情：${action}`}
      aria-selected={selected}
      className="cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
      onClick={(event) => onOpen(log, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen(log, event.currentTarget);
      }}
      tabIndex={0}
    >
      <td className="whitespace-nowrap" data-column-role="date"><time dateTime={log.created_at}>{formatTime(log.created_at)}</time></td>
      <td className="min-w-40" data-column-role="metadata">{actorLabel(log)}</td>
      <td className="whitespace-nowrap" data-column-role="metadata">{auditModuleLabels[log.business_module]}</td>
      <td className="min-w-44" data-column-role="primary"><strong>{action}</strong></td>
      <td className="min-w-52" data-column-role="metadata"><span className="block">{log.target_type}</span><code className="block break-all text-xs text-text-muted">{log.target_id ?? '未记录'}</code></td>
      <td data-column-role="status"><OutcomeBadge outcome={log.outcome} /></td>
      <td className="min-w-48" data-column-role="metadata"><code className="break-all text-xs">{log.request_id}</code></td>
    </tr>
  );
}

function AuditFilters({ actions, onChange, search, targetTypes }: {
  actions: readonly string[];
  onChange: (search: Partial<AuditSearch>) => void;
  search: AuditSearch;
  targetTypes: readonly string[];
}) {
  const actionOptions = search.action && !actions.includes(search.action) ? [search.action, ...actions] : actions;
  const targetTypeOptions = search.targetType && !targetTypes.includes(search.targetType) ? [search.targetType, ...targetTypes] : targetTypes;
  const [draft, setDraft] = useState({
    keyword: search.keyword ?? '', actorId: search.actorId ?? '', module: search.module ?? 'ALL',
    action: search.action ?? 'ALL', targetType: search.targetType ?? 'ALL', targetId: search.targetId ?? '',
    outcome: search.outcome ?? 'ALL', requestId: search.requestId ?? '',
    createdFrom: toBeijingDateTimeInput(search.createdFrom), createdTo: toBeijingDateTimeInput(search.createdTo),
  });
  const [rangeError, setRangeError] = useState<string>();

  function submit() {
    const createdFrom = fromBeijingDateTimeInput(draft.createdFrom);
    const createdTo = fromBeijingDateTimeInput(draft.createdTo);
    if (new Date(createdFrom) >= new Date(createdTo)) {
      setRangeError('开始时间必须早于结束时间。');
      return;
    }
    setRangeError(undefined);
    onChange({
      keyword: draft.keyword.trim() || undefined,
      actorId: draft.actorId.trim().toLowerCase() || undefined,
      module: draft.module === 'ALL' ? undefined : draft.module,
      action: draft.action === 'ALL' ? undefined : draft.action,
      targetType: draft.targetType === 'ALL' ? undefined : draft.targetType,
      targetId: draft.targetId.trim() || undefined,
      outcome: draft.outcome === 'ALL' ? undefined : draft.outcome,
      requestId: draft.requestId.trim() || undefined,
      createdFrom,
      createdTo,
    } as Partial<AuditSearch>);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border-subtle bg-surface-panel p-3">
      <FilterBar
        filters={(
          <>
            <AuditInput label="开始时间（北京时间）" onChange={(createdFrom) => setDraft((current) => ({ ...current, createdFrom }))} type="datetime-local" value={draft.createdFrom} />
            <AuditInput label="结束时间（北京时间）" onChange={(createdTo) => setDraft((current) => ({ ...current, createdTo }))} type="datetime-local" value={draft.createdTo} />
            <AuditSelect ariaLabel="业务模块" items={[{ value: 'ALL', label: '全部模块' }, ...auditModuleValues.map((value) => ({ value, label: auditModuleLabels[value] }))]} onChange={(module) => setDraft((current) => ({ ...current, module }))} value={draft.module} />
            <AuditSelect ariaLabel="执行结果" items={[{ value: 'ALL', label: '全部结果' }, ...auditOutcomeValues.map((value) => ({ value, label: auditOutcomeLabels[value] }))]} onChange={(outcome) => setDraft((current) => ({ ...current, outcome }))} value={draft.outcome} />
          </>
        )}
        moreFilters={(
          <details className="w-full rounded-lg border border-border-subtle p-3">
            <summary className="cursor-pointer text-sm font-medium">更多筛选</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AuditInput label="操作者 ID" onChange={(actorId) => setDraft((current) => ({ ...current, actorId }))} value={draft.actorId} />
              <AuditSelect ariaLabel="动作" items={[{ value: 'ALL', label: '全部动作' }, ...actionOptions.map((value) => ({ value, label: auditActionLabel(value) }))]} onChange={(action) => setDraft((current) => ({ ...current, action }))} value={draft.action} />
              <AuditSelect ariaLabel="对象类型" items={[{ value: 'ALL', label: '全部对象类型' }, ...targetTypeOptions.map((value) => ({ value, label: value }))]} onChange={(targetType) => setDraft((current) => ({ ...current, targetType }))} value={draft.targetType} />
              <AuditInput label="对象 ID" onChange={(targetId) => setDraft((current) => ({ ...current, targetId }))} value={draft.targetId} />
              <AuditInput label="Request ID" onChange={(requestId) => setDraft((current) => ({ ...current, requestId }))} value={draft.requestId} />
            </div>
          </details>
        )}
        onQueryChange={(keyword) => setDraft((current) => ({ ...current, keyword }))}
        onReset={() => onChange(auditResetSearch())}
        onSubmit={submit}
        placeholder="搜索操作者、模块、动作、对象或结果说明"
        query={draft.keyword}
        searchLabel="搜索审计日志"
      />
      {rangeError && <p className="text-sm text-destructive" role="alert">{rangeError}</p>}
    </div>
  );
}

function AuditSelect({ ariaLabel, items, onChange, value }: { ariaLabel: string; items: readonly { value: string; label: string }[]; onChange: (value: string) => void; value: string }) {
  return (
    <Select items={items} onValueChange={(next) => next && onChange(next)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function AuditInput({ label, onChange, type = 'text', value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="space-y-1 text-sm"><span className="block text-text-muted">{label}</span><Input aria-label={label} onChange={(event) => onChange(event.currentTarget.value)} type={type} value={value} /></label>;
}

function AuditDetailSurface({ auditLogId }: { auditLogId: string }) {
  const detail = useQuery(auditDetailQueryOptions(auditLogId));
  if (detail.isPending) return <div aria-label="正在加载审计详情" className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (!detail.data) return <Notice message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  return <AuditDetailContent detail={detail.data} />;
}

function Notice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><span>{message}</span><Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button></div>;
}


function subscribeToDesktop(change: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}

function isDesktop() {
  return window.matchMedia(desktopQuery).matches;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '系统审计发生未知错误';
}

export { SystemAuditPage };
export type { SystemAuditPageProps };
