import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  ServerTableDemo,
  createDemoRows,
  defaultOverflow,
  demoRows50,
  disabledOverflow,
  type DemoRow,
} from '@/design-system/data-table/server-table.demo';

const singleRow = createDemoRows(1);
const longTitleRows: DemoRow[] = [{
  ...singleRow[0]!,
  title: '这是一个用于验证主对象列省略、固定操作区和窄屏局部滚动边界的超长示例对象标题，不应撑破所属单元格或页面根节点',
}];
const onlyOverflowRows: DemoRow[] = [{ ...singleRow[0]!, primary: undefined, overflow: defaultOverflow }];
const noActionRows: DemoRow[] = [{ ...singleRow[0]!, primary: undefined, overflow: [] }];
const disabledRows: DemoRow[] = [{
  ...singleRow[0]!,
  primary: {
    key: 'blocked-primary',
    label: '继续处理',
    intent: 'primary',
    enabled: false,
    command: 'continue',
    disabledReason: '等待上游审核完成',
  },
  overflow: disabledOverflow,
}];

const meta = {
  title: 'Design System/Table Kit',
  component: ServerTableDemo,
  args: { rows: demoRows50 },
} satisfies Meta<typeof ServerTableDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServerControlled50Rows: Story = {};
export const Empty: Story = { args: { rows: [] } };
export const FilteredEmpty: Story = { args: { initialQuery: '不存在的对象', rows: demoRows50 } };
export const SingleRow: Story = { args: { rows: singleRow } };
export const Loading: Story = { args: { loading: true, rows: demoRows50 } };
export const Error: Story = { args: { error: '示例服务暂时不可用，请稍后重试。', rows: demoRows50 } };
export const LongTitle: Story = { args: { rows: longTitleRows } };
export const OnlyOverflow: Story = { args: { rows: onlyOverflowRows } };
export const NoAction: Story = { args: { rows: noActionRows } };
export const DisabledAndDestructive: Story = { args: { rows: disabledRows } };
export const Narrow375: Story = {
  args: { rows: demoRows50 },
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
