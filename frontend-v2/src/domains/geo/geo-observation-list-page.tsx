import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  columnFilteringFeature,
  createColumnHelper,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
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
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { deleteGeoObservation, geoKeys, geoObservationListQueryOptions } from './geo.api';
import { resolveGeoObservationOverflowActions } from './geo-observation-actions';
import {
  accuracyLabels,
  accuracyValues,
  formatGeoObservationIndicator,
  formatGeoObservationTime,
  geoObservationSortToSorting,
  hasGeoObservationFilters,
  normalizeGeoObservationPageSize,
  sortingToGeoObservationSort,
  type AccuracyStatus,
  type GeoObservationListItem,
  type GeoObservationSearch,
} from './geo-observation-list.model';

type GeoColumnMeta = { role?: ColumnRole };

const geoTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<GeoColumnMeta>(),
});

type GeoObservationListPageProps = {
  csrfToken: string | null;
  onSearchChange: (search: GeoObservationSearch) => Promise<void> | void;
  search: GeoObservationSearch;
};

function GeoObservationListPage({
  csrfToken,
  onSearchChange,
  search,
}: GeoObservationListPageProps) {
  const queryClient = useQueryClient();
  const observations = useQuery(geoObservationListQueryOptions(search));
  const remove = useMutation({
    mutationFn: (observationId: string) => deleteGeoObservation(observationId, csrfToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: geoKeys.lists() });
    },
  });
  const rows = observations.data?.items ?? [];
  const total = observations.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const pagination: PaginationState = { pageIndex: search.page - 1, pageSize: search.pageSize };
  const sorting = geoObservationSortToSorting(search.sort);

  function changeSearch(changes: Partial<GeoObservationSearch>, resetPage = true) {
    void onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  function handleCommand(command: string, observation: GeoObservationListItem) {
    if (command === 'delete-observation') {
      remove.mutate(observation.id);
      return;
    }
    throw new Error(`GEO Observations 收到未知页面命令：${command}`);
  }

  const columns = useGeoObservationColumns({
    deletingId: remove.isPending ? remove.variables : undefined,
    onCommand: handleCommand,
  });
  const table = useTable({
    features: geoTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.id,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    rowCount: total,
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    state: { globalFilter: search.q ?? '', pagination, sorting },
    onGlobalFilterChange: () => undefined,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      changeSearch({
        page: next.pageIndex + 1,
        pageSize: normalizeGeoObservationPageSize(next.pageSize),
      }, false);
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      changeSearch({ sort: sortingToGeoObservationSort(next) });
    },
  });
  const columnRoles = table.getAllLeafColumns().map((column) => column.columnDef.meta?.role);
  const filtered = hasGeoObservationFilters(search);

  return (
    <section aria-labelledby="geo-observation-list-title" className="min-w-0 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="type-page-title" id="geo-observation-list-title">GEO 观测记录</h1>
          <p className="max-w-3xl text-text-secondary">
            查看服务端汇总的发现、提及和准确性结果，并进入每条观测的规范地址。
          </p>
        </div>
        <a className={buttonVariants()} href="/geo/observations/new">新建 Observation</a>
      </header>

      {remove.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{errorMessage(remove.error)}</span>
          <Button onClick={() => remove.reset()} size="sm" variant="outline">关闭</Button>
        </div>
      )}
      {observations.data && observations.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>刷新失败，已保留当前观测列表：{errorMessage(observations.error)}</span>
          <Button onClick={() => void observations.refetch()} size="sm" variant="outline">重试刷新</Button>
        </div>
      )}
      {search.queryTopicId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm" role="status">
          <span>Query Topic Observation 筛选：{search.queryTopicId}</span>
          <Button onClick={() => changeSearch({ queryTopicId: undefined })} size="sm" variant="outline">清除此引用筛选</Button>
        </div>
      )}

      <TableToolbar>
        <GeoObservationFilters
          key={`${search.q ?? ''}-${search.productId ?? ''}-${search.queryTopicId ?? ''}-${search.geoPlatform ?? ''}`}
          onChange={(changes) => changeSearch(changes)}
          search={search}
        />
      </TableToolbar>

      <TableShell regionLabel="GEO 观测记录列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <ColumnHeader
                  key={header.id}
                  onSort={header.column.getCanSort()
                    ? () => header.column.toggleSorting()
                    : undefined}
                  role={header.column.columnDef.meta?.role ?? 'metadata'}
                  sortDirection={header.column.getCanSort()
                    ? header.column.getIsSorted()
                    : false}
                >
                  <table.FlexRender header={header} />
                </ColumnHeader>
              ))}
            </tr>
          ))}
        </thead>

        {observations.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : observations.error && !observations.data ? (
          <EmptyTable
            action={<Button onClick={() => void observations.refetch()} variant="outline">重试</Button>}
            colSpan={columns.length}
            description={errorMessage(observations.error)}
            kind="error"
            title="GEO 观测列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? (
              <Button onClick={() => changeSearch(clearFilters)} variant="outline">清除筛选</Button>
            ) : undefined}
            colSpan={columns.length}
            description={filtered
              ? '没有符合当前搜索和筛选条件的 GEO 观测。'
              : '当前还没有 GEO 观测记录。'}
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配观测' : '暂无 GEO 观测'}
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

      {!observations.isPending && !(observations.error && !observations.data) && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({
            pageSize: normalizeGeoObservationPageSize(pageSize),
          })}
          pageCount={pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalItems={total}
        />
      )}
    </section>
  );
}

