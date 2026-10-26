import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrozenInput } from './manual-editor-view';
import { context, runId } from './manual.test-support';
import { RunDetail } from './run-detail';
import { detail } from './runs.test-support';

const surfaces = ['人工录入', '运行详情'] as const;
const promptText = '  # 冻结完整问题\r\n\r\n1. 比较型号 A / B\n\t保留缩进与标点。\n```text\n<script>原样保留</script>\n```\n尾行  \n';
const nextPrompt = '另一运行的完整问题\n保留最后换行\n';

function view(surface: (typeof surfaces)[number], id = runId, text = promptText) {
  if (surface === '人工录入') {
    const value = context({ run_id: id });
    value.input_snapshot.prompt = { ...value.input_snapshot.prompt, canonical_question: '问题标题', prompt_text: text };
    return <FrozenInput context={value} />;
  }
  const value = detail();
  value.run.id = id;
  value.run.input_snapshot.prompt = { ...value.run.input_snapshot.prompt, canonical_question: '问题标题', prompt_text: text };
  if (value.answer) value.answer.prompt_text = '回答记录中的问题文本也不是复制来源';
  return <RunDetail detail={value} onEdit={vi.fn()} onRefreshEvidence={vi.fn()} onSelectAttempt={vi.fn()} />;
}

afterEach(() => vi.restoreAllMocks());

describe.each(surfaces)('%s的冻结问题复制', (surface) => {
  it('键盘复制本 Run 的完整快照原文，保留格式和首尾空白', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    const { container } = render(view(surface));
    const button = screen.getByRole('button', { name: '复制完整问题' });
    expect(button).toHaveAttribute('type', 'button');
    expect(container.querySelector('pre')?.textContent).toBe(promptText);
    expect(container.querySelector('script')).toBeNull();
    button.focus();
    await user.keyboard('{Enter}');
    expect(write).toHaveBeenCalledExactlyOnceWith(promptText);
    expect(await navigator.clipboard.readText()).toBe(promptText);
    expect(screen.getByText('已复制本次运行的完整问题')).toHaveAttribute('aria-live', 'polite');
  });

  it.each(['拒绝写入', 'API 不可用'])('%s时明确提示失败，保留全文并可显式再试', async (failure) => {
    const user = userEvent.setup();
    const unavailable = failure === 'API 不可用'
      ? vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard)
      : undefined;
    if (!unavailable)
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new DOMException('拒绝写入', 'NotAllowedError'));
    const { container } = render(view(surface));
    await user.click(screen.getByRole('button', { name: '复制完整问题' }));
    expect(screen.getByText('复制失败，请手动选择冻结问题原文')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('已复制本次运行的完整问题')).not.toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe(promptText);
    unavailable?.mockRestore();
    await user.click(screen.getByRole('button', { name: '复制完整问题' }));
    expect(screen.getByText('已复制本次运行的完整问题')).toBeVisible();
    expect(await navigator.clipboard.readText()).toBe(promptText);
  });

  it('复制中禁止重复操作，切换 Run 后旧完成不会冒充新 Run 成功', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    const { rerender } = render(view(surface));
    await user.click(screen.getByRole('button', { name: '复制完整问题' }));
    expect(screen.getByRole('button', { name: '复制完整问题' })).toBeDisabled();
    expect(screen.getByText('正在复制完整问题…')).toBeVisible();
    rerender(view(surface, '10000000-0000-4000-8000-000000000099', nextPrompt));
    expect(screen.getByRole('button', { name: '复制完整问题' })).toBeEnabled();
    expect(screen.queryByText('正在复制完整问题…')).not.toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByText('已复制本次运行的完整问题')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制完整问题' }));
    expect(write).toHaveBeenNthCalledWith(1, promptText);
    expect(write).toHaveBeenNthCalledWith(2, nextPrompt);
    expect(screen.getByText('已复制本次运行的完整问题')).toBeVisible();
    rerender(view(surface));
    expect(screen.queryByText('已复制本次运行的完整问题')).not.toBeInTheDocument();
  });
});
