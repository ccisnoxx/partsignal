import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  columnFilteringFeature,
  createColumnHelper,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  tableFeatures,
  type PaginationState,
  useTable,
} from '@tanstack/react-table';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip';
import type { components } from '@/shared/api/generated/schema';
import {
  ContentRequestError,
  archiveContentTask,
  cancelContentTask,
  contentKeys,
  contentPlatformReferencesQueryOptions,
  contentTaskListQueryOptions,
  deleteContentTask,
  permanentDeletionPreviewQueryOptions,
  permanentlyDeleteContentTask,
  restoreContentTask,
} from './content.api';
import {
  archiveStatusRegistry,
  contentWorkflowStageRegistry,
  formatCurrentContent,
  formatExactContentTaskTime,
  formatRelativeContentTaskTime,
  hasContentTaskFilters,
  normalizeContentTaskPageSize,
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
  type ContentTaskAvailableAction,
  type ContentTaskListItem,
  type ContentTaskWorkflowStage,
  type ContentTasksSearch,
} from './content-task-list.model';

type PermanentDeletionPreview = components['schemas']['ContentTaskPermanentDeletionPreview'];
type PermanentDeletionCounts = components['schemas']['ContentTaskPermanentDeletionCounts'];
type ContentColumnMeta = { role?: ColumnRole };

const contentTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<ContentColumnMeta>(),
});

type LifecycleVariables =
  | { action: 'CANCEL'; task: ContentTaskListItem; comment: string }
  | { action: 'DELETE' | 'ARCHIVE' | 'RESTORE'; task: ContentTaskListItem }
  | {
      action: 'PERMANENT_DELETE';
      task: ContentTaskListItem;
      preview: PermanentDeletionPreview;
      confirmationText: string;
    };

type ContentTaskListPageProps = {
  csrfToken: string | null;
  onSearchChange: (search: ContentTasksSearch) => void;
  search: ContentTasksSearch;
};

