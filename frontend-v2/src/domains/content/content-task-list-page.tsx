import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import { useMemo, useState } from 'react';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip';
import type { components } from '@/shared/api/generated/schema';
import {
  contentPlatformReferencesQueryOptions,
  contentTaskListQueryOptions,
} from './content.api';
import {
  resolveContentTaskOverflowActions,
  resolveContentTaskPrimaryAction,
  type ContentTaskAvailableAction,
} from './content-task-actions';
import { useContentTaskLifecycle } from './content-task-lifecycle';
import {
  archiveStatusRegistry,
  contentWorkflowStageRegistry,
  formatCurrentContent,
  formatExactContentTaskTime,
  formatRelativeContentTaskTime,
  hasContentTaskFilters,
  normalizeContentTaskPageSize,
  type ContentTaskListItem,
  type ContentTaskWorkflowStage,
  type ContentTasksSearch,
} from './content-task-list.model';

type ContentColumnMeta = { role?: ColumnRole };

const contentTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<ContentColumnMeta>(),
});

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
  const tasks = useQuery(contentTaskListQueryOptions(search));
  const platforms = useQuery(contentPlatformReferencesQueryOptions());
  const rows = tasks.data?.items ?? [];
  const lifecycle = useContentTaskLifecycle({
    csrfToken,
    resolveTask: (taskId) => rows.find((task) => task.id === taskId),
  });
  const total = tasks.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const pagination: PaginationState = { pageIndex: search.page - 1, pageSize: search.pageSize };

  function changeSearch(changes: Partial<ContentTasksSearch>, resetPage = true) {
    onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  const columns = useContentTaskColumns({
    onCommand: lifecycle.handleCommand,
    pendingAction: lifecycle.pendingAction,
  });
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
        <Link className={buttonVariants()} to="/content/tasks/new">创建内容任务</Link>
      </header>

      {lifecycle.notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
          {lifecycle.notice}
        </div>
      )}
      {lifecycle.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{errorMessage(lifecycle.error)}</span>
          <Button onClick={lifecycle.reset} size="sm" variant="outline">关闭</Button>
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

      {lifecycle.dialogs}
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { ContentTaskListPage };
export type { ContentTaskListPageProps };
