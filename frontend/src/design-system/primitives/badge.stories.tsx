import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '@/design-system/primitives/badge';

const meta = {
  title: 'Design System/Badge',
  component: Badge,
  args: { children: '默认' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SemanticStates: Story = {
  render: () => (
    <div className="flex max-w-full flex-wrap gap-2">
      <Badge variant="success">成功</Badge>
      <Badge variant="warning">警告</Badge>
      <Badge variant="info">信息</Badge>
      <Badge variant="destructive">危险</Badge>
      <Badge variant="outline">这是一个较长但仍应保持可读的标签</Badge>
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