function useGeoObservationColumns({
  deletingId,
  onCommand,
}: {
  deletingId?: string;
  onCommand: (command: string, observation: GeoObservationListItem) => void;
}) {
  const columnHelper = useMemo(
    () => createColumnHelper<typeof geoTableFeatures, GeoObservationListItem>(),
    [],
  );
  return useMemo(() => columnHelper.columns([
    columnHelper.accessor('query_text', {
      header: '查询',
      meta: { role: 'primary' },
      enableSorting: false,
      cell: ({ row }) => <GeoObservationIdentity observation={row.original} />,
    }),
    columnHelper.accessor('geo_platform', {
      header: 'GEO 平台',
      meta: { role: 'metadata' },
      enableSorting: false,
      cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span>,
    }),
    columnHelper.accessor('outcomes', {
      header: '发现 / 提及 / 准确',
      meta: { role: 'status' },
      enableSorting: false,
      cell: ({ getValue }) => <GeoObservationOutcomes outcomes={getValue()} />,
    }),
    columnHelper.accessor('related_achievement_count', {
      header: '关联成果',
      meta: { role: 'numeric' },
      enableSorting: false,
    }),
    columnHelper.accessor('evidence_count', {
      header: '证据',
      meta: { role: 'metadata' },
      enableSorting: false,
      cell: ({ getValue }) => getValue() > 0 ? `有证据 · ${getValue()}` : '无证据',
    }),
    columnHelper.accessor('recorder', {
      header: '记录人',
      meta: { role: 'metadata' },
      enableSorting: false,
      cell: ({ getValue }) => (
        <div className="whitespace-nowrap">
          <p>{getValue().display_name}</p>
          <p className="text-xs text-text-muted">@{getValue().username}</p>
        </div>
      ),
    }),
    columnHelper.accessor('observed_at', {
      header: '观测时间',
      meta: { role: 'date' },
      cell: ({ getValue }) => (
        <time dateTime={getValue()}>{formatGeoObservationTime(getValue())}</time>
      ),
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      meta: { role: 'actions' },
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          objectLabel={row.original.query_text}
          onCommand={(command) => onCommand(command, row.original)}
          overflow={resolveGeoObservationOverflowActions({
            actions: row.original.available_actions,
            deleting: deletingId === row.original.id,
            label: row.original.query_text,
            observationId: row.original.id,
          })}
        />
      ),
    }),
  ]), [columnHelper, deletingId, onCommand]);
}

