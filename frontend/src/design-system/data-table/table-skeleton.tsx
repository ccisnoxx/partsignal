import { Skeleton } from '@/design-system/primitives/skeleton';
import type { ColumnRole } from '@/design-system/data-table/types';

type TableSkeletonProps = {
  columnRoles: readonly (ColumnRole | undefined)[];
  rowCount?: number;
};

function TableSkeleton({ columnRoles, rowCount = 5 }: TableSkeletonProps) {
  return (
    <tbody aria-busy="true" aria-label="正在加载表格">
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={rowIndex}>
          {columnRoles.map((role, columnIndex) => (
            <td data-column-role={role} key={`${role}-${columnIndex}`}>
              <Skeleton className={role === 'actions' ? 'ml-auto h-7 w-28' : 'h-4 w-full max-w-40'} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export { TableSkeleton };
export type { TableSkeletonProps };
