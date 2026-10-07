import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BatchSummary, RunDetail } from './run-detail';
import { detail, summary } from './runs.test-support';
describe('不可变运行证据', () => {
  it('保留原文、原始引用全部位置、完整批次汇总与未实现区段；HTML 不执行', () => {
    const { container } = render(
      <>
        <BatchSummary summary={summary()} />
        <RunDetail detail={detail()} onEdit={vi.fn()} onRefreshEvidence={vi.fn()} onSelectAttempt={vi.fn()} />
      </>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>danger()</script>原始回答')).toBeVisible();
    expect(screen.getByText('1 / 1, 3')).toBeVisible();
    expect(screen.getByRole('link', { name: '规格引用' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/费用已知：1 次；未知：3 次/)).toHaveTextContent('0.12 USD');
    expect(screen.getByText(/评估：NOT_IMPLEMENTED/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '人工录入' })).not.toBeInTheDocument();
  });
  it('过期截图保留回答与证据元数据，显式刷新访问链接', async () => {
    const refresh = vi.fn();
    render(<RunDetail detail={detail()} onEdit={vi.fn()} onRefreshEvidence={refresh} onSelectAttempt={vi.fn()} />);
    fireEvent.error(screen.getByRole('img', { name: '人工采集截图证据' }));
    expect(screen.getByRole('alert')).toHaveTextContent('链接可能已过期');
    expect(screen.getByText('<script>danger()</script>原始回答')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '刷新证据访问链接' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
