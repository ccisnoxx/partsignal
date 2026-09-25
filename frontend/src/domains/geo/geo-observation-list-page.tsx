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
import { useCallback, useMemo, useRef, useState } from 'react';

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design-system/primitives/dialog';
import type { components } from '@/shared/api/generated/schema';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { productsKeys } from '@/domains/product/product.api';
import { deleteGeoObservation, GeoRequestError, geoKeys, geoObservationListQueryOptions } from './geo.api';
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
  const options = geoObservationListQueryOptions(search);
  const observations = useQuery(options);
  const [deleteIntent, setDeleteIntent] = useState<string | null>(null);
  const focusId = useRef<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const commandPending = useRef(false);
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (observation: GeoObservationListItem) => (
      deleteGeoObservation(observation.id, csrfToken)
    ),
    onSuccess: async (_data, observation) => {
      // 先取消旧读请求并移除已删除记录，重读失败也不能恢复旧动作。
      await queryClient.cancelQueries({ queryKey: geoKeys.lists() });
      queryClient.setQueriesData<components['schemas']['GeoObservationListPage']>(
        { queryKey: geoKeys.lists() },
        (data) => data && ({
          ...data,
          items: data.items.filter((item) => item.id !== observation.id),
          total: data.total - data.items.filter((item) => item.id === observation.id).length,
        }),
      );
      setDeleteIntent(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: geoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.details(), refetchType: 'none' }),
        queryClient.invalidateQueries({
          queryKey: geoKeys.correctionContexts(),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({ queryKey: geoKeys.insights() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.topicLists() }),
        queryClient.invalidateQueries({
          queryKey: productsKeys.detail(observation.product.id),
        }),
      ]);
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

  const handleCommand = useCallback((command: string, observation: GeoObservationListItem) => {
    if (command !== 'delete-observation') {
      throw new Error(`GEO Observations 收到未知页面命令：${command}`);
    }
    focusId.current = observation.id;
    setDeleteIntent(observation.id);
    setCommandError(null);
  }, []);

  async function reloadList() {
    const result = await observations.refetch();
    if (!result.error) {
      conflictRef.current = false;
      setConflict(false);
      setCommandError(null);
      remove.reset();
    }
  }

  async function confirmDelete() {
    if (!deleteIntent || commandPending.current || conflictRef.current) return;
    const current = queryClient.getQueryState(options.queryKey);
    const observation = current?.data?.items.find((item) => item.id === deleteIntent);
    if (current?.fetchStatus !== 'idle' || current.error || !observation?.available_actions.includes('DELETE')) {
      setCommandError('列表正在刷新、读取失败或该记录已不可删除，请重载列表后确认。');
      return;
    }
    commandPending.current = true;
    setCommandError(null);
    try {
      await remove.mutateAsync(observation);
    } catch (error) {
      setCommandError(errorMessage(error));
      if (error instanceof GeoRequestError && error.status === 409) {
        conflictRef.current = true;
        setConflict(true);
      }
    } finally {
      commandPending.current = false;
    }
  }

  const intentRow = rows.find((row) => row.id === deleteIntent);
  const deleteBlocked = conflict || observations.isFetching || Boolean(observations.error)
    || !intentRow?.available_actions.includes('DELETE');

  const columns = useGeoObservationColumns({
    deletingId: remove.isPending ? remove.variables.id : undefined,
    unavailable: Boolean(observations.error) || observations.isFetching,
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
          <h1 className="type-page-title" id="geo-observation-list-title" ref={titleRef} tabIndex={-1}>GEO 观测记录</h1>
          <p className="max-w-3xl text-text-secondary">
            查看服务端汇总的发现、提及和准确性结果，并进入每条观测的规范地址。
          </p>
        </div>
        <a className={buttonVariants()} href="/geo/observations/new">新建 Observation</a>
      </header>

      {conflict && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>删除发生冲突，请显式重载列表后重新确认。{commandError}</p>
          <Button disabled={observations.isFetching} onClick={() => void reloadList()} variant="outline">重载列表</Button>
        </div>
      )}
      {observations.data && observations.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>刷新失败，已保留当前观测列表：{errorMessage(observations.error)}</span>
          <Button onClick={() => void reloadList()} size="sm" variant="outline">重试刷新</Button>
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
      <Dialog open={deleteIntent !== null} onOpenChange={(open) => {
        if (!open && !commandPending.current) setDeleteIntent(null);
      }}>
        <DialogContent finalFocus={() => {
          const trigger = document.getElementById(`geo-actions-${focusId.current}`)?.querySelector('button');
          return trigger ?? titleRef.current;
        }}>
          <DialogHeader>
            <DialogTitle>删除 GEO 观测</DialogTitle>
            <DialogDescription>{intentRow ? `将永久删除“${intentRow.query_text}”的完整更正链。此操作无法撤销。` : '该记录已不在当前列表中，无法执行删除。'}</DialogDescription>
          </DialogHeader>
          {commandError && <p role="alert" className="text-sm text-destructive">{commandError}</p>}
          {deleteBlocked && <p role="status">当前记录不可确认删除，请重载列表核对最新动作。</p>}
          <DialogFooter>
            <Button disabled={remove.isPending} onClick={() => setDeleteIntent(null)} variant="outline">取消</Button>
            <Button disabled={remove.isPending || observations.isFetching} onClick={() => void reloadList()} variant="outline">重载列表</Button>
            <Button disabled={remove.isPending || deleteBlocked} onClick={() => void confirmDelete()} variant="destructive">确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function useGeoObservationColumns({
  deletingId,
  unavailable,
  onCommand,
}: {
  deletingId?: string;
  unavailable: boolean;
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
        <div id={`geo-actions-${row.original.id}`}><RowActions
          objectLabel={row.original.query_text}
          onCommand={(command) => onCommand(command, row.original)}
          overflow={resolveGeoObservationOverflowActions({
            actions: row.original.available_actions,
            deleting: deletingId === row.original.id,
            label: row.original.query_text,
            observationId: row.original.id,
          }).map((action) => action.command === 'delete-observation'
            ? { ...action, confirmation: 'custom' as const }
            : action).map((action) => ({
            ...action,
            enabled: action.enabled && !unavailable,
            disabledReason: unavailable ? '请等待列表成功刷新' : action.disabledReason,
          }))}
        /></div>
      ),
    }),
  ]), [columnHelper, deletingId, onCommand, unavailable]);
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
