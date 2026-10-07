import { createColumnHelper, metaHelper, rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { TableShell } from '@/design-system/data-table/table-shell';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  batchPrimaryLabels,
  batchStatusLabels,
  modeLabels,
  runCost,
  runPrimaryLabels,
  runStatusLabels,
  timestamp,
  type Batch,
  type Run,
} from './runs.model';

const features = tableFeatures({
  rowPaginationFeature,
  columnMeta: metaHelper<{ role: 'primary' | 'status' | 'metadata' | 'date' | 'actions' }>(),
});
function BatchTable({
  items,
  selected,
  onOpen,
}: {
  items: Batch[];
  selected?: string;
  onOpen: (batch: Batch) => void;
}) {
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, Batch>();
    return helper.columns([
      helper.accessor('plan_name', {
        header: '冻结计划 / 批次',
        meta: { role: 'primary' },
        cell: ({ row }) => (
          <div className="min-w-0 max-w-sm">
            <Button
              className="h-auto max-w-full justify-start p-0 text-left"
              onClick={() => onOpen(row.original)}
              type="button"
              variant="link"
            >
              <span className="table-cell-ellipsis">{row.original.plan_name}</span>
            </Button>
            <p className="break-all text-xs text-text-muted">{row.id}</p>
          </div>
        ),
      }),
      helper.accessor('status', {
        header: '状态 / 触发',
        meta: { role: 'status' },
        cell: ({ row, getValue }) => (
          <div className="space-y-1">
            <Badge>{batchStatusLabels[getValue()]}</Badge>
            <p className="text-xs">
              {row.original.trigger_type} · 计划修订 {row.original.plan_revision ?? '临时配置'}
            </p>
          </div>
        ),
      }),
      helper.display({
        id: 'counts',
        header: '采样 / 人工 / 成功 / 失败',
        meta: { role: 'metadata' },
        cell: ({ row }) => (
          <span>
            {row.original.summary.requested_run_count} / {row.original.summary.pending_manual_count} /{' '}
            {row.original.summary.status_counts.completed} / {row.original.summary.status_counts.failed}
          </span>
        ),
      }),
      helper.display({
        id: 'cost',
        header: '已报告费用',
        meta: { role: 'metadata' },
        cell: ({ row }) => (
          <div>
            {row.original.summary.cost.known_costs.map((cost) => (
              <p key={cost.currency}>
                {cost.value} {cost.currency}
              </p>
            ))}
            <p className="text-xs text-text-muted">未知：{row.original.summary.cost.unknown_attempt_count} 次尝试</p>
          </div>
        ),
      }),
      helper.accessor('created_at', {
        header: '创建 / 开始 / 结束',
        meta: { role: 'date' },
        cell: ({ row, getValue }) => (
          <div className="space-y-1 text-xs">
            <p>{timestamp(getValue())}</p>
            <p>{timestamp(row.original.started_at)}</p>
            <p>{timestamp(row.original.finished_at)}</p>
          </div>
        ),
      }),
      helper.display({
        id: 'action',
        header: '主任务',
        meta: { role: 'actions' },
        cell: ({ row }) => (
          <Button onClick={() => onOpen(row.original)} type="button" variant="outline">
            {batchPrimaryLabels[row.original.primary_task]}
          </Button>
        ),
      }),
    ]);
  }, [onOpen]);
  const table = useTable({ features, columns, data: items, getRowId: (row) => row.id });
  return (
    <TableShell regionLabel="批次列表">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}>
                <table.FlexRender header={header} />
              </ColumnHeader>
            ))}
          </tr>
        ))}
      </thead>
      {!items.length ? (
        <EmptyTable kind="empty" colSpan={6} description="请调整筛选或从现有计划创建批次。" title="暂无匹配批次" />
      ) : (
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr aria-selected={selected === row.id} key={row.id}>
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
  );
}
function RunTable({
  items,
  selected,
  onOpen,
}: {
  items: Run[];
  selected?: string;
  onOpen: (run: Run, edit?: boolean) => void;
}) {
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, Run>();
    return helper.columns([
      helper.display({
        id: 'prompt',
        header: '冻结问题',
        meta: { role: 'primary' },
        cell: ({ row }) => (
          <div className="min-w-0 max-w-sm">
            <Button
              className="h-auto max-w-full justify-start p-0 text-left"
              onClick={() => onOpen(row.original)}
              type="button"
              variant="link"
            >
              <span className="table-cell-ellipsis">{row.original.input_snapshot.prompt.prompt_text}</span>
            </Button>
            <p className="break-all text-xs text-text-muted">{row.original.id}</p>
            <p className="text-xs text-text-muted">
              采样 {row.original.repeat_index} · 尝试 {row.original.attempt_no}
              {row.original.is_latest_attempt ? '' : ' · 历史'}
            </p>
          </div>
        ),
      }),
      helper.display({
        id: 'profile',
        header: '观测面 / 方式',
        meta: { role: 'metadata' },
        cell: ({ row }) => (
          <div className="max-w-xs">
            <p className="table-cell-ellipsis">{row.original.input_snapshot.profile.surface.name}</p>
            <p className="text-xs">{modeLabels[row.original.input_snapshot.profile.collection_mode]}</p>
          </div>
        ),
      }),
      helper.accessor('status', {
        header: '状态 / 错误',
        meta: { role: 'status' },
        cell: ({ row, getValue }) => (
          <div className="space-y-1">
            <Badge>{runStatusLabels[getValue()]}</Badge>
            {row.original.error_code && (
              <p className="max-w-xs break-words text-xs text-danger">{row.original.error_code}</p>
            )}
          </div>
        ),
      }),
      helper.display({
        id: 'cost',
        header: '耗时 / 费用',
        meta: { role: 'metadata' },
        cell: ({ row }) => (
          <div className="text-xs">
            <p>{row.original.duration_ms === null ? '耗时未知' : `${row.original.duration_ms} ms`}</p>
            <p>{runCost(row.original)}</p>
          </div>
        ),
      }),
      helper.accessor('created_at', {
        header: '创建时间',
        meta: { role: 'date' },
        cell: ({ getValue }) => <time dateTime={getValue()}>{timestamp(getValue())}</time>,
      }),
      helper.display({
        id: 'action',
        header: '主任务',
        meta: { role: 'actions' },
        cell: ({ row }) => (
          <Button
            onClick={() =>
              onOpen(
                row.original,
                row.original.primary_task === 'ENTER_MANUAL_OBSERVATION' &&
                  row.original.available_actions.includes('ENTER_MANUAL_OBSERVATION'),
              )
            }
            type="button"
            variant="outline"
          >
            {runPrimaryLabels[row.original.primary_task]}
          </Button>
        ),
      }),
    ]);
  }, [onOpen]);
  const table = useTable({ features, columns, data: items, getRowId: (row) => row.id });
  return (
    <TableShell regionLabel="运行列表">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <ColumnHeader key={header.id} role={header.column.columnDef.meta?.role ?? 'metadata'}>
                <table.FlexRender header={header} />
              </ColumnHeader>
            ))}
          </tr>
        ))}
      </thead>
      {!items.length ? (
        <EmptyTable kind="empty" colSpan={6} description="请调整筛选。" title="暂无匹配运行" />
      ) : (
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr aria-selected={selected === row.id} key={row.id}>
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
  );
}
export { BatchTable, RunTable };
