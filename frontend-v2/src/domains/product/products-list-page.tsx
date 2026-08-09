import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import { useMemo, useState, type ReactNode } from 'react';

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
import { ProductDeletionConditionsDialog } from './product-deletion-dialog';
import {
  formatExactProductTime,
  formatRelativeProductTime,
  productFactStatusRegistry,
  productWorkflowStageRegistry,
  resolveProductOverflowActions,
  resolveProductPrimaryAction,
  type ProductFactStatus,
  type ProductListItem,
  type ProductWorkflowStage,
} from './product.model';
import { deleteProduct, productsKeys, productsListQueryOptions } from './product.api';
import {
  formatCurrentFact,
  hasProductsFilters,
  normalizeProductPageSize,
  productSortToSorting,
  sortingToProductSort,
  type ProductsSearch,
} from './products-list.model';

type ProductColumnMeta = { role?: ColumnRole };

const productTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<ProductColumnMeta>(),
});

type ProductsListPageProps = {
  csrfToken: string | null;
  onSearchChange: (search: ProductsSearch) => void;
  search: ProductsSearch;
};

function ProductsListPage({ csrfToken, onSearchChange, search }: ProductsListPageProps) {
  const queryClient = useQueryClient();
  const products = useQuery(productsListQueryOptions(search));
  const [conditionsProductId, setConditionsProductId] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (product: ProductListItem) => deleteProduct(product, csrfToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productsKeys.lists() });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: productsKeys.lists() });
    },
  });

  const rows = products.data?.items ?? [];
  const total = products.data?.total ?? 0;
  const pageCount = Math.ceil(total / search.pageSize);
  const pagination: PaginationState = { pageIndex: search.page - 1, pageSize: search.pageSize };
  const sorting = productSortToSorting(search.sort);
  const conditionsProduct = conditionsProductId
    ? rows.find((product) => product.id === conditionsProductId)
    : undefined;
  const conditionsOpen = Boolean(conditionsProduct?.deletion?.blockers.length);

  function changeSearch(changes: Partial<ProductsSearch>, resetPage = true) {
    onSearchChange({
      ...search,
      ...changes,
      page: resetPage ? 1 : changes.page ?? search.page,
    });
  }

  function handleCommand(command: string, product: ProductListItem) {
    if (command === 'view-delete-conditions') {
      setConditionsProductId(product.id);
      return;
    }
    if (command === 'delete-product') {
      remove.mutate(product);
      return;
    }
    throw new Error(`Products 收到未知页面命令：${command}`);
  }

  const columns = useProductColumns({
    deletingProductId: remove.isPending ? remove.variables?.id : undefined,
    onCommand: handleCommand,
  });
  const table = useTable({
    features: productTableFeatures,
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
      changeSearch({ page: next.pageIndex + 1, pageSize: normalizeProductPageSize(next.pageSize) }, false);
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      changeSearch({ sort: sortingToProductSort(next) });
    },
  });
  const columnRoles = table.getAllLeafColumns().map((column) => column.columnDef.meta?.role);
  const filtered = hasProductsFilters(search);

  return (
    <section className="space-y-4" aria-labelledby="products-list-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 id="products-list-title" className="type-page-title">产品事实</h1>
          <p className="max-w-3xl text-text-secondary">查看产品当前事实状态，并进入服务端指定的下一项工作。</p>
        </div>
        <Link className={buttonVariants()} to="/products/new">新建产品</Link>
      </header>

      {remove.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{errorMessage(remove.error)}</span>
          <Button onClick={() => remove.reset()} size="sm" variant="outline">关闭</Button>
        </div>
      )}

      <TableToolbar>
        <ProductsFilters
          key={search.q ?? ''}
          onChange={(changes) => changeSearch(changes)}
          search={search}
        />
      </TableToolbar>

      <TableShell regionLabel="产品事实列表">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const role = header.column.columnDef.meta?.role;
                if (!role) return <th key={header.id} scope="col"><table.FlexRender header={header} /></th>;
                return (
                  <ColumnHeader
                    key={header.id}
                    onSort={header.column.getCanSort() ? () => header.column.toggleSorting() : undefined}
                    role={role}
                    sortDirection={header.column.getCanSort() ? header.column.getIsSorted() : false}
                  >
                    <table.FlexRender header={header} />
                  </ColumnHeader>
                );
              })}
            </tr>
          ))}
        </thead>

        {products.isPending ? (
          <TableSkeleton columnRoles={columnRoles} />
        ) : products.error ? (
          <EmptyTable
            action={<Button onClick={() => void products.refetch()} variant="outline">重试</Button>}
            colSpan={columns.length}
            description={errorMessage(products.error)}
            kind="error"
            title="产品列表加载失败"
          />
        ) : total === 0 ? (
          <EmptyTable
            action={filtered ? <Button onClick={() => changeSearch({ q: undefined, factStatus: undefined, workflowStage: undefined })} variant="outline">清除筛选</Button> : undefined}
            colSpan={columns.length}
            description={filtered ? '没有符合当前搜索和筛选条件的产品。' : '当前还没有产品记录。'}
            kind={filtered ? 'filtered-empty' : 'empty'}
            title={filtered ? '未找到匹配产品' : '暂无产品'}
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

      {!products.isPending && !products.error && (
        <TablePagination
          onPageIndexChange={(pageIndex) => changeSearch({ page: pageIndex + 1 }, false)}
          onPageSizeChange={(pageSize) => changeSearch({ pageSize: normalizeProductPageSize(pageSize) })}
          pageCount={pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          totalItems={total}
        />
      )}

      <ProductDeletionConditionsDialog
        open={conditionsOpen}
        product={conditionsProduct}
        refreshing={products.isFetching}
        onClose={() => setConditionsProductId(null)}
        onRefresh={async () => {
          await products.refetch();
        }}
      />
    </section>
  );
}

function useProductColumns({
  deletingProductId,
  onCommand,
}: {
  deletingProductId?: string;
  onCommand: (command: string, product: ProductListItem) => void;
}) {
  const columnHelper = useMemo(() => createColumnHelper<typeof productTableFeatures, ProductListItem>(), []);
  return useMemo(() => columnHelper.columns([
    columnHelper.accessor('part_number', {
      header: '产品',
      meta: { role: 'primary' },
      sortDescFirst: false,
      cell: ({ row }) => <ProductIdentity product={row.original} />,
    }),
    columnHelper.accessor('category', {
      header: '类别',
      meta: { role: 'metadata' },
      enableSorting: false,
      cell: ({ getValue }) => <TruncatedText text={getValue()} />,
    }),
    columnHelper.accessor('fact_status', {
      header: '事实状态',
      meta: { role: 'status' },
      enableSorting: false,
      cell: ({ getValue }) => <ProductStatusBadge status={getValue()} />,
    }),
    columnHelper.accessor('current_fact', {
      header: '当前事实',
      meta: { role: 'metadata' },
      enableSorting: false,
      cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs">{formatCurrentFact(getValue())}</span>,
    }),
    columnHelper.accessor('updated_at', {
      header: '最近更新',
      meta: { role: 'date' },
      cell: ({ getValue }) => <ProductRelativeTime value={getValue()} />,
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      meta: { role: 'actions' },
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          objectLabel={row.original.part_number}
          onCommand={(command) => onCommand(command, row.original)}
          overflow={resolveProductOverflowActions(row.original, {
            deleting: deletingProductId === row.original.id,
            surface: 'list',
          })}
          primary={resolveProductPrimaryAction(row.original)}
        />
      ),
    }),
  ]), [columnHelper, deletingProductId, onCommand]);
}

