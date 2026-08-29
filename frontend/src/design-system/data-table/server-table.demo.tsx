import {
  columnFilteringFeature,
  createColumnHelper,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  useTable,
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

import { BulkActionBar } from '@/design-system/data-table/bulk-action-bar';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { TableToolbar } from '@/design-system/data-table/table-toolbar';
import type {
  BulkAction,
  ColumnRole,
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';

type DemoColumnMeta = { role?: ColumnRole };

const demoFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnMeta: metaHelper<DemoColumnMeta>(),
});

type DemoRow = {
  category: string;
  id: string;
  overflow: readonly OverflowRowAction[];
  primary?: PrimaryRowAction;
  score: number;
  status: '可用' | '需处理' | '草稿';
  title: string;
  updatedAt: string;
};

const defaultPrimary: PrimaryRowAction = {
  key: 'continue',
  label: '继续处理',
  intent: 'primary',
  enabled: true,
  command: 'continue',
};

const defaultOverflow: readonly OverflowRowAction[] = [
  {
    key: 'history',
    label: '查看历史',
    intent: 'secondary',
    enabled: true,
    href: '#demo-history',
  },
  {
    key: 'archive',
    label: '归档记录',
    intent: 'danger',
    enabled: true,
    command: 'archive',
    confirmation: {
      title: '确认归档记录',
      description: '归档后该记录将离开当前列表，但仍可恢复。',
      confirmLabel: '确认归档',
    },
  },
];

const disabledOverflow: readonly OverflowRowAction[] = [
  {
    key: 'blocked',
    label: '提交审核',
    intent: 'secondary',
    enabled: false,
    command: 'submit-review',
    disabledReason: '缺少必填信息',
  },
  defaultOverflow[1]!,
];

const bulkActions: readonly BulkAction[] = [
  {
    key: 'enable',
    label: '启用',
    command: 'bulk-enable',
    intent: 'secondary',
    enabled: true,
  },
  {
    key: 'delete',
    label: '删除',
    command: 'bulk-delete',
    intent: 'danger',
    enabled: true,
    confirmation: {
      title: '确认删除所选记录',
      description: '删除后无法恢复，请确认所选对象和实际影响。',
      confirmLabel: '确认删除',
    },
  },
];

function createDemoRows(count: number): DemoRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    title: `示例对象 ${String(index + 1).padStart(2, '0')}`,
    category: ['连接器', '传感器', '控制器'][index % 3]!,
    status: (['可用', '需处理', '草稿'] as const)[index % 3]!,
    score: 1000 + index * 37,
    updatedAt: `2026-08-${String((index % 9) + 1).padStart(2, '0')}`,
    primary: defaultPrimary,
    overflow: defaultOverflow,
  }));
}

const demoRows50 = createDemoRows(50);

function compareRows(left: DemoRow, right: DemoRow, columnId: string) {
  if (columnId === 'score') return left.score - right.score;
  const leftValue = String(left[columnId as keyof DemoRow] ?? '');
  const rightValue = String(right[columnId as keyof DemoRow] ?? '');
  return leftValue.localeCompare(rightValue, 'zh-CN');
}

