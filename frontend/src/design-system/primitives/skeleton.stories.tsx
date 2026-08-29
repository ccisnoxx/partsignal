import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from '@/design-system/primitives/skeleton';

const meta = {
  title: 'Design System/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { className: 'h-8 w-48 max-w-full' },
};

export const NarrowComposition: Story = {
  render: () => (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
