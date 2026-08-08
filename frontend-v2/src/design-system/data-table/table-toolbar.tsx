import type { ReactNode } from 'react';

type TableToolbarProps = {
  actions?: ReactNode;
  children: ReactNode;
};

function TableToolbar({ actions, children }: TableToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-panel p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { TableToolbar };
export type { TableToolbarProps };