function getServerResult(
  rows: readonly DemoRow[],
  query: string,
  sorting: SortingState,
  pagination: PaginationState,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const filteredRows = normalizedQuery
    ? rows.filter((row) => `${row.title} ${row.category} ${row.status}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
    : [...rows];
  const currentSort = sorting[0];
  const sortedRows = currentSort
    ? [...filteredRows].sort((left, right) => compareRows(left, right, currentSort.id) * (currentSort.desc ? -1 : 1))
    : filteredRows;
  const start = pagination.pageIndex * pagination.pageSize;
  return {
    rows: sortedRows.slice(start, start + pagination.pageSize),
    total: sortedRows.length,
  };
}

type SelectionCheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  indeterminate?: boolean;
};

function SelectionCheckbox({ indeterminate = false, ...props }: SelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <input className="size-4 accent-[var(--interaction-primary)]" ref={ref} type="checkbox" {...props} />;
}

type ServerTableDemoProps = {
  error?: string;
  initialQuery?: string;
  loading?: boolean;
  rows?: readonly DemoRow[];
};

function ServerTableDemo({ error, initialQuery = '', loading = false, rows = demoRows50 }: ServerTableDemoProps) {
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const serverResult = useMemo(
    () => getServerResult(rows, query, sorting, pagination),
    [pagination, query, rows, sorting],
  );

  const columnHelper = useMemo(() => createColumnHelper<typeof demoFeatures, DemoRow>(), []);
  const columns = useMemo(() => columnHelper.columns([
    columnHelper.display({
      id: 'selection',
      enableSorting: false,
      header: ({ table }) => (
        <SelectionCheckbox
          aria-label="选择当前页全部行"
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
          onClick={(event) => {
            event.stopPropagation();
            table.getToggleAllPageRowsSelectedHandler()(event);
          }}
          readOnly
        />
      ),
      cell: ({ row }) => (
        <SelectionCheckbox
          aria-label={`选择 ${row.original.title}`}
          checked={row.getIsSelected()}
          onClick={(event) => {
            event.stopPropagation();
            row.getToggleSelectedHandler()(event);
          }}
          readOnly
        />
      ),
    }),
    columnHelper.accessor('title', {
      header: '对象',
      meta: { role: 'primary' },
      cell: ({ row }) => (
        <a className="table-cell-ellipsis rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={`#${row.original.id}`}>
          {row.original.title}
        </a>
      ),
    }),
    columnHelper.accessor('status', {
      header: '状态',
      meta: { role: 'status' },
      cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
    }),
    columnHelper.accessor('category', {
      header: '分类',
      meta: { role: 'metadata' },
    }),
    columnHelper.accessor('score', {
      header: '评分',
      meta: { role: 'numeric' },
    }),
    columnHelper.accessor('updatedAt', {
      header: '更新时间',
      meta: { role: 'date' },
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      meta: { role: 'actions' },
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          objectLabel={row.original.title}
          onCommand={setLastCommand}
          overflow={row.original.overflow}
          primary={row.original.primary}
        />
      ),
    }),
  ]), [columnHelper]);

  const table = useTable({
    features: demoFeatures,
    columns,
    data: serverResult.rows,
    getRowId: (row) => row.id,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    rowCount: serverResult.total,
    autoResetPageIndex: false,
    enableSortingRemoval: true,
    state: { globalFilter: query, pagination, rowSelection, sorting },
    onGlobalFilterChange: (updater) => setQuery((current) => typeof updater === 'function' ? String(updater(current)) : String(updater ?? '')),
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onSortingChange: (updater) => {
      setSorting((current) => typeof updater === 'function' ? updater(current) : updater);
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
  });

  const pageCount = Math.ceil(serverResult.total / pagination.pageSize);
  const selectedCount = Object.keys(rowSelection).length;
  const columnRoles = table.getAllLeafColumns().map((column) => column.columnDef.meta?.role);

  function submitQuery() {
    table.setGlobalFilter(draftQuery);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  function resetQuery() {
    setDraftQuery('');
    table.setGlobalFilter('');
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  return (
    <div className="space-y-3" data-testid="server-table-demo">
      <TableToolbar actions={<Button variant="outline">导出当前视图</Button>}>
        <FilterBar
          onQueryChange={setDraftQuery}
          onReset={resetQuery}
          onSubmit={submitQuery}
          query={draftQuery}
          resetDisabled={!draftQuery && !query}
        />
      </TableToolbar>

      <BulkActionBar
        actions={bulkActions}
        onClear={() => setRowSelection({})}
        onCommand={setLastCommand}
        selectedCount={selectedCount}
      />

      {lastCommand && <output className="block text-sm text-text-secondary">最近命令：{lastCommand}</output>}

      <TableShell regionLabel="示例对象列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const role = header.column.columnDef.meta?.role;
                if (!role) {
                  return <th key={header.id} scope="col">{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>;
                }
                return (
                  <ColumnHeader
                    key={header.id}
                    onSort={header.column.getCanSort() ? () => header.column.toggleSorting() : undefined}
                    role={role}
                    sortDirection={header.column.getCanSort() ? header.column.getIsSorted() : false}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </ColumnHeader>
                );
              })}
            </tr>
          ))}
        </thead>

        {loading ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : error ? (
          <EmptyTable colSpan={columns.length} description={error} kind="error" title="表格加载失败" />
        ) : serverResult.total === 0 ? (
          <EmptyTable
            action={query ? <Button onClick={resetQuery} variant="outline">清除筛选</Button> : undefined}
            colSpan={columns.length}
            description={query ? '没有符合当前筛选条件的记录。' : '当前还没有可显示的记录。'}
            kind={query ? 'filtered-empty' : 'empty'}
            title={query ? '未找到匹配结果' : '暂无数据'}
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

      <TablePagination
        onPageIndexChange={(pageIndex) => setPagination((current) => ({ ...current, pageIndex }))}
        onPageSizeChange={(pageSize) => setPagination({ pageIndex: 0, pageSize })}
        pageCount={pageCount}
        pageIndex={pagination.pageIndex}
        pageSize={pagination.pageSize}
        totalItems={serverResult.total}
      />
    </div>
  );
}

export {
  ServerTableDemo,
  createDemoRows,
  defaultOverflow,
  demoRows50,
  disabledOverflow,
  getServerResult,
};
export type { DemoRow, ServerTableDemoProps };
