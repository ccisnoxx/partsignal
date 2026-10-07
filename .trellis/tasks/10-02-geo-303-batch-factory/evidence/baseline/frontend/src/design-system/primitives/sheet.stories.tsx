import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@/design-system/primitives/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/design-system/primitives/sheet';

function ReviewSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>打开侧边面板</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>辅助详情</SheetTitle>
          <SheetDescription>较长的辅助说明在窄屏中应保持可读，关闭按钮也必须始终可达。</SheetDescription>
        </SheetHeader>
        <div className="flex-1 px-4 type-body">这里承载当前任务需要的辅助内容。</div>
        <SheetFooter>
          <Button>完成</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: 'Design System/Sheet',
  component: ReviewSheet,
} satisfies Meta<typeof ReviewSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
