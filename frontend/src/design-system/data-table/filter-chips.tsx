import { XIcon } from 'lucide-react';

import { Button } from '@/design-system/primitives/button';
import { cn } from '@/shared/lib/utils';

type FilterChipItem = {
  key: string;
  label: string;
  onRemove: () => void;
};

type FilterChipsBarProps = {
  className?: string;
  items: readonly FilterChipItem[];
  onClearAll?: () => void;
};

function FilterChipsBar({ className, items, onClearAll }: FilterChipsBarProps) {
  if (items.length === 0) return null;

  return (
    <div
      aria-label="已选筛选条件"
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      role="group"
    >
      <span className="text-xs font-medium text-text-tertiary">已选筛选：</span>
      {items.map((item) => (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-default bg-surface-raised px-2.5 py-0.5 text-xs text-text-primary"
          key={item.key}
        >
          <span className="truncate">{item.label}</span>
          <button
            aria-label={`移除筛选：${item.label}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-selected hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={item.onRemove}
            type="button"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      {onClearAll && items.length > 1 && (
        <Button className="h-6 px-2 text-xs" onClick={onClearAll} size="xs" type="button" variant="ghost">
          清空筛选
        </Button>
      )}
    </div>
  );
}

export { FilterChipsBar };
export type { FilterChipItem, FilterChipsBarProps };
