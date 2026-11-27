import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type BannerTone = 'info' | 'success' | 'warning' | 'danger';

type InlineBannerProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  meta?: ReactNode;
  role?: 'alert' | 'status';
  title?: ReactNode;
  tone?: BannerTone;
};

const toneStyles: Record<BannerTone, { container: string; icon: string }> = {
  info: {
    container: 'border-info-border bg-info-surface text-text-primary',
    icon: 'text-info',
  },
  success: {
    container: 'border-success-border bg-success-surface text-text-primary',
    icon: 'text-success',
  },
  warning: {
    container: 'border-warning-border bg-warning-surface text-text-primary',
    icon: 'text-warning',
  },
  danger: {
    container: 'border-danger-border bg-danger-surface text-text-primary',
    icon: 'text-danger',
  },
};

const toneIcons = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
} as const;

function InlineBanner({
  actions,
  children,
  className,
  meta,
  role,
  title,
  tone = 'info',
}: InlineBannerProps) {
  const Icon = toneIcons[tone];
  const resolvedRole = role ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status');

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between',
        toneStyles[tone].container,
        className,
      )}
      data-banner-tone={tone}
      role={resolvedRole}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', toneStyles[tone].icon)} />
        <div className="min-w-0 flex-1 space-y-1">
          {title && <p className="font-semibold text-text-primary">{title}</p>}
          <div className="min-w-0 break-words text-text-secondary">{children}</div>
          {meta && <div className="break-all text-xs text-text-tertiary">{meta}</div>}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pl-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export { InlineBanner };
export type { BannerTone, InlineBannerProps };
