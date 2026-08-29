import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type DetailSectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

function DetailSection({ actions, children, className, description, title }: DetailSectionProps) {
  return (
    <section className={cn('border-b border-border-subtle p-4 last:border-b-0', className)}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="type-section-title text-text-primary">{title}</h2>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export { DetailSection };
export type { DetailSectionProps };