function ContentTaskListPage({
  csrfToken,
  onSearchChange,
  search,
}: ContentTaskListPageProps) {
  const queryClient = useQueryClient();
  const tasks = useQuery(contentTaskListQueryOptions(search));
  const platforms = useQuery(contentPlatformReferencesQueryOptions());
  const [cancelTarget, setCancelTarget] = useState<ContentTaskListItem | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<ContentTaskListItem | null>(
    null,
  );
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
      if (variables.action === 'CANCEL') closeDialog(setCancelTarget);
      if (variables.action === 'PERMANENT_DELETE') {
        closeDialog(setPermanentDeleteTarget);
      }
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
    },
    onError: async (error, variables) => {
      if (error instanceof ContentRequestError && (error.status === 404 || error.status === 409)) {
        await queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
        if (variables.action === 'PERMANENT_DELETE') {
          await queryClient.invalidateQueries({
            queryKey: contentKeys.permanentDeletionPreview(variables.task.id),
          });
        }
      }
    },
  });

  const rows = tasks.data?.items ?? [];
  const total = tasks.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const pagination: PaginationState = { pageIndex: search.page - 1, pageSize: search.pageSize };
  const pendingAction = lifecycle.isPending ? lifecycle.variables?.action : undefined;
  const mutateLifecycle = lifecycle.mutate;
  const resetLifecycle = lifecycle.reset;

  function changeSearch(changes: Partial<ContentTasksSearch>, resetPage = true) {
    onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  const handleCommand = useCallback((
    command: string,
    task: ContentTaskListItem,
    focusReturn?: HTMLElement | null,
  ) => {
    resetLifecycle();
    setNotice(null);
    switch (command) {
      case 'cancel-content-task':
        focusReturnRef.current = focusReturn ?? null;
        setCancelTarget(task);
        return;
      case 'delete-content-task':
        mutateLifecycle({ action: 'DELETE', task });
        return;
      case 'archive-content-task':
        mutateLifecycle({ action: 'ARCHIVE', task });
        return;
      case 'restore-content-task':
        mutateLifecycle({ action: 'RESTORE', task });
        return;
      case 'permanently-delete-content-task':
        focusReturnRef.current = focusReturn ?? null;
        setPermanentDeleteTarget(task);
        return;
      default:
        throw new Error(`Content Tasks 收到未知页面命令：${command}`);
    }
  }, [mutateLifecycle, resetLifecycle]);

  const columns = useContentTaskColumns({ onCommand: handleCommand, pendingAction });
  const table = useTable({
    features: contentTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.id,
    manualFiltering: true,
    manualPagination: true,
    rowCount: total,
    autoResetPageIndex: false,
    state: { globalFilter: search.q ?? '', pagination },
    onGlobalFilterChange: () => undefined,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      changeSearch(
        { page: next.pageIndex + 1, pageSize: normalizeContentTaskPageSize(next.pageSize) },
        false,
      );
    },
  });
  const columnRoles = table.getAllLeafColumns().map((column) => column.columnDef.meta?.role);
  const filtered = hasContentTaskFilters(search);

  return (
    <section className="space-y-4" aria-labelledby="content-task-list-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="content-task-list-title" className="type-page-title">内容任务</h1>
            {search.archiveStatus === 'ARCHIVED' && <Badge variant="secondary">已归档视图</Badge>}
          </div>
          <p className="max-w-3xl text-text-secondary">
            查看服务端聚合的当前阶段，并进入每个任务唯一的下一项主要工作。
          </p>
        </div>
        <a className={buttonVariants()} href="/content/tasks/new">创建内容任务</a>
      </header>

      {notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
          {notice}
        </div>
      )}
      {lifecycle.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{errorMessage(lifecycle.error)}</span>
          <Button onClick={() => lifecycle.reset()} size="sm" variant="outline">关闭</Button>
        </div>
      )}

      <TableToolbar>
        <ContentTaskFilters
          key={`${search.q ?? ''}-${search.platformId ?? ''}`}
          onChange={(changes) => changeSearch(changes)}
          platformItems={platforms.data?.items ?? []}
          search={search}
        />
      </TableToolbar>
      {platforms.error && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(platforms.error)}；平台筛选暂不可用。
        </p>
      )}

      <TableShell regionLabel="内容任务列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <ColumnHeader
                  key={header.id}
                  role={header.column.columnDef.meta?.role ?? 'metadata'}
                >
                  <table.FlexRender header={header} />
                </ColumnHeader>
              ))}
            </tr>
          ))}
        </thead>

        {tasks.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : tasks.error ? (
          <EmptyTable
            action={<Button onClick={() => void tasks.refetch()} variant="outline">重试</Button>}
            colSpan={columns.length}
            description={errorMessage(tasks.error)}
            kind="error"
            title="内容任务列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? (
              <Button
                onClick={() => changeSearch({
                  q: undefined,
                  workflowStage: undefined,
                  archiveStatus: 'ACTIVE',
                  platformId: undefined,
                })}
                variant="outline"
              >
                清除筛选
              </Button>
            ) : undefined}
            colSpan={columns.length}
            description={
              filtered
                ? '没有符合当前搜索和筛选条件的内容任务。'
                : '当前还没有内容任务。'
            }
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配任务' : '暂无内容任务'}
          />
        ) : (
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td data-column-role={cell.column.columnDef.meta?.role} key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </TableShell>

      {!tasks.isPending && !tasks.error && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({
            pageSize: normalizeContentTaskPageSize(pageSize),
          })}
          pageCount={pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalItems={total}
        />
      )}

      <CancelTaskDialog
        error={lifecycle.error}
        finalFocus={() => resolveFocusReturn(focusReturnRef)}
        onClose={() => closeDialog(setCancelTarget)}
        onSubmit={(comment) => {
          if (cancelTarget) lifecycle.mutate({ action: 'CANCEL', task: cancelTarget, comment });
        }}
        open={cancelTarget !== null}
        pending={lifecycle.isPending && lifecycle.variables?.action === 'CANCEL'}
        task={cancelTarget}
      />
      <PermanentDeleteTaskDialog
        error={lifecycle.error}
        finalFocus={() => resolveFocusReturn(focusReturnRef)}
        onClose={() => closeDialog(setPermanentDeleteTarget)}
        onSubmit={(preview, confirmationText) => {
          if (permanentDeleteTarget) {
            lifecycle.mutate({
              action: 'PERMANENT_DELETE',
              task: permanentDeleteTarget,
              preview,
              confirmationText,
            });
          }
        }}
        open={permanentDeleteTarget !== null}
        pending={lifecycle.isPending && lifecycle.variables?.action === 'PERMANENT_DELETE'}
        task={permanentDeleteTarget}
      />
    </section>
  );
}

function useContentTaskColumns({
  onCommand,
  pendingAction,
}: {
  onCommand: (
    command: string,
    task: ContentTaskListItem,
    focusReturn?: HTMLElement | null,
  ) => void;
  pendingAction?: ContentTaskAvailableAction;
}) {
  const columnHelper = useMemo(
    () => createColumnHelper<typeof contentTableFeatures, ContentTaskListItem>(),
    [],
  );
  return useMemo(() => columnHelper.columns([
    columnHelper.accessor('identifier', {
      header: '任务',
      meta: { role: 'primary' },
      cell: ({ row }) => <ContentTaskIdentity task={row.original} />,
    }),
    columnHelper.accessor('platform', {
      header: '目标平台',
      meta: { role: 'metadata' },
      cell: ({ getValue }) => <TruncatedText text={getValue().name} />,
    }),
    columnHelper.accessor('workflow_stage', {
      header: '当前阶段',
      meta: { role: 'status' },
      cell: ({ getValue }) => <ContentWorkflowStageBadge stage={getValue()} />,
    }),
    columnHelper.accessor('current_content', {
      header: '当前内容',
      meta: { role: 'metadata' },
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap font-mono text-xs">{formatCurrentContent(getValue())}</span>
      ),
    }),
    columnHelper.accessor('updated_at', {
      header: '最近更新',
      meta: { role: 'date' },
      cell: ({ getValue }) => <ContentTaskRelativeTime value={getValue()} />,
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      meta: { role: 'actions' },
      cell: ({ row }) => (
        <RowActions
          objectLabel={row.original.identifier}
          onCommand={(command, focusReturn) => onCommand(command, row.original, focusReturn)}
          overflow={resolveContentTaskOverflowActions(row.original, pendingAction)}
          primary={resolveContentTaskPrimaryAction(row.original)}
        />
      ),
    }),
  ]), [columnHelper, onCommand, pendingAction]);
}

