import { useQuery } from '@tanstack/react-query';
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
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { planListOptions } from './plans.api';
import { planSearchSchema, scheduleLabels, stageLabels, statusLabels, type PlanDetail, type PlanSearch } from './plans.model';
import { parsePlanCommand, planOverflow, planPrimary } from './plan-actions';
import { PlanNotice, PlanSelect, planErrorMessage } from './plan-controls';

const features = tableFeatures({ rowPaginationFeature, columnMeta: metaHelper<{ role: ColumnRole }>() });
type OpenPlan = (plan: PlanDetail, command?: ReturnType<typeof parsePlanCommand>, focus?: HTMLElement | null) => void;
function PlanList({ search, onChange, onOpen }: { search: PlanSearch; onChange: (next: PlanSearch) => void; onOpen: OpenPlan }) {
  const query = useQuery(planListOptions(search));
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, PlanDetail>();
    return helper.columns([
      helper.accessor('name', { header: '计划名称', meta: { role: 'primary' }, cell: ({ row }) => <div className="min-w-0 max-w-md space-y-1"><Button className="h-auto w-full min-w-0 justify-start p-0 text-left" onClick={(event) => onOpen(row.original, undefined, event.currentTarget)} type="button" variant="link"><span className="table-cell-ellipsis">{row.original.name}</span></Button><p className="table-cell-ellipsis text-xs text-text-muted">Revision {row.original.revision}</p></div> }),
      helper.accessor('workflow_stage', { header: '状态', meta: { role: 'status' }, cell: ({ row, getValue }) => <div className="space-y-1"><Badge variant={getValue() === 'ACTIVE' ? 'success' : 'secondary'}>{stageLabels[getValue()]}</Badge><p className="text-xs">{statusLabels[row.original.status]}</p></div> }),
      helper.display({ id: 'matrix', header: '单次运行预览', meta: { role: 'metadata' }, cell: ({ row }) => <div className="text-sm"><p>{row.original.preview.run_count} 次运行</p><p className="text-xs text-text-muted">{row.original.preview.prompt_count} 个变体 · {row.original.preview.profile_count} 个配置 · {row.original.preview.repeat_count} 次重复</p>{row.original.preview.blockers.length > 0 && <p className="text-xs text-danger">存在运行阻断</p>}</div> }),
      helper.accessor('schedule_kind', { header: '调度配置', meta: { role: 'metadata' }, cell: ({ row, getValue }) => <div className="text-sm"><p>{scheduleLabels[getValue()]}</p><p className="text-xs text-text-muted">{row.original.cron_expression ?? '按需触发'} · {row.original.timezone}</p></div> }),
      helper.accessor('updated_at', { header: '更新时间', meta: { role: 'date' }, cell: ({ getValue }) => <time dateTime={getValue()}>{new Date(getValue()).toLocaleString('zh-CN')}</time> }),
      helper.display({ id: 'actions', header: '操作', meta: { role: 'actions' }, cell: ({ row }) => <RowActions objectLabel={row.original.name} onCommand={(command, focus) => onOpen(row.original, parsePlanCommand(command), focus)} overflow={planOverflow(row.original)} primary={planPrimary(row.original)} /> }),
    ]);
  }, [onOpen]);
  const page = search.page ?? 1; const size = search.page_size ?? 20;
  const table = useTable({ features, columns, data: query.data?.items ?? [], getRowId: (row) => row.id, rowCount: query.data?.total, manualPagination: true, state: { pagination: { pageIndex: page - 1, pageSize: size } } });
  const filtered = Boolean(search.q || search.status || search.schedule_kind);
  // 空态不需要可横向滚动的多列表头，避免窄屏把说明居中到可视区域之外。
  const empty = !query.isPending && !query.data?.items.length;
  return <section aria-label="监测计划列表工作区" className="min-w-0 space-y-3">
    <PlanFilters key={search.q ?? ''} onChange={onChange} search={search} />
    {query.isFetching && !query.isPending && <p role="status">正在刷新计划列表…</p>}
    {query.error && query.data && <PlanNotice error>列表刷新失败，保留上次读取结果：{planErrorMessage(query.error)}<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button></PlanNotice>}
    <TableShell className={empty ? "min-w-0! [&_thead]:hidden" : undefined} regionLabel="监测计划列表"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}><table.FlexRender header={header} /></ColumnHeader>)}</tr>)}</thead>
      {query.isPending ? <TableSkeleton columnRoles={['primary', 'status', 'metadata', 'metadata', 'date', 'actions']} /> : !query.data ? <EmptyTable action={<Button onClick={() => void query.refetch()} type="button" variant="outline">重试列表</Button>} colSpan={6} description={planErrorMessage(query.error)} kind="error" title="监测计划加载失败" /> : query.data.items.length === 0 ? <EmptyTable action={filtered ? <Button onClick={() => onChange(planSearchSchema.parse({ selected: search.selected, new: search.new, edit: search.edit }))} type="button" variant="outline">清除筛选</Button> : undefined} colSpan={6} description={filtered ? '请调整筛选条件。' : '新建计划，组合监测对象、实际提问和采集配置。'} kind={filtered ? 'filtered-empty' : 'empty'} title={filtered ? '未找到匹配计划' : '暂无监测计划'} /> : <tbody>{table.getRowModel().rows.map((row) => <tr aria-selected={search.selected === row.id} key={row.id}>{row.getAllCells().map((cell) => <td className="break-words" data-column-role={cell.column.columnDef.meta?.role} key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>}
    </TableShell>
    {query.data && <TablePagination onPageIndexChange={(index) => onChange(planSearchSchema.parse({ ...search, page: index + 1 }))} onPageSizeChange={(size) => onChange(planSearchSchema.parse({ ...search, page_size: size, page: 1 }))} pageCount={Math.ceil(query.data.total / size)} pageIndex={page - 1} pageSize={size} totalItems={query.data.total} />}
  </section>;
}
function PlanFilters({ search, onChange }: { search: PlanSearch; onChange: (next: PlanSearch) => void }) {
  const [q, setQ] = useState(search.q ?? '');
  function change(patch: Partial<PlanSearch>) { onChange(planSearchSchema.parse({ ...search, ...patch, page: 1 })); }
  return <div className="space-y-3 rounded-xl border border-border-default bg-surface-panel p-3"><form aria-label="筛选监测计划" className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); change({ q }); }}><label className="min-w-0 flex-1 space-y-1 text-sm">搜索计划名称<Input maxLength={200} onChange={(event) => setQ(event.target.value)} value={q} /></label><Button type="submit">应用筛选</Button></form><div className="grid min-w-0 gap-3 sm:grid-cols-3"><PlanSelect choices={[{ value: '', label: '全部状态' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} label="筛选计划状态" onChange={(value) => change({ status: value as PlanSearch['status'] })} value={search.status ?? ''} /><PlanSelect choices={[{ value: '', label: '全部调度' }, ...Object.entries(scheduleLabels).map(([value, label]) => ({ value, label }))]} label="筛选调度" onChange={(value) => change({ schedule_kind: value as PlanSearch['schedule_kind'] })} value={search.schedule_kind ?? ''} /><PlanSelect choices={[{ value: 'UPDATED_DESC', label: '最近更新' }, { value: 'NAME_ASC', label: '名称升序' }]} label="计划排序" onChange={(value) => change({ sort: value as PlanSearch['sort'] })} value={search.sort ?? 'UPDATED_DESC'} /></div></div>;
}
export { PlanList };
export type { OpenPlan };
