import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/design-system/primitives/button';
import type { ColumnRole } from '@/design-system/data-table/types';
import { cn } from '@/shared/lib/utils';

type SortDirection = 'asc' | 'desc' | false;

type ColumnHeaderProps = Omit<ComponentProps<'th'>, 'children' | 'onClick'> & {
  children: ReactNode;
  onSort?: () => void;
  role: ColumnRole;
  sortDirection?: SortDirection;
};

function ColumnHeader({
  children,
  className,
  onSort,
  role,
  sortDirection = false,
  ...props
}: ColumnHeaderProps) {
  const ariaSort = sortDirection === false ? 'none' : sortDirection === 'asc' ? 'ascending' : 'descending';
  const SortIcon = sortDirection === 'asc' ? ArrowUpIcon : sortDirection === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon;

  return (
    <th
      aria-sort={onSort ? ariaSort : undefined}
      className={cn(className)}
      data-column-role={role}
      scope="col"
      {...props}
    >
      {onSort ? (
        <Button className="-ml-2 h-7 px-2" onClick={onSort} type="button" variant="ghost">
          <span>{children}</span>
          <SortIcon aria-hidden="true" className="size-3.5" />
        </Button>
      ) : children}
    </th>
  );
}

export { ColumnHeader };
export type { ColumnHeaderProps, SortDirection };
