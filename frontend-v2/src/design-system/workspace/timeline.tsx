import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type TimelineItem = {
  id: string;
  title: string;
  description?: string;
  meta?: ReactNode;
};

type TimelineProps = {
  items: readonly TimelineItem[];
  emptyMessage?: string;
  className?: string;
};

function Timeline({ className, emptyMessage = '暂无记录', items }: TimelineProps) {
  if (items.length === 0) {
    return <p className={cn('text-sm text-text-muted', className)}>{emptyMessage}</p>;
  }

  return (
    <ol className={cn('space-y-4', className)}>
      {items.map((item) => (
        <li className="relative border-l border-border-default pl-4" key={item.id}>
          <span aria-hidden="true" className="absolute top-1.5 -left-1 size-2 rounded-full bg-primary" />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium text-text-primary">{item.title}</p>
            {item.meta && <div className="text-xs text-text-muted">{item.meta}</div>}
          </div>
          {item.description && <p className="mt-1 text-sm text-text-secondary">{item.description}</p>}
        </li>
      ))}
    </ol>
  );
}

export { Timeline };
export type { TimelineItem, TimelineProps };
