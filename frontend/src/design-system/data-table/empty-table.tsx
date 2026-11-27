import { AlertCircleIcon, InboxIcon, SearchXIcon } from 'lucide-react';
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
  const Icon = kind === 'error' ? AlertCircleIcon : kind === 'filtered-empty' ? SearchXIcon : InboxIcon;
  const iconClass = kind === 'error'
    ? 'bg-danger-surface text-danger border-danger-border'
    : 'bg-surface-raised text-text-muted border-border-subtle';

  return (
    <tbody>
      <tr>
        <td colSpan={colSpan}>
          <div
            className="flex min-h-48 flex-col items-center justify-center gap-2.5 px-4 py-10 text-center"
            role={kind === 'error' ? 'alert' : 'status'}
          >
            <span
              aria-hidden="true"
              className={`flex size-10 items-center justify-center rounded-full border ${iconClass}`}
            >
              <Icon className="size-5" />
            </span>
            <strong className="text-sm font-semibold text-text-primary">{title}</strong>
            <div className="max-w-lg text-sm text-text-secondary">{description}</div>
            {action && <div className="mt-1">{action}</div>}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

export { EmptyTable };
export type { EmptyTableProps };
