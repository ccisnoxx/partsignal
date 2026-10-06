import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';

import { IconButton } from '@/design-system/primitives/icon-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/design-system/primitives/tooltip';

const meta = {
  title: 'Design System/IconButton',
  component: IconButton,
  args: { 'aria-label': '更多操作' },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: 'ghost',
    children: <MoreHorizontalIcon />,
  },
};

export const ReviewStates: Story = {
  render: () => (
    <div className="flex gap-3">
      <Tooltip>
        <TooltipTrigger render={<IconButton aria-label="更多操作" variant="ghost" />}>
          <MoreHorizontalIcon />
        </TooltipTrigger>
        <TooltipContent>更多操作</TooltipContent>
      </Tooltip>
      <IconButton aria-label="删除" variant="destructive">
        <Trash2Icon />
      </IconButton>
      <IconButton aria-label="更多操作（不可用）" disabled>
        <MoreHorizontalIcon />
      </IconButton>
    </div>
  ),
};