function ContentTaskFilters({
  onChange,
  platformItems,
  search,
}: {
  onChange: (changes: Partial<ContentTasksSearch>) => void;
  platformItems: components['schemas']['PlatformProfile'][];
  search: ContentTasksSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');
  const workflowItems = Object.entries(contentWorkflowStageRegistry).map(
    ([value, presentation]) => ({ value, label: presentation.label }),
  );
  const archiveItems = Object.entries(archiveStatusRegistry).map(([value, label]) => ({
    value,
    label,
  }));
  const platformOptions = platformItems.map((platform) => ({
    value: platform.id,
    label: platform.name,
  }));
  return (
    <FilterBar
      filters={(
        <>
          <ContentFilterSelect
            ariaLabel="当前阶段"
            items={[{ value: 'ALL', label: '全部阶段' }, ...workflowItems]}
            onChange={(value) => onChange({
              workflowStage: value === 'ALL' ? undefined : value as ContentTaskWorkflowStage,
            })}
            value={search.workflowStage ?? 'ALL'}
          />
          <ContentFilterSelect
            ariaLabel="归档范围"
            items={archiveItems}
            onChange={(value) => onChange({
              archiveStatus: value as ContentTasksSearch['archiveStatus'],
            })}
            value={search.archiveStatus}
          />
          <ContentFilterSelect
            ariaLabel="目标平台"
            items={[{ value: 'ALL', label: '全部平台' }, ...platformOptions]}
            onChange={(value) => onChange({ platformId: value === 'ALL' ? undefined : value })}
            value={search.platformId ?? 'ALL'}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => {
        setQuery('');
        onChange({
          q: undefined,
          workflowStage: undefined,
          archiveStatus: 'ACTIVE',
          platformId: undefined,
        });
      }}
      onSubmit={() => onChange({ q: query.trim() || undefined })}
      placeholder="搜索任务、型号或平台"
      query={query}
      resetDisabled={
        !query
        && !search.q
        && !search.workflowStage
        && !search.platformId
        && search.archiveStatus === 'ACTIVE'
      }
      searchLabel="搜索内容任务"
    />
  );
}

function ContentFilterSelect({
  ariaLabel,
  items,
  onChange,
  value,
}: {
  ariaLabel: string;
  items: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select items={items} onValueChange={(next) => next && onChange(next)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ContentTaskIdentity({ task }: { task: ContentTaskListItem }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Tooltip>
        <TooltipTrigger
          render={(
            <a
              className="table-cell-ellipsis rounded-sm font-mono font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              href={`/content/tasks/${encodeURIComponent(task.id)}`}
            />
          )}
        >
          {task.product.part_number}
        </TooltipTrigger>
        <TooltipContent>{task.product.brand} · {task.product.part_number}</TooltipContent>
      </Tooltip>
      <span className="block font-mono text-xs text-text-muted">{task.identifier}</span>
    </div>
  );
}

function TruncatedText({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className="table-cell-ellipsis block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            tabIndex={0}
          />
        )}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function ContentWorkflowStageBadge({ stage }: { stage: ContentTaskWorkflowStage }) {
  const presentation = contentWorkflowStageRegistry[stage];
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge tabIndex={0} variant={presentation.tone} />}>
        {presentation.label}
      </TooltipTrigger>
      <TooltipContent>{presentation.description}</TooltipContent>
    </Tooltip>
  );
}

function ContentTaskRelativeTime({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <time
            className="rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            dateTime={value}
            tabIndex={0}
          />
        )}
      >
        {formatRelativeContentTaskTime(value)}
      </TooltipTrigger>
      <TooltipContent>{formatExactContentTaskTime(value)}</TooltipContent>
    </Tooltip>
  );
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
  task: ContentTaskListItem | null;
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
  task: ContentTaskListItem | null;
}) {
  const [confirmationText, setConfirmationText] = useState('');
  const preview = useQuery({
    ...permanentDeletionPreviewQueryOptions(task?.id ?? 'closed'),
    enabled: open && task !== null,
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
          <DialogDescription>
            服务端会在执行时重新计算以下范围；外部页面不会被删除。
          </DialogDescription>
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
              <span className="font-medium">
                输入“{preview.data.confirmation_text}”确认永久删除
              </span>
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

function closeDialog<T>(setter: (value: T | null) => void) {
  setter(null);
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

export { ContentTaskListPage };
export type { ContentTaskListPageProps };
