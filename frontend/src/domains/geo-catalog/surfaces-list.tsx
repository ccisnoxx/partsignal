import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import type { ColumnRole } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { CatalogNotice, CatalogSelect } from './catalog-controls';
import { profileListQueryOptions, surfaceListQueryOptions } from './surfaces.api';
import { surfacesErrorMessage } from './surfaces-error';
import { kindLabels, modeLabels, primaryLabels, stageLabels, testLabels, type ConfigurationResource } from './surfaces.model';
import { surfacesSearchSchema, type SurfacesSearch } from './surfaces-search.model';

const features = tableFeatures({ rowPaginationFeature, columnMeta: metaHelper<{ role: ColumnRole }>() });
function SurfacesList({ search, onChange }: { search: SurfacesSearch; onChange: (search: SurfacesSearch) => void }) {
  const profiles = search.tab === 'profiles';
  const surfacesQuery = useQuery(surfaceListQueryOptions(search, !profiles));
  const profilesQuery = useQuery(profileListQueryOptions(search, profiles));
  const query = profiles ? profilesQuery : surfacesQuery;

  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, ConfigurationResource>();
    return helper.columns([
      helper.display({ id: 'name', header: profiles ? '采集配置' : '观测面', meta: { role: 'primary' }, cell: ({ row }) => <Link className={buttonVariants({ variant: 'link', className: 'h-auto max-w-full whitespace-normal break-words p-0 text-left' })} search={surfacesSearchSchema.parse({ ...search, new: undefined, editor: undefined, ...(profiles ? { profile_id: row.original.summary.id } : { surface_id: row.original.summary.id }) })} to="/configuration/geo-surfaces">{row.original.summary.name}</Link> }),
      helper.display({ id: 'kind', header: profiles ? '模式 / 观测面' : '类型 / 提供商', meta: { role: 'metadata' }, cell: ({ row }) => {
        const summary = row.original.summary;
        return 'collection_mode' in summary ? <><p>{modeLabels[summary.collection_mode]}</p><p className="break-words text-sm text-text-muted">{summary.engine_surface.name}</p></> : <><p>{kindLabels[summary.surface_kind]}</p><p className="text-sm text-text-muted">{summary.provider_brand}</p></>;
      } }),
      helper.accessor('workflow_stage', { header: '状态', meta: { role: 'status' }, cell: ({ getValue }) => <Badge variant={getValue() === 'ACTIVE' ? 'success' : getValue() === 'BLOCKED' ? 'warning' : 'secondary'}>{stageLabels[getValue()]}</Badge> }),
      helper.display({ id: 'context', header: profiles ? '语言 / 地区 / 测试' : '标识 / 合规', meta: { role: 'metadata' }, cell: ({ row }) => {
        const summary = row.original.summary;
        return 'collection_mode' in summary ? <><p>{summary.language_code} · {summary.region_code}</p><p className="text-sm text-text-muted">{testLabels[summary.last_test_status]}（{summary.last_test_status}）</p></> : <><p className="break-words">{summary.slug}</p><p className="text-sm text-text-muted">{summary.compliance_status}</p></>;
      } }),
      helper.display({ id: 'updated', header: '更新时间', meta: { role: 'date' }, cell: ({ row }) => <time dateTime={row.original.summary.updated_at}>{new Date(row.original.summary.updated_at).toLocaleString('zh-CN')}</time> }),
      helper.display({ id: 'actions', header: '下一步', meta: { role: 'actions' }, cell: ({ row }) => {
        const label = primaryLabels[row.original.primary_task];
        if (!label) throw new Error('GEO 配置返回未知主任务');
        return <RowActions objectLabel={row.original.summary.name} onCommand={() => onChange(surfacesSearchSchema.parse({ ...search, new: undefined, editor: undefined, ...(profiles ? { profile_id: row.original.summary.id } : { surface_id: row.original.summary.id }) }))} overflow={[]} primary={{ key: row.original.primary_task, command: 'OPEN', label, enabled: true, intent: 'primary' }} />;
      } }),
    ]);
  }, [onChange, profiles, search]);
  const page = search.page ?? 1;
  const size = search.page_size ?? 20;
  const total = query.data?.total ?? 0;
  const table = useTable({ features, columns, data: query.data?.items ?? [], getRowId: (row) => row.summary.id, manualPagination: true, rowCount: total, state: { pagination: { pageIndex: page - 1, pageSize: size } } });
  const filtered = Boolean(search.q || search.is_active !== undefined || search.surface_kind || search.collection_mode || (profiles && search.surface_id));
  return <section aria-label={profiles ? '采集配置工作台' : '观测面工作台'} className="min-w-0 space-y-3">
    <SurfacesFilters key={JSON.stringify([search.tab, search.q, profiles && search.surface_id])} onChange={onChange} search={search} />
    {query.isFetching && !query.isPending && <p role="status">正在刷新列表…</p>}
    {query.error && query.data && <CatalogNotice error>列表后台刷新失败：{surfacesErrorMessage(query.error)}<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表刷新</Button></CatalogNotice>}
    <TableShell regionLabel={profiles ? '采集配置列表' : '观测面列表'}>
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}><table.FlexRender header={header} /></ColumnHeader>)}</tr>)}</thead>
      {query.isPending ? <TableSkeleton columnRoles={['primary', 'metadata', 'status', 'metadata', 'date', 'actions']} /> : !query.data ? <EmptyTable action={<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button>} colSpan={6} description={surfacesErrorMessage(query.error)} kind="error" title="GEO 配置列表加载失败" /> : query.data.items.length === 0 ? <EmptyTable action={filtered ? <Button onClick={() => onChange(surfacesSearchSchema.parse({ tab: search.tab, profile_id: search.profile_id, ...(!profiles ? { surface_id: search.surface_id } : {}), new: search.new, editor: search.editor }))} type="button" variant="outline">清除筛选</Button> : undefined} colSpan={6} description={filtered ? '请调整筛选条件。' : '管理员可以创建配置。'} kind={filtered ? 'filtered-empty' : 'empty'} title={filtered ? '未找到匹配配置' : '暂无配置'} /> : <tbody>{table.getRowModel().rows.map((row) => <tr aria-selected={(profiles ? search.profile_id : search.surface_id) === row.id} key={row.id}>{row.getAllCells().map((cell) => <td className="break-words" data-column-role={cell.column.columnDef.meta?.role} key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>}
    </TableShell>
    {query.data && <TablePagination onPageIndexChange={(index) => onChange(surfacesSearchSchema.parse({ ...search, page: index + 1 }))} onPageSizeChange={(next) => onChange(surfacesSearchSchema.parse({ ...search, page_size: next, page: 1 }))} pageCount={Math.ceil(total / size)} pageIndex={page - 1} pageSize={size} totalItems={total} />}
    {query.data && query.data.items.length === 0 && total > 0 && <CatalogNotice>当前页已无结果。<Button onClick={() => onChange(surfacesSearchSchema.parse({ ...search, page: Math.max(1, Math.ceil(total / size)) }))} type="button" variant="link">返回最后有效页</Button></CatalogNotice>}
  </section>;
}
function SurfacesFilters({ search, onChange }: { search: SurfacesSearch; onChange: (search: SurfacesSearch) => void }) {
  const [q, setQ] = useState(search.q ?? '');
  const [surfaceId, setSurfaceId] = useState(search.surface_id ?? '');
  const [error, setError] = useState('');
  const profiles = search.tab === 'profiles';
  function change(values: Partial<SurfacesSearch>) { onChange(surfacesSearchSchema.parse({ ...search, ...values, page: 1 })); }
  return <div className="min-w-0 space-y-3 rounded-xl border border-border-default bg-surface-panel p-3">
    <form aria-label="搜索 GEO 配置" className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (profiles && surfaceId.trim() && !canonicalUuidSchema.safeParse(surfaceId.trim()).success) { setError('观测面 ID 必须为合法 UUID，或留空。'); return; }
      setError(''); change({ q, ...(profiles ? { surface_id: surfaceId } : {}) });
    }}><label className="min-w-0 flex-1 space-y-1 text-sm">搜索配置名称<Input maxLength={240} onChange={(event) => setQ(event.target.value)} value={q} /></label>{profiles && <label className="min-w-0 flex-1 space-y-1 text-sm">筛选观测面 ID<Input maxLength={36} onChange={(event) => setSurfaceId(event.target.value)} value={surfaceId} /></label>}<Button type="submit">应用搜索</Button></form>
    {error && <CatalogNotice error>{error}</CatalogNotice>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-3"><CatalogSelect choices={[{ value: '', label: '全部状态' }, { value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} label="筛选启用状态" onChange={(value) => change({ is_active: value === '' ? undefined : value === 'true' })} value={search.is_active === undefined ? '' : String(search.is_active)} />
      {profiles ? <CatalogSelect choices={[{ value: '', label: '全部模式' }, ...Object.entries(modeLabels).map(([value, label]) => ({ value, label }))]} label="筛选采集模式" onChange={(value) => change({ collection_mode: value as SurfacesSearch['collection_mode'] })} value={search.collection_mode ?? ''} /> : <CatalogSelect choices={[{ value: '', label: '全部类型' }, ...Object.entries(kindLabels).map(([value, label]) => ({ value, label }))]} label="筛选观测面类型" onChange={(value) => change({ surface_kind: value as SurfacesSearch['surface_kind'] })} value={search.surface_kind ?? ''} />}
      <CatalogSelect choices={[{ value: 'NAME_ASC', label: '名称升序' }, { value: 'UPDATED_DESC', label: '最近更新' }]} label="配置列表排序" onChange={(value) => change({ sort: value as SurfacesSearch['sort'] })} value={search.sort ?? 'NAME_ASC'} />
    </div>
  </div>;
}
export { SurfacesList };
