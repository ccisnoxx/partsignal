import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { RowActions } from '@/design-system/data-table/row-actions';
import { TableShell } from '@/design-system/data-table/table-shell';
import type { ColumnRole, OverflowRowAction } from '@/design-system/data-table/types';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import { actionLabels, formatTime, formatValue, primaryLabels, priorityLabels, ruleLabels, stageLabels, statusLabels, type Opportunity } from './opportunities.model';

const features = tableFeatures({ rowPaginationFeature, columnMeta: metaHelper<{ role: ColumnRole }>() });
type Action = components['schemas']['GeoOpportunityAction'];
export function OpportunityTable({ items, selected, onOpen }: { items: Opportunity[]; selected?: string; onOpen: (item: Opportunity, intent?: Action, focus?: HTMLElement | null) => void }) {
  const columns = useMemo(() => {
    const h = createColumnHelper<typeof features, Opportunity>();
    return h.columns([
      h.accessor('title', { header: '机会 / 规则', meta: { role: 'primary' }, cell: ({ row }) => <div className="min-w-0 max-w-sm"><Button type="button" variant="link" className="h-auto max-w-full justify-start p-0 text-left" onClick={() => onOpen(row.original)}><span className="table-cell-ellipsis">{row.original.title}</span></Button><p className="text-xs text-text-muted">{ruleLabels[row.original.rule_code]}</p></div> }),
      h.display({ id: 'priority-status', header: '优先级 / 状态', meta: { role: 'status' }, cell: ({ row: { original: o } }) => <div className="space-y-1"><Badge>{priorityLabels[o.priority]}</Badge><p>{statusLabels[o.status]}</p><p className="text-xs text-text-muted">阶段：{stageLabels[o.workflow_stage]} · r{o.revision}</p></div> }),
      h.display({ id: 'dimensions', header: '当前维度', meta: { role: 'metadata' }, cell: ({ row: { original: o } }) => <div className="max-w-xs text-xs"><p className="table-cell-ellipsis">{o.subject_name ?? '未限定对象'} · {o.query_topic_name ?? '未限定主题'}</p><p className="table-cell-ellipsis">{o.engine_surface_name ?? '未限定观测面'} · {o.collection_profile_name ?? '未限定配置'}</p></div> }),
      h.display({ id: 'trigger', header: '首次值 / 阈值 / 分子分母', meta: { role: 'numeric' }, cell: ({ row: { original: o } }) => <div className="text-xs tabular-nums"><p>{formatValue(o.value)} / {formatValue(o.threshold)}</p><p>{o.numerator} / {o.denominator}</p></div> }),
      h.display({ id: 'dates', header: '创建 / 最近评估', meta: { role: 'date' }, cell: ({ row: { original: o } }) => <div className="text-xs"><time dateTime={o.created_at}>{formatTime(o.created_at)}</time><p><time dateTime={o.last_seen_at}>{formatTime(o.last_seen_at)}</time></p></div> }),
      h.display({ id: 'counts', header: '来源 / 行动', meta: { role: 'numeric' }, cell: ({ row: { original: o } }) => `${o.source_count} / ${o.action_count}` }),
      h.display({ id: 'actions', header: '主任务', meta: { role: 'actions' }, cell: ({ row: { original: o } }) => {
        const overflow = o.available_actions.filter((action) => action !== o.primary_task).map((action): OverflowRowAction => {
          switch (action) {
            case 'ACKNOWLEDGE': return { key: action, label: actionLabels[action], intent: 'secondary', command: action, enabled: true };
            case 'DISMISS': return { key: action, label: actionLabels[action], intent: 'danger', command: action, enabled: true, confirmation: 'custom' };
            case 'RESOLVE': case 'CONTINUE': return { key: action, label: actionLabels[action], intent: 'secondary', command: action, enabled: true };
          }
        });
        return <RowActions objectLabel={o.title} primary={{ key: o.primary_task, label: primaryLabels[o.primary_task], intent: 'primary', command: o.primary_task, enabled: o.primary_task === 'VIEW_EVIDENCE' || o.available_actions.includes(o.primary_task) }} overflow={overflow} onCommand={(command, focus) => onOpen(o, command === 'VIEW_EVIDENCE' ? undefined : command as Action, focus)} />;
      } }),
    ]);
  }, [onOpen]);
  const table = useTable({ features, columns, data: items, getRowId: (row) => row.id });
  return <TableShell regionLabel="GEO 机会列表"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}><table.FlexRender header={header} /></ColumnHeader>)}</tr>)}</thead>{!items.length ? <EmptyTable kind="filtered-empty" colSpan={7} title="暂无匹配机会" description="请调整筛选条件；历史机会关闭后仍可读取证据。" /> : <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} aria-selected={selected === row.id}>{row.getAllCells().map((cell) => <td key={cell.id} data-column-role={cell.column.columnDef.meta?.role}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>}</TableShell>;
}