function ProductsFilters({
  onChange,
  search,
}: {
  onChange: (changes: Partial<ProductsSearch>) => void;
  search: ProductsSearch;
}) {
  const [query, setQuery] = useState(search.q ?? '');
  return (
    <FilterBar
      filters={(
        <>
          <ProductFilterSelect
            ariaLabel="事实状态"
            items={Object.entries(productFactStatusRegistry).map(([value, presentation]) => ({ value, label: presentation.label }))}
            onChange={(value) => onChange({ factStatus: value === 'ALL' ? undefined : value as ProductFactStatus })}
            value={search.factStatus ?? 'ALL'}
          />
          <ProductFilterSelect
            ariaLabel="工作流阶段"
            items={Object.entries(productWorkflowStageRegistry).map(([value, presentation]) => ({ value, label: presentation.label }))}
            onChange={(value) => onChange({ workflowStage: value === 'ALL' ? undefined : value as ProductWorkflowStage })}
            value={search.workflowStage ?? 'ALL'}
          />
        </>
      )}
      onQueryChange={setQuery}
      onReset={() => {
        setQuery('');
        onChange({ q: undefined, factStatus: undefined, workflowStage: undefined });
      }}
      onSubmit={() => onChange({ q: query.trim() || undefined })}
      placeholder="搜索型号或品牌"
      query={query}
      resetDisabled={!query && !search.q && !search.factStatus && !search.workflowStage}
      searchLabel="搜索产品"
    />
  );
}

function ProductFilterSelect({
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
  const allItems = [{ value: 'ALL', label: `全部${ariaLabel}` }, ...items];
  return (
    <Select items={allItems} onValueChange={(next) => next && onChange(next)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className="w-full md:w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ProductIdentity({ product }: { product: ProductListItem }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Tooltip>
        <TooltipTrigger
          render={(
            <Link
              className="table-cell-ellipsis rounded-sm font-mono font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              params={{ productId: product.id }}
              to="/products/$productId"
            />
          )}
        >
          {product.part_number}
        </TooltipTrigger>
        <TooltipContent>{product.part_number}</TooltipContent>
      </Tooltip>
      <TruncatedText className="text-xs text-text-muted" text={product.brand} />
    </div>
  );
}

function TruncatedText({ className = '', text }: { className?: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={`table-cell-ellipsis block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`} tabIndex={0} />}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function ProductStatusBadge({ status }: { status: ProductFactStatus }) {
  const presentation = productFactStatusRegistry[status];
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge tabIndex={0} variant={presentation.tone} />}>
        {presentation.label}
      </TooltipTrigger>
      <TooltipContent>{presentation.description}</TooltipContent>
    </Tooltip>
  );
}

function ProductRelativeTime({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<time className="rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" dateTime={value} tabIndex={0} />}>
        {formatRelativeProductTime(value)}
      </TooltipTrigger>
      <TooltipContent>{formatExactProductTime(value)}</TooltipContent>
    </Tooltip>
  );
}

function errorMessage(error: unknown): ReactNode {
  return error instanceof Error ? error.message : String(error);
}

export { ProductsListPage };
export type { ProductsListPageProps };
