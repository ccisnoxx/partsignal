import type { ReactNode } from 'react';

import type { EmptyTableKind } from '@/design-system/data-table/types';

type EmptyTableProps = {
  action?: ReactNode;
  colSpan: number;
  description: ReactNode;
  kind: EmptyTableKind;
  title: string;
};

function EmptyTable({ action, colSpan, description, kind, title }: EmptyTableProps) {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan}>
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 py-8 text-center" role={kind === 'error' ? 'alert' : 'status'}>
            <strong className="text-sm font-semibold text-text-primary">{title}</strong>
            <div className="max-w-lg text-sm text-text-secondary">{description}</div>
            {action}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

export { EmptyTable };
export type { EmptyTableProps };
