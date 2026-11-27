import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/lib/utils';

type PageHeaderProps = {
  actions?: ReactNode;
  badges?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
};

function PageHeader({
  actions,
  badges,
  className,
  description,
  eyebrow,
  meta,
  title,
  titleClassName,
  titleId,
  titleRef,
  titleTabIndex,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {(eyebrow || badges) && (
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && <span className="type-label text-text-muted">{eyebrow}</span>}
            {badges}
          </div>
        )}
        <h1
          className={cn('type-page-title text-text-primary outline-none', titleClassName)}
          id={titleId}
          ref={titleRef}
          tabIndex={titleTabIndex}
        >
          {title}
        </h1>
        {description && <p className="max-w-3xl text-sm text-text-secondary">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">
          {actions}
        </div>
      )}
    </header>
  );
}

export { PageHeader };
export type { PageHeaderProps };
