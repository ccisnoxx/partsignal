import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@/design-system/primitives/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/design-system/primitives/sheet';

function ReviewSheet({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>打开侧边面板</SheetTrigger>
      <SheetContent size={size}>
        <SheetHeader>
          <SheetTitle>辅助详情</SheetTitle>
          <SheetDescription>较长的辅助说明在窄屏中应保持可读，关闭按钮也必须始终可达。</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3 type-body">
          <p>这里承载当前任务需要的辅助内容，长内容仅在 SheetBody 内部滚动，头尾保持粘性可见。</p>
          <p className="text-text-secondary">支持 sm / md / lg / xl / 2xl 五档尺寸以匹配审计、证据与对比抽屉。</p>
        </SheetBody>
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
export const WideXl: Story = {
  args: { size: 'xl' },
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
