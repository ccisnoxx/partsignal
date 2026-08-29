import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { MarkdownEditor } from '@/design-system/editor/markdown-editor';

const longMarkdown = `# 电气特性

这是用于验证长 Markdown、滚动、搜索和预览的正文。

## 额定参数

- 工作电压：5V
- 工作温度：-40°C 至 85°C
- 封装：QFN-32

## 说明

${Array.from({ length: 24 }, (_, index) => `${index + 1}. 第 ${index + 1} 条验证记录，Markdown 是唯一可编辑正文。`).join('\n')}

> 保存和 revision 校验始终由 Server 最终裁决。
`;

type EditorStoryProps = {
  initialValue?: string;
  readOnly?: boolean;
  dirty?: boolean;
  conflict?: boolean;
};

function EditorStory({ conflict, dirty = true, initialValue = longMarkdown, readOnly }: EditorStoryProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <main className="min-h-screen bg-surface-app p-6">
      <h1 className="sr-only">Markdown Editor Kit</h1>
      {readOnly ? (
        <MarkdownEditor
          ariaLabel="事实 Markdown 正文"
          conflict={conflict ? { message: '服务端 revision 已更新，请重新加载后再继续。', onReload: fn() } : undefined}
          defaultMode="preview"
          readOnly
          revision={12}
          value={value}
        />
      ) : (
        <MarkdownEditor
          ariaLabel="事实 Markdown 正文"
          conflict={conflict ? { message: '服务端 revision 已更新，请重新加载后再继续。', onReload: fn() } : undefined}
          dirty={dirty}
          onChange={setValue}
          revision={12}
          value={value}
        />
      )}
    </main>
  );
}

const meta = {
  title: 'Design System/Markdown Editor',
  component: EditorStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EditorStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongMarkdown: Story = { name: 'Long Markdown', args: {} };
export const RevisionConflict: Story = { name: 'Revision Conflict', args: { conflict: true } };
export const ReadonlyReviewSnapshot: Story = {
  name: 'Readonly Review Snapshot',
  args: { dirty: false, readOnly: true },
};
