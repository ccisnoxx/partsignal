import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoreHorizontalIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/design-system/primitives/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu';
import { IconButton } from '@/design-system/primitives/icon-button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/design-system/primitives/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design-system/primitives/tabs';
import { Textarea } from '@/design-system/primitives/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/design-system/primitives/tooltip';

describe('PartSignal core primitives', () => {
  it('Textarea 保留原生多行输入语义', () => {
    render(<Textarea aria-label="备注" />);
    expect(screen.getByRole('textbox', { name: '备注' })).toHaveAttribute('data-slot', 'textarea');
  });

  it('IconButton 复用 Button 并要求可访问名称', () => {
    render(
      <IconButton aria-label="更多操作" variant="ghost">
        <MoreHorizontalIcon />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: '更多操作' })).toHaveAttribute('data-slot', 'button');
  });

  it.each(['success', 'warning', 'info'] as const)('Badge 提供 %s 语义 variant', (variant) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(`text-${variant}`);
  });

  it('Select 通过键盘打开并选择分组内选项', async () => {
    const user = userEvent.setup();
    const items = [
      { label: '草稿', value: 'draft' },
      { label: '审核中', value: 'review' },
    ];

    render(
      <Select items={items}>
        <SelectTrigger aria-label="选择状态">
          <SelectValue placeholder="选择状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox', { name: '选择状态' })).toHaveTextContent('审核中');
  });

  it('DropdownMenu 支持键盘打开并聚焦首项', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>操作</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>查看详情</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: '查看详情' })).toHaveFocus();
  });

  it('Dialog 具备标题，并在 Escape 关闭后恢复触发器焦点', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger render={<Button />}>打开对话框</DialogTrigger>
        <DialogContent>
          <DialogTitle>编辑信息</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole('button', { name: '打开对话框' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('编辑信息');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('Sheet 具备标题，并在 Escape 关闭后恢复触发器焦点', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger render={<Button />}>打开侧边面板</SheetTrigger>
        <SheetContent>
          <SheetTitle>辅助详情</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const trigger = screen.getByRole('button', { name: '打开侧边面板' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('辅助详情');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('Tabs 支持方向键移动并更新选中项', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">摘要</TabsTrigger>
          <TabsTrigger value="evidence">证据</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">摘要内容</TabsContent>
        <TabsContent value="evidence">证据内容</TabsContent>
      </Tabs>,
    );

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '证据' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: '证据' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Tooltip 允许键盘聚焦触发器并暴露说明', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" />}>查看说明</TooltipTrigger>
          <TooltipContent>完整说明</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: '查看说明' })).toHaveFocus();
    expect(await screen.findByText('完整说明')).toBeVisible();
  });
});
