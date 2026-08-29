import type { ComponentProps } from 'react';

import { cn } from '@/shared/lib/utils';

type TableShellProps = ComponentProps<'table'> & {
  regionLabel: string;
};

function TableShell({ regionLabel, className, ...props }: TableShellProps) {
  return (
    <div
      aria-label={regionLabel}
      className="ps-table-region"
      data-slot="table-region"
      role="region"
      tabIndex={0}
    >
      <table className={cn('ps-table', className)} {...props} />
    </div>
  );
}

export { TableShell };
export type { TableShellProps };
