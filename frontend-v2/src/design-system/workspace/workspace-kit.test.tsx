import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';
import { Timeline } from '@/design-system/workspace/timeline';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';

let desktop = false;
const mediaListeners = new Set<() => void>();

beforeEach(() => {
  desktop = false;
  mediaListeners.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: desktop,
      media: '(min-width: 1280px)',
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function switchToDesktop() {
  desktop = true;
  act(() => mediaListeners.forEach((listener) => listener()));
}

const slots = {
  context: { label: '上下文', content: <p>上下文内容</p> },
  main: { label: '正文', content: <p>正文内容</p> },
  reference: { label: '参考', content: <p>参考内容</p> },
};

describe('Workspace Kit', () => {
  it('窄屏只渲染一份 Main-first tabs，并支持键盘切换侧栏', async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell ariaLabel="事实工作区" {...slots} />);

    expect(screen.getByRole('region', { name: '事实工作区' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['正文', '上下文', '参考']);
    const mainTab = tabs[0];
    expect(mainTab).toHaveAttribute('aria-selected', 'true');

    mainTab?.focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tab', { name: '上下文' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('上下文内容')).toBeVisible();
  });

  it('桌面渲染固定三槽，主区域使用弹性最大列', () => {
    render(<WorkspaceShell ariaLabel="事实工作区" {...slots} />);
    switchToDesktop();

    const main = screen.getByRole('region', { name: '正文' });
    expect(main).toHaveAttribute('data-workspace-area', 'main');
    expect(main.parentElement).toHaveClass('grid-cols-[16rem_minmax(0,1fr)_20rem]');
    expect(screen.getByRole('region', { name: '上下文' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '参考' })).toBeInTheDocument();
  });

  it('缺少 optional pane 时仍保留主区域与 shell', () => {
    render(<WorkspaceShell ariaLabel="最小工作区" main={slots.main} />);

    expect(screen.getByRole('region', { name: '最小工作区' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByText('参考内容')).not.toBeInTheDocument();
  });

  it('loading 与 error 内容不会抹掉 Workspace shell', async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <WorkspaceShell
        ariaLabel="加载工作区"
        context={slots.context}
        main={{ label: '正文', content: <Skeleton aria-label="正文加载中" className="h-40" /> }}
        reference={slots.reference}
      />,
    );
    expect(screen.getByRole('region', { name: '加载工作区' })).toBeInTheDocument();
    expect(screen.getByLabelText('正文加载中')).toBeInTheDocument();

    rerender(
      <WorkspaceShell
        ariaLabel="加载工作区"
        context={slots.context}
        main={{ label: '正文', content: <Button onClick={retry}>重试加载</Button> }}
        reference={slots.reference}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: '加载工作区' })).toBeInTheDocument();
  });

  it('StickyActionBar 只执行 resolved actions，并显示禁用原因与 safe area', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const disabled = vi.fn();
    render(
      <StickyActionBar
        actions={[
          { key: 'save', label: '保存', intent: 'primary', enabled: true, onSelect: save },
          { key: 'submit', label: '提交', intent: 'secondary', enabled: false, disabledReason: '请先完成必填项', onSelect: disabled },
        ]}
        status="未保存"
      />,
    );

    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(screen.getByRole('button', { name: '提交' }));
    expect(save).toHaveBeenCalledOnce();
    expect(disabled).not.toHaveBeenCalled();
    await user.tab();
    expect(await screen.findByText('请先完成必填项')).toBeVisible();
    expect(screen.getByText('未保存').closest('[data-safe-area]')).toHaveAttribute('data-safe-area', 'bottom');
  });

  it('危险动作确认前不执行，取消后恢复触发器焦点', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(
      <StickyActionBar
        actions={[{
          key: 'remove',
          label: '删除草稿',
          intent: 'danger',
          enabled: true,
          confirmation: { title: '删除草稿？', description: '此操作无法撤销。', confirmLabel: '确认删除' },
          onSelect: remove,
        }]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '删除草稿' });
    await user.click(trigger);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '删除草稿？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it('DetailSection 与 Timeline 暴露结构语义和空态', () => {
    const { rerender } = render(
      <DetailSection title="版本详情" description="不可变快照">
        <Timeline items={[{ id: '1', title: '已提交审核', description: '由内容工程师提交', meta: '10:30' }]} />
      </DetailSection>,
    );
    expect(screen.getByRole('heading', { name: '版本详情' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent('已提交审核');

    rerender(<Timeline items={[]} />);
    expect(screen.getByText('暂无记录')).toBeInTheDocument();
  });
});
