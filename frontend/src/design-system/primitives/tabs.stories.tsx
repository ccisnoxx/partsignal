import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design-system/primitives/tabs';

function ReviewTabs() {
  return (
    <Tabs defaultValue="summary" className="max-w-full">
      <TabsList className="max-w-full">
        <TabsTrigger value="summary">摘要</TabsTrigger>
        <TabsTrigger value="evidence">较长的证据说明</TabsTrigger>
        <TabsTrigger value="disabled" disabled>不可用</TabsTrigger>
      </TabsList>
      <TabsContent value="summary">摘要内容</TabsContent>
      <TabsContent value="evidence">证据说明内容</TabsContent>
    </Tabs>
  );
}

const meta = {
  title: 'Design System/Tabs',
  component: ReviewTabs,
} satisfies Meta<typeof ReviewTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
