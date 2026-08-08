import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '@/design-system/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu';

function ReviewMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>打开操作菜单</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem>查看详情</DropdownMenuItem>
          <DropdownMenuItem disabled>不可用操作</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">删除记录</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: 'Design System/DropdownMenu',
  component: ReviewMenu,
} satisfies Meta<typeof ReviewMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Keyboard: Story = {
  play: async () => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const item = await within(document.body).findByRole('menuitem', { name: '查看详情' });
    await waitFor(() => expect(item).toBeVisible());
  },
};
