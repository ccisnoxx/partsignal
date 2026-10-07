import { useQuery } from '@tanstack/react-query';

import { EmptyTable } from '@/design-system/data-table/empty-table';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import type { FactHistorySearch } from './fact-history.model';
import { productFactHistoryQueryOptions, ProductRequestError } from './product.api';
import {
  confidentialityRegistry,
  formatExactProductTime,
  productFactStatusRegistry,
} from './product.model';

type ProductFactHistoryItem = components['schemas']['ProductFactHistoryItem'];
type ProductFactHistoryList = components['schemas']['ProductFactHistoryList'];

type FactHistoryPageProps = {
  onSearchChange: (search: FactHistorySearch) => void;
  productId: string;
  search: FactHistorySearch;
};

const columns = [
  ['版本', 'primary'],
  ['状态', 'status'],
  ['数据级别', 'metadata'],
  ['变更摘要', 'metadata'],
  ['提交人', 'metadata'],
  ['提交时间', 'date'],
] as const satisfies readonly (readonly [string, ColumnRole])[];

function FactHistoryPage({ onSearchChange, productId, search }: FactHistoryPageProps) {
  const history = useQuery(productFactHistoryQueryOptions(productId, search));
  const data = history.data;
  const mismatch = data ? !matchesProductBoundary(data, productId) : false;

  return (
    <section aria-labelledby="fact-history-title" className="min-w-0 space-y-4">
      <FactHistoryHeader data={mismatch ? undefined : data} productId={productId} />

      {data && history.error && !mismatch && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>刷新事实历史失败，已保留当前只读列表：{errorMessage(history.error)}</span>
          <Button onClick={() => void history.refetch()} size="sm" variant="outline">重试</Button>
        </div>
      )}

      <TableShell regionLabel="事实版本历史列表">
        <thead>
          <tr>
            {columns.map(([label, role]) => <th data-column-role={role} key={label} scope="col">{label}</th>)}
          </tr>
        </thead>
        {history.isPending ? (
          <TableSkeleton columnRoles={columns.map(([, role]) => role)} />
        ) : mismatch ? (
          <EmptyTable
            colSpan={columns.length}
            description="返回的产品或版本不属于当前 URL，未展示任何历史数据。"
            kind="error"
            title="未找到该产品的事实历史"
          />
        ) : !data && history.error ? (
          <FactHistoryFailure error={history.error} onRetry={() => void history.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyTable
            colSpan={columns.length}
            description="该产品尚未提交事实版本。"
            kind="empty"
            title="暂无事实版本历史"
          />
        ) : data ? (
          <tbody>{data.items.map((item) => <FactHistoryRow item={item} key={item.id} />)}</tbody>
        ) : null}
      </TableShell>

      {data && !mismatch && !history.isPending && (
        <TablePagination
          onPageIndexChange={(pageIndex) => onSearchChange({ ...search, page: pageIndex + 1 })}
          onPageSizeChange={(pageSize) => onSearchChange({
            page: 1,
            pageSize: normalizePageSize(pageSize),
          })}
          pageCount={Math.ceil(data.total / data.page_size)}
          pageIndex={data.page - 1}
          pageSize={data.page_size}
          totalItems={data.total}
        />
      )}
    </section>
  );
}

function FactHistoryHeader({
  data,
  productId,
}: {
  data?: ProductFactHistoryList;
  productId: string;
}) {
  return (
    <header className="space-y-2">
      <p className="type-label text-text-muted">只读历史</p>
      <h1 className="break-words type-page-title" id="fact-history-title">
        {data ? `${data.product.part_number} 事实版本历史` : '事实版本历史'}
      </h1>
      <p className="text-text-secondary">
        {data
          ? `${data.product.brand} · ${data.product.category}；版本顺序由服务端确定。`
          : `正在读取产品 ${productId} 的不可变版本记录。`}
      </p>
      <Badge variant="outline">只读 · 不可编辑</Badge>
    </header>
  );
}

function FactHistoryRow({ item }: { item: ProductFactHistoryItem }) {
  const status = productFactStatusRegistry[item.status];
  const detailHref = `/products/${encodeURIComponent(item.product_id)}/facts/versions/${encodeURIComponent(item.id)}`;
  return (
    <tr>
      <td data-column-role="primary">
        <a
          aria-label={`查看事实版本 v${item.version}（只读）`}
          className="rounded-sm font-mono font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={detailHref}
        >
          v{item.version}
        </a>
      </td>
      <td data-column-role="status"><Badge variant={status.tone}>{status.label}</Badge></td>
      <td data-column-role="metadata">{confidentialityRegistry[item.classification]}</td>
      <td data-column-role="metadata"><span className="table-cell-ellipsis block" title={item.change_summary}>{item.change_summary}</span></td>
      <td data-column-role="metadata"><code className="text-xs">{item.created_by}</code></td>
      <td data-column-role="date"><time dateTime={item.created_at}>{formatExactProductTime(item.created_at)}</time></td>
    </tr>
  );
}

function FactHistoryFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = error instanceof ProductRequestError && error.status === 404
    ? 'not-found'
    : error instanceof ProductRequestError && error.status === 403
      ? 'forbidden'
      : 'generic';
  const content = {
    'not-found': { title: '未找到产品事实历史', description: '该产品不存在，或已被删除。' },
    forbidden: { title: '无法访问产品事实历史', description: '当前会话不能读取该产品的事实历史。' },
    generic: { title: '事实版本历史加载失败', description: errorMessage(error) },
  }[kind];
  const requestId = error instanceof ProductRequestError ? error.detail?.request_id : undefined;
  return (
    <EmptyTable
      action={kind === 'generic' ? <Button onClick={onRetry} variant="outline">重试</Button> : undefined}
      colSpan={columns.length}
      description={<>{content.description}{requestId && <span className="mt-1 block break-all font-mono text-xs">请求 ID：{requestId}</span>}</>}
      kind="error"
      title={content.title}
    />
  );
}

function matchesProductBoundary(data: ProductFactHistoryList, productId: string) {
  const expected = productId.toLowerCase();
  return data.product.id.toLowerCase() === expected
    && data.items.every((item) => item.product_id.toLowerCase() === expected);
}

function normalizePageSize(value: number): FactHistorySearch['pageSize'] {
  if (value === 10 || value === 20 || value === 50) return value;
  throw new Error(`Fact History 收到未知分页大小：${value}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { FactHistoryPage };
export type { FactHistoryPageProps };
