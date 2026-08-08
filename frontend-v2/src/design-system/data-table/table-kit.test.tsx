import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BulkActionBar } from '@/design-system/data-table/bulk-action-bar';
import { ColumnHeader } from '@/design-system/data-table/column-header';
import { EmptyTable } from '@/design-system/data-table/empty-table';
import { FilterBar } from '@/design-system/data-table/filter-bar';
import { RowActions } from '@/design-system/data-table/row-actions';
import {
  ServerTableDemo,
  createDemoRows,
  defaultOverflow,
  getServerResult,
} from '@/design-system/data-table/server-table.demo';
import { TablePagination } from '@/design-system/data-table/table-pagination';
import { TableShell } from '@/design-system/data-table/table-shell';
import { TableSkeleton } from '@/design-system/data-table/table-skeleton';
import type { BulkAction, PrimaryRowAction } from '@/design-system/data-table/types';

describe('Table Kit', () => {
  it('TableShell 提供命名滚动区域和原生表格语义', () => {
    render(
      <TableShell regionLabel="测试列表">
        <tbody><tr><td>内容</td></tr></tbody>
      </TableShell>,
    );

    const region = screen.getByRole('region', { name: '测试列表' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toHaveClass('ps-table');
  });

  it('ColumnHeader 暴露列角色、排序语义和受控切换', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <table><thead><tr>
        <ColumnHeader onSort={onSort} role="primary" sortDirection="asc">对象</ColumnHeader>
      </tr></thead></table>,
    );

    const header = screen.getByRole('columnheader', { name: '对象' });
    expect(header).toHaveAttribute('data-column-role', 'primary');
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: '对象' }));
    expect(onSort).toHaveBeenCalledOnce();
  });

  it('FilterBar 的查询、提交和重置完全由父组件控制', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onSubmit = vi.fn();
    const onReset = vi.fn();
    render(
      <FilterBar
        onQueryChange={onQueryChange}
        onReset={onReset}
        onSubmit={onSubmit}
        query="受控值"
      />,
    );

    const input = screen.getByRole('searchbox', { name: '搜索表格' });
    expect(input).toHaveValue('受控值');
    await user.type(input, '新');
    expect(onQueryChange).toHaveBeenCalledWith('受控值新');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await user.click(screen.getByRole('button', { name: '重置' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('TablePagination 正确限制首末页并受控更新页码', async () => {
    const user = userEvent.setup();
    const onPageIndexChange = vi.fn();
    render(
      <TablePagination
        onPageIndexChange={onPageIndexChange}
        onPageSizeChange={vi.fn()}
        pageCount={3}
        pageIndex={0}
        pageSize={10}
        totalItems={30}
      />,
    );

    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(onPageIndexChange).toHaveBeenCalledWith(1);
    expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument();
  });

  it('RowActions 只直出一个 Primary，命令不冒泡，danger 确认后才执行', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const onRowClick = vi.fn();
    const primary: PrimaryRowAction = {
      key: 'continue',
      label: '继续处理',
      intent: 'primary',
      enabled: true,
      command: 'continue',
    };
    render(
      <div onClick={onRowClick}>
        <RowActions objectLabel="示例对象" onCommand={onCommand} overflow={defaultOverflow} primary={primary} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: '继续处理' }));
    expect(onCommand).toHaveBeenCalledWith('continue');
    expect(onRowClick).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '更多操作：示例对象' }));
    await user.click(await screen.findByRole('menuitem', { name: '归档记录' }));
    expect(screen.getByRole('dialog', { name: '确认归档记录' })).toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalledWith('archive');
    await user.click(screen.getByRole('button', { name: '确认归档' }));
    expect(onCommand).toHaveBeenCalledWith('archive');
  });

  it('disabled Primary 与 overflow 都解释原因且不执行', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const primary: PrimaryRowAction = {
      key: 'blocked-primary',
      label: '继续处理',
      intent: 'primary',
      enabled: false,
      command: 'continue',
      disabledReason: '等待审核完成',
    };
    render(
      <RowActions
        objectLabel="示例对象"
        onCommand={onCommand}
        overflow={[{
          key: 'blocked-secondary',
          label: '提交审核',
          intent: 'secondary',
          enabled: false,
          command: 'submit',
          disabledReason: '缺少必填信息',
        }]}
        primary={primary}
      />,
    );

    const primaryButton = screen.getByRole('button', { name: '继续处理' });
    primaryButton.focus();
    expect(await screen.findByText('等待审核完成')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '更多操作：示例对象' }));
    const disabledItem = await screen.findByRole('menuitem', { name: /提交审核.*缺少必填信息/ });
    expect(disabledItem).toHaveAttribute('aria-disabled', 'true');
    await user.click(disabledItem);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('BulkActionBar 仅在有选择时出现并确认危险命令', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const actions: readonly BulkAction[] = [{
      key: 'delete',
      label: '删除',
      command: 'bulk-delete',
      intent: 'danger',
      enabled: true,
      confirmation: { title: '确认批量删除', description: '删除后无法恢复。' },
    }];
    const { rerender } = render(
      <BulkActionBar actions={actions} onClear={vi.fn()} onCommand={onCommand} selectedCount={0} />,
    );
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument();

    rerender(<BulkActionBar actions={actions} onClear={vi.fn()} onCommand={onCommand} selectedCount={2} />);
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(onCommand).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(onCommand).toHaveBeenCalledWith('bulk-delete');
  });

  it('EmptyTable 和 TableSkeleton 明确区分空态、筛选空态、错误与加载', () => {
    const { rerender } = render(
      <table><EmptyTable colSpan={2} description="没有记录" kind="empty" title="暂无数据" /></table>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('暂无数据');

    rerender(<table><EmptyTable colSpan={2} description="没有匹配" kind="filtered-empty" title="未找到" /></table>);
    expect(screen.getByRole('status')).toHaveTextContent('未找到');

    rerender(<table><EmptyTable colSpan={2} description="服务异常" kind="error" title="加载失败" /></table>);
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');

    rerender(<table><TableSkeleton columnRoles={['primary', 'actions']} rowCount={2} /></table>);
    expect(screen.getByRole('rowgroup', { name: '正在加载表格' })).toHaveAttribute('aria-busy', 'true');
  });

  it('server fixture 先筛选排序再分页，不把 manual 模式误当作请求', () => {
    const rows = createDemoRows(50);
    const result = getServerResult(
      rows,
      '示例对象',
      [{ id: 'score', desc: true }],
      { pageIndex: 1, pageSize: 10 },
    );

    expect(result.total).toBe(50);
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]?.score).toBeGreaterThan(result.rows[9]?.score ?? 0);
    expect(result.rows[0]?.id).toBe('row-40');
  });

  it('demo 的筛选、分页和 selection 由父组件控制', async () => {
    const user = userEvent.setup();
    render(<ServerTableDemo rows={createDemoRows(50)} />);

    expect(screen.getByRole('link', { name: '示例对象 01' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('link', { name: '示例对象 11' })).toBeInTheDocument();

    const input = screen.getByRole('searchbox', { name: '搜索表格' });
    await user.clear(input);
    await user.type(input, '示例对象 50');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('link', { name: '示例对象 50' })).toBeInTheDocument();
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '选择 示例对象 50' }));
    expect(screen.getByRole('toolbar', { name: '批量操作' })).toHaveTextContent('已选择 1 项');
    await user.click(screen.getByRole('button', { name: '清除选择' }));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument());
  });
});
