import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MarkdownEditor, MarkdownPreview } from '@/design-system/editor/markdown-editor';

beforeAll(() => {
  Range.prototype.getClientRects = vi.fn(() => Object.assign([], { item: () => null }));
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
});

function ControlledEditor() {
  const [value, setValue] = useState('# 标题😀');
  return <MarkdownEditor ariaLabel="正文 Markdown" dirty onChange={setValue} revision={7} value={value} />;
}

function ToggleReadonlyEditor() {
  const [readOnly, setReadOnly] = useState(false);
  const [value, setValue] = useState('初始正文');
  return (
    <>
      <button onClick={() => setReadOnly((current) => !current)} type="button">切换只读</button>
      {readOnly ? (
        <MarkdownEditor ariaLabel="可切换正文" readOnly value={value} />
      ) : (
        <MarkdownEditor ariaLabel="可切换正文" onChange={setValue} value={value} />
      )}
    </>
  );
}

describe('Markdown Editor Kit', () => {
  it('CodeMirror 受控输入回调并显示 Unicode 字符数、行数与 revision', async () => {
    const user = userEvent.setup();
    render(<ControlledEditor />);

    const editor = screen.getByRole('textbox', { name: '正文 Markdown' });
    await user.click(editor);
    await user.keyboard('{Control>}{End}{/Control}');
    await user.type(editor, '\nA');

    expect(screen.getByText('7 字符 · 2 行')).toBeInTheDocument();
    expect(screen.getByText('Revision 7')).toBeInTheDocument();
    expect(screen.getByText('未保存')).toBeInTheDocument();
  });

  it('Edit/Preview 切换后渲染基础 CommonMark', async () => {
    const user = userEvent.setup();
    render(<MarkdownEditor ariaLabel="正文 Markdown" onChange={vi.fn()} value={'# 标题\n\n- 项目'} />);

    await user.click(screen.getByRole('tab', { name: '预览' }));
    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent('项目');
    await user.click(screen.getByRole('tab', { name: '编辑' }));
    expect(screen.getByRole('textbox', { name: '正文 Markdown' })).toBeInTheDocument();
  });

  it('Preview 阻断 raw HTML、script/event handler、javascript URL 和图片', () => {
    const { container } = render(
      <MarkdownPreview
        value={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n![图片](https://example.com/x.png)'}
      />,
    );

    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
    const dangerousText = screen.getByText('危险');
    expect(dangerousText.closest('a')).not.toHaveAttribute('href', expect.stringMatching(/^javascript:/i));
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('readonly snapshot 不可编辑且不会显示 dirty', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MarkdownEditor ariaLabel="审核快照" readOnly revision={12} value="冻结正文" />,
    );

    const content = container.querySelector('.cm-content');
    expect(content).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByText('只读快照')).toBeInTheDocument();
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    if (content) await user.type(content, '不会写入');
    expect(content).toHaveTextContent('冻结正文');
  });

  it('切换 readonly 时保留最新受控值', async () => {
    const user = userEvent.setup();
    render(<ToggleReadonlyEditor />);
    const editor = screen.getByRole('textbox', { name: '可切换正文' });
    await user.click(editor);
    await user.keyboard('{Control>}{End}{/Control}');
    await user.type(editor, '更新');
    const latestValue = editor.textContent;
    await user.click(screen.getByRole('button', { name: '切换只读' }));

    expect(screen.getByRole('textbox', { name: '可切换正文' })).toHaveTextContent(latestValue ?? '');
    expect(screen.getByRole('textbox', { name: '可切换正文' })).toHaveAttribute('contenteditable', 'false');
  });

  it('revision conflict 提供明确 reload 入口', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(
      <MarkdownEditor
        ariaLabel="冲突正文"
        conflict={{ message: '服务端已有更新，请重新加载后再编辑。', onReload: reload }}
        onChange={vi.fn()}
        revision={9}
        value="正文"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('检测到 revision 冲突');
    expect(screen.getByRole('alert')).toHaveTextContent('服务端已有更新');
    await user.click(screen.getByRole('button', { name: '重新加载最新版本' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
