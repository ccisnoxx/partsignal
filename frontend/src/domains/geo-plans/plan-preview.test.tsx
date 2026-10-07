import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlanPreviewPanel } from './plan-preview';
import { blockerLabels, type PlanBlocker } from './plan-preview.model';
import type { PlanPreview } from './plans.model';

function preview(overrides: Partial<PlanPreview> = {}): PlanPreview {
  return { prompt_count: 2, profile_count: 3, repeat_count: 4, run_count: 71, manual_run_count: 11, api_run_count: 22, browser_run_count: 33, unresolved_run_count: 5, estimated_cost: { value: null, currency: null, coverage: 'NONE', known_run_count: 0, unknown_run_count: 71, known_costs: [] }, blockers: [], warnings: [{ code: 'COST_UNKNOWN', field: 'estimated_cost', resource_id: null, related_resource_id: null }], ...overrides };
}
describe('服务端预览展示', () => {
  it('运行数和费用保持服务端值，即使本地乘法会得到不同数量', () => {
    render(<PlanPreviewPanel preview={preview()} />);
    expect(screen.getByText(/2 × 3 × 4 = 71/)).toBeInTheDocument();
    for (const [label, value] of [['总运行数', '71'], ['人工待录入数', '11'], ['API 运行数', '22'], ['浏览器运行数', '33'], ['未解析运行数', '5']]) expect(screen.getByText(label!).parentElement).toHaveTextContent(value!);
    expect(screen.getByText('已知部分小计：未知或无法合并 · 币种：未知或多个币种')).toBeInTheDocument();
    expect(screen.getByText(/未知费用不按零计入/)).toBeInTheDocument();
    expect(screen.getByText(/全部运行费用未知/)).toBeInTheDocument();
  });
  it('分币种已知小计与未知运行数量完整保留', () => {
    render(<PlanPreviewPanel preview={preview({ estimated_cost: { value: null, currency: null, coverage: 'PARTIAL', known_run_count: 20, unknown_run_count: 51, known_costs: [{ value: '12.120001', currency: 'CNY' }, { value: '4.3', currency: 'USD' }] } })} />);
    expect(screen.getByText('CNY 已知小计：12.120001')).toBeInTheDocument();
    expect(screen.getByText('USD 已知小计：4.3')).toBeInTheDocument();
    expect(screen.getByText(/已知费用运行数 20 · 未知费用运行数 51/)).toBeInTheDocument();
  });
  it('每个 blocker 展示字段、两种资源 ID、跳回按钮和安全的新标签页入口', async () => {
    const resource = '10000000-0000-4000-8000-000000000001';
    const related = '10000000-0000-4000-8000-000000000002';
    const blockers = (Object.keys(blockerLabels) as PlanBlocker['code'][]).map((code) => ({ code, field: `collection_profile_ids.${code}`, resource_id: resource, related_resource_id: related }));
    const onFix = vi.fn();
    render(<PlanPreviewPanel onFix={onFix} preview={preview({ blockers })} />);
    const user = userEvent.setup();
    const list = screen.getByText(`运行阻断（${blockers.length}）`).parentElement!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(blockers.length);
    for (const [index, row] of rows.entries()) {
      expect(row).toHaveTextContent(blockers[index]!.field);
      expect(row).toHaveTextContent(resource); expect(row).toHaveTextContent(related);
      await user.click(within(row).getByRole('button', { name: /修正此项/ }));
    }
    expect(onFix).toHaveBeenCalledTimes(blockers.length);
    expect(onFix).toHaveBeenCalledWith(1, resource); expect(onFix).toHaveBeenCalledWith(2, resource); expect(onFix).toHaveBeenCalledWith(3, resource); expect(onFix).toHaveBeenCalledWith(4, resource);
    for (const link of within(list).getAllByRole('link')) { expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer'); }
    expect(within(list).getByText(/工程师可查看非敏感摘要/)).toBeInTheDocument();
  });
});
