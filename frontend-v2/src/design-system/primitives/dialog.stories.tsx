import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/design-system/primitives/dialog';

function ReviewDialog({ danger = false }: { danger?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant={danger ? 'destructive' : 'outline'} />}>
        {danger ? '删除记录' : '打开对话框'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{danger ? '确认删除记录' : '编辑基础信息'}</DialogTitle>
          <DialogDescription>
            这段较长说明用于验证窄屏下内容仍然完整可读，并且焦点保持在对话框内部。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          {danger && <Button variant="destructive">确认删除</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  title: 'Design System/Dialog',
  component: ReviewDialog,
} satisfies Meta<typeof ReviewDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const DangerNarrow: Story = {
  args: { danger: true },
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
