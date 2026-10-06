import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';

const items = [
  { label: '草稿', value: 'draft' },
  { label: '审核中', value: 'review' },
  { label: '一个用于验证窄屏截断的很长选项名称', value: 'long' },
];

function StatusSelect({ disabled = false }: { disabled?: boolean }) {
  return (
    <Select items={items} defaultValue="draft" disabled={disabled}>
      <SelectTrigger aria-label="选择状态" className="max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const meta = {
  title: 'Design System/Select',
  component: StatusSelect,
} satisfies Meta<typeof StatusSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Narrow: Story = {
  render: () => <div className="w-full max-w-56"><StatusSelect /></div>,
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
