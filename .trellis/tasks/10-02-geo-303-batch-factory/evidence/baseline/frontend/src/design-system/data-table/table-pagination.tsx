import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@/design-system/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';

type TablePaginationProps = {
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  totalItems: number;
};

function TablePagination({
  onPageIndexChange,
  onPageSizeChange,
  pageCount,
  pageIndex,
  pageSize,
  pageSizeOptions = [10, 20, 50],
  totalItems,
}: TablePaginationProps) {
  const sizeItems = pageSizeOptions.map((size) => ({ label: `${size} 条/页`, value: String(size) }));
  const currentPage = pageCount === 0 ? 0 : pageIndex + 1;

  return (
    <nav aria-label="表格分页" className="flex flex-col gap-2 border-t border-border-subtle px-3 py-2 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
      <span>共 {totalItems} 条</span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={sizeItems}
          onValueChange={(value) => value && onPageSizeChange(Number(value))}
          value={String(pageSize)}
        >
          <SelectTrigger aria-label="每页条数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span aria-live="polite">第 {currentPage} / {pageCount} 页</span>
        <Button
          aria-label="上一页"
          disabled={pageIndex <= 0 || pageCount === 0}
          onClick={() => onPageIndexChange(pageIndex - 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          aria-label="下一页"
          disabled={pageCount === 0 || pageIndex >= pageCount - 1}
          onClick={() => onPageIndexChange(pageIndex + 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}

export { TablePagination };
export type { TablePaginationProps };
