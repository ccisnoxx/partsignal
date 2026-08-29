import type { Meta, StoryObj } from '@storybook/react-vite';

import { Textarea } from '@/design-system/primitives/textarea';

const meta = {
  title: 'Design System/Textarea',
  component: Textarea,
  args: { 'aria-label': '备注', placeholder: '输入备注' },
  decorators: [(Story) => <div className="w-full max-w-sm"><Story /></div>],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReviewStates: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Textarea aria-label="默认多行输入" placeholder="默认" />
      <Textarea aria-label="错误多行输入" aria-invalid defaultValue="无效值" />
      <Textarea aria-label="不可用多行输入" disabled defaultValue="不可编辑" />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
