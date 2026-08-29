import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from '@/design-system/primitives/input';

const meta = {
  title: 'Design System/Input',
  component: Input,
  args: { 'aria-label': '产品型号', placeholder: '输入产品型号' },
  decorators: [(Story) => <div className="w-full max-w-sm"><Story /></div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReviewStates: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Input aria-label="默认输入" placeholder="默认" />
      <Input aria-label="长文本输入" defaultValue="PS-2026-VERY-LONG-PART-NUMBER-WITH-REVISION-AND-PACKAGE" />
      <Input aria-label="错误输入" aria-invalid defaultValue="无效值" />
      <Input aria-label="不可用输入" disabled defaultValue="不可编辑" />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
