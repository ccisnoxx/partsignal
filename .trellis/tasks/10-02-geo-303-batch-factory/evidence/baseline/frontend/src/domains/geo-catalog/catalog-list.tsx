import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { catalogListQueryOptions } from './catalog.api';
import { catalogSearchSchema, stageLabels, subjectTypeLabels, type CatalogSearch, type Subject } from './catalog.model';
import { CatalogNotice, CatalogSelect, catalogErrorMessage } from './catalog-controls';

const features = tableFeatures({ rowPaginationFeature, columnMeta: metaHelper<{ role: ColumnRole }>() });
function CatalogList({ search, onChange }: { search: CatalogSearch; onChange: (search: CatalogSearch) => void }) {
  const query = useQuery(catalogListQueryOptions(search));
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, Subject>();
    return helper.columns([
      helper.accessor('display_name', { header: '对象', meta: { role: 'primary' }, cell: ({ row }) => <Link className={buttonVariants({ variant: 'link', className: 'h-auto max-w-full whitespace-normal break-words p-0 text-left' })} search={catalogSearchSchema.parse({ ...search, new: undefined, subject_id: row.original.id })} to="/configuration/geo-entities">{row.original.display_name}</Link> }),
      helper.accessor('subject_type', { header: '类型', meta: { role: 'metadata' }, cell: ({ getValue }) => subjectTypeLabels[getValue()] }),
      helper.display({ id: 'parent', header: '父级品牌', meta: { role: 'metadata' }, cell: ({ row }) => row.original.parent?.display_name ?? '无父级' }),
      helper.accessor('workflow_stage', { header: '状态', meta: { role: 'status' }, cell: ({ getValue }) => <Badge variant={getValue() === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[getValue()]}</Badge> }),
      helper.accessor('updated_at', { header: '更新时间', meta: { role: 'date' }, cell: ({ getValue }) => <time dateTime={getValue()}>{new Date(getValue()).toLocaleString('zh-CN')}</time> }),
      helper.display({ id: 'next', header: '下一步', meta: { role: 'metadata' }, cell: ({ row }) => {
        const token = row.original.primary_task;
        switch (token) {
          case 'MANAGE_SUBJECT': return row.original.available_actions.length ? '维护配置' : '查看配置';
          case 'ENABLE_SUBJECT': return '查看并启用';
          default: return assertNever(token);
        }
      } }),
    ]);
  }, [search]);
  const size = search.page_size ?? 20;
  const page = search.page ?? 1;
  const total = query.data?.total ?? 0;
  const table = useTable({ features, columns, data: query.data?.items ?? [], getRowId: (row) => row.id, rowCount: total, manualPagination: true, state: { pagination: { pageIndex: page - 1, pageSize: size } } });
  const filtered = Boolean(search.q || search.subject_type || search.product_id || search.parent_subject_id || search.is_active !== undefined);
  const clear = () => onChange(catalogSearchSchema.parse({ subject_id: search.subject_id, new: search.new }));
  return <section aria-label="监测对象工作台" className="space-y-3">
    <CatalogFilters key={JSON.stringify([search.q, search.product_id, search.parent_subject_id])} onChange={onChange} search={search} />
    {query.isFetching && !query.isPending && <p role="status">正在刷新列表…</p>}
    <TableShell regionLabel="监测对象列表">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}><table.FlexRender header={header} /></ColumnHeader>)}</tr>)}</thead>
      {query.isPending ? <TableSkeleton columnRoles={['primary', 'metadata', 'metadata', 'status', 'date', 'metadata']} /> : query.error ? <EmptyTable action={<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button>} colSpan={6} description={catalogErrorMessage(query.error)} kind="error" title="对象列表加载失败" /> : !query.data?.items.length ? <EmptyTable action={filtered ? <Button onClick={clear} type="button" variant="outline">清除筛选</Button> : undefined} colSpan={6} description={filtered ? '请调整筛选条件或清除筛选。' : '管理员可以新建监测对象。'} kind={filtered ? 'filtered-empty' : 'empty'} title={filtered ? '未找到匹配对象' : '暂无监测对象'} /> : <tbody>{table.getRowModel().rows.map((row) => <tr aria-selected={search.subject_id === row.id} key={row.id}>{row.getAllCells().map((cell) => <td className="break-words" data-column-role={cell.column.columnDef.meta?.role} key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>}
    </TableShell>
    {query.data && !query.error && <TablePagination onPageIndexChange={(index) => onChange(catalogSearchSchema.parse({ ...search, page: index + 1 }))} onPageSizeChange={(next) => onChange(catalogSearchSchema.parse({ ...search, page_size: next, page: 1 }))} pageCount={Math.ceil(total / size)} pageIndex={page - 1} pageSize={size} totalItems={total} />}
  </section>;
}
function CatalogFilters({ search, onChange }: { search: CatalogSearch; onChange: (search: CatalogSearch) => void }) {
  const [q, setQ] = useState(search.q ?? '');
  const [product, setProduct] = useState(search.product_id ?? '');
  const [parent, setParent] = useState(search.parent_subject_id ?? '');
  const [error, setError] = useState('');
  function change(changes: Partial<CatalogSearch>) { onChange(catalogSearchSchema.parse({ ...search, ...changes, page: 1 })); }
  return <div className="space-y-3 rounded-xl border border-border-default bg-surface-panel p-3">
    <form aria-label="搜索监测对象" className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if ([product, parent].some((value) => value.trim() && !canonicalUuidSchema.safeParse(value.trim()).success)) { setError('产品 ID 和父级对象 ID 必须为 UUID，或留空。'); return; }
      setError(''); change({ q, product_id: product, parent_subject_id: parent });
    }}>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 space-y-1"><span className="text-sm">搜索名称、别名或域名</span><Input maxLength={240} onChange={(event) => setQ(event.target.value)} value={q} /></label><Button type="submit">应用搜索</Button></div>
      <details><summary className="cursor-pointer text-sm text-text-secondary">按产品或父级 ID 筛选</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">产品 ID<Input onChange={(event) => setProduct(event.target.value)} value={product} /></label><label className="space-y-1 text-sm">父级对象 ID<Input onChange={(event) => setParent(event.target.value)} value={parent} /></label></div></details>
      {error && <CatalogNotice error>{error}</CatalogNotice>}
    </form>
    <div className="grid gap-3 sm:grid-cols-3">
      <CatalogSelect choices={[{ value: '', label: '全部类型' }, ...Object.entries(subjectTypeLabels).map(([value, label]) => ({ value, label }))]} label="筛选对象类型" onChange={(value) => change({ subject_type: value as CatalogSearch['subject_type'] })} value={search.subject_type ?? ''} />
      <CatalogSelect choices={[{ value: '', label: '全部状态' }, { value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} label="筛选启用状态" onChange={(value) => change({ is_active: value === '' ? undefined : value === 'true' })} value={search.is_active === undefined ? '' : String(search.is_active)} />
      <CatalogSelect choices={[{ value: 'NAME_ASC', label: '名称升序' }, { value: 'UPDATED_DESC', label: '最近更新' }]} label="列表排序" onChange={(value) => change({ sort: value as CatalogSearch['sort'] })} value={search.sort ?? 'NAME_ASC'} />
    </div>
  </div>;
}
function assertNever(value: never): never { throw new Error(`Catalog 返回未知下一步：${String(value)}`); }
export { CatalogList };