function GeoObservationIdentity({ observation }: { observation: GeoObservationListItem }) {
  return (
    <div className="max-w-xl space-y-1">
      <a
        className="block break-words font-medium text-link hover:underline"
        href={`/geo/observations/${observation.id}`}
      >
        {observation.query_text}
      </a>
      <p className="break-words text-xs text-text-secondary">{observation.product.label}</p>
    </div>
  );
}

function GeoObservationOutcomes({ outcomes }: { outcomes: GeoObservationListItem['outcomes'] }) {
  return (
    <div className="space-y-0.5 whitespace-nowrap text-xs">
      <p>{formatGeoObservationIndicator('发现', outcomes.discovered)}</p>
      <p>{formatGeoObservationIndicator('提及', outcomes.mentioned)}</p>
      <p>{formatGeoObservationIndicator('准确', outcomes.accuracy)}</p>
    </div>
  );
}

const clearFilters = {
  q: undefined,
  productId: undefined,
  queryTopicId: undefined,
  geoPlatform: undefined,
  accuracy: undefined,
  from: undefined,
  to: undefined,
} satisfies Partial<GeoObservationSearch>;

function GeoObservationFilters({
  onChange,
  search,
}: {
  onChange: (changes: Partial<GeoObservationSearch>) => void;
  search: GeoObservationSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');
  const [productId, setProductId] = useState(search.productId ?? '');
  const [geoPlatform, setGeoPlatform] = useState(search.geoPlatform ?? '');
  const [accuracy, setAccuracy] = useState<AccuracyStatus | 'ALL'>(
    search.accuracy ?? 'ALL',
  );
  const [dateFrom, setDateFrom] = useState(search.from ?? '');
  const [dateTo, setDateTo] = useState(search.to ?? '');
  return (
    <FilterBar
      filters={(
        <>
          <Input
            aria-label="产品 ID"
            className="md:w-52"
            onChange={(event) => setProductId(event.currentTarget.value)}
            placeholder="产品 ID"
            value={productId}
          />
          <Input
            aria-label="GEO 平台"
            className="md:w-40"
            maxLength={160}
            onChange={(event) => setGeoPlatform(event.currentTarget.value)}
            placeholder="GEO 平台"
            value={geoPlatform}
          />
          <Select
            items={[
              { value: 'ALL', label: '全部准确性' },
              ...accuracyValues.map((value) => ({ value, label: accuracyLabels[value] })),
            ]}
            onValueChange={(value) => value && setAccuracy(value as AccuracyStatus | 'ALL')}
            value={accuracy}
          >
            <SelectTrigger aria-label="准确性" className="md:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部准确性</SelectItem>
              {accuracyValues.map((value) => (
                <SelectItem key={value} value={value}>{accuracyLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="观测日期从"
            className="md:w-40"
            onChange={(event) => setDateFrom(event.currentTarget.value)}
            type="date"
            value={dateFrom}
          />
          <Input
            aria-label="观测日期到"
            className="md:w-40"
            onChange={(event) => setDateTo(event.currentTarget.value)}
            type="date"
            value={dateTo}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => {
        setQuery('');
        setProductId('');
        setGeoPlatform('');
        setAccuracy('ALL');
        setDateFrom('');
        setDateTo('');
        onChange(clearFilters);
      }}
      onSubmit={() => onChange({
        q: query.trim() || undefined,
        productId: productId.trim() || undefined,
        geoPlatform: geoPlatform.trim() || undefined,
        accuracy: accuracy === 'ALL' ? undefined : accuracy,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      })}
      placeholder="标准问题、搜索词或 Product"
      query={query}
      resetDisabled={!hasGeoObservationFilters(search)}
      searchLabel="搜索 GEO 观测"
    />
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { GeoObservationListPage };
