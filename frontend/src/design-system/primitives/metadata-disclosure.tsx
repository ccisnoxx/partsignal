import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type MetadataDisclosureProps = {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  id?: string;
  summary: ReactNode;
  summaryMeta?: ReactNode;
};

function MetadataDisclosure({
  children,
  className,
  defaultOpen = false,
  id,
  summary,
  summaryMeta,
}: MetadataDisclosureProps) {
  return (
    <details
      className={cn(
        'group/disclosure min-w-0 rounded-lg border border-border-subtle bg-surface-raised/60 text-xs',
        className,
      )}
      id={id}
      open={defaultOpen}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 break-words rounded-lg px-2.5 py-1.5 font-medium text-text-secondary transition-colors select-none hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-muted transition-transform duration-150 group-open/disclosure:rotate-90"
        />
        {summaryMeta ? (
          <>
            <span className="min-w-0 truncate">{summary}</span>
            <span className="ml-auto shrink-0 text-text-tertiary">{summaryMeta}</span>
          </>
        ) : (
          summary
        )}
      </summary>
      <div className="min-w-0 border-t border-border-subtle px-2.5 py-2 text-text-secondary">
        {children}
      </div>
    </details>
  );
}

type MetadataEntry = {
  label: string;
  mono?: boolean;
  value: ReactNode;
};

function MetadataList({
  className,
  items,
}: {
  className?: string;
  items: readonly MetadataEntry[];
}) {
  return (
    <dl className={cn('grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div className="min-w-0" key={item.label}>
          <dt className="text-[11px] font-medium text-text-tertiary">{item.label}</dt>
          <dd className={cn('min-w-0 break-all text-text-primary', item.mono && 'type-mono text-xs')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export { MetadataDisclosure, MetadataList };
export type { MetadataDisclosureProps, MetadataEntry };
