import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type SubNavTabItem = {
  active?: boolean;
  badge?: ReactNode;
  key: string;
  render: (props: { className: string; 'aria-current'?: 'page' }) => ReactNode;
};

type SubNavTabsProps = {
  ariaLabel: string;
  className?: string;
  items: readonly SubNavTabItem[];
};

const baseTabClass =
  'relative inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50';

function SubNavTabs({ ariaLabel, className, items }: SubNavTabsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border-subtle',
        className,
      )}
    >
      {items.map((item) => {
        const stateClass = item.active
          ? 'border-primary text-text-primary'
          : 'border-transparent text-text-secondary hover:border-border-default hover:text-text-primary';

        return (
          <div className="shrink-0" key={item.key}>
            {item.render({
              'aria-current': item.active ? 'page' : undefined,
              className: cn(baseTabClass, stateClass),
            })}
          </div>
        );
      })}
    </nav>
  );
}

export { SubNavTabs };
export type { SubNavTabItem, SubNavTabsProps };
