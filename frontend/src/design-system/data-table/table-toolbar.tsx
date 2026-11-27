import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type TableToolbarProps = {
  actions?: ReactNode;
  chips?: ReactNode;
  children: ReactNode;
  className?: string;
};

function TableToolbar({ actions, chips, children, className }: TableToolbarProps) {
  return (
    <div
      className={cn(
        'space-y-2.5 rounded-xl border border-border-subtle bg-surface-panel p-3 shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">{children}</div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {chips && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
          {chips}
        </div>
      )}
    </div>
  );
}

export { TableToolbar };
export type { TableToolbarProps };
