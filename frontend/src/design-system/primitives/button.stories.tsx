import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@/design-system/primitives/button';

const meta = {
  title: 'Design System/Button',
  component: Button,
  args: { children: '保存更改' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReviewStates: Story = {
  render: () => (
    <div className="flex max-w-full flex-wrap gap-3">
      <Button>主要操作</Button>
      <Button variant="secondary">次要操作</Button>
      <Button variant="outline">边框按钮</Button>
      <Button variant="destructive">删除</Button>
      <Button disabled>不可用</Button>
      <Button className="max-w-full truncate">这是一个用于验证窄屏和超长操作文案的按钮</Button>
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
