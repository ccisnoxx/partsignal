import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

type DeltaIndicatorProps = {
  changePoints: number | null;
  className?: string;
  formattedDelta: string;
  invertTone?: boolean;
};

function DeltaIndicator({
  changePoints,
  className,
  formattedDelta,
  invertTone = false,
}: DeltaIndicatorProps) {
  if (changePoints === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs font-medium text-text-secondary tabular-nums',
          className,
        )}
      >
        <MinusIcon aria-hidden="true" className="size-3" />
        <span>{formattedDelta}</span>
      </span>
    );
  }

  const positive = changePoints > 0;
  const zero = changePoints === 0;
  const good = zero ? null : invertTone ? !positive : positive;
  const Icon = zero ? MinusIcon : positive ? ArrowUpRightIcon : ArrowDownRightIcon;
  const toneClass = good === null
    ? 'border-border-subtle bg-surface-raised text-text-secondary'
    : good
      ? 'border-success-border bg-success-surface text-success'
      : 'border-danger-border bg-danger-surface text-danger';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        toneClass,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span>{formattedDelta}</span>
    </span>
  );
}

type ComparisonBarProps = {
  className?: string;
  current: number | null;
  currentLabel: string;
  previous: number | null;
  previousLabel: string;
};

function ComparisonBar({
  className,
  current,
  currentLabel,
  previous,
  previousLabel,
}: ComparisonBarProps) {
  const prevWidth = previous === null ? 0 : clampRatio(previous) * 100;
  const currWidth = current === null ? 0 : clampRatio(current) * 100;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-text-secondary">前期</span>
          <span className="font-mono tabular-nums text-text-secondary">{previousLabel}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
          {previous !== null && (
            <div
              className="h-full rounded-full bg-border-strong transition-all"
              style={{ width: `${prevWidth}%` }}
            />
          )}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-text-primary">当期</span>
          <span className="font-mono font-semibold tabular-nums text-text-primary">{currentLabel}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
          {current !== null && (
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${currWidth}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type ShareBarProps = {
  className?: string;
  label?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  value: number | null;
};

const barToneClasses = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
} as const;

function ShareBar({ className, label, tone = 'primary', value }: ShareBarProps) {
  const percent = value === null ? 0 : Math.round(clampRatio(value) * 1000) / 10;

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value === null ? undefined : Math.round(percent)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-raised', className)}
      role={label ? 'progressbar' : undefined}
    >
      {value !== null && (
        <div
          className={cn('h-full rounded-full transition-all', barToneClasses[tone])}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}

type CoverageProgressProps = {
  className?: string;
  label: string;
  targetRate: number | null;
  value: number | null;
  valueLabel: string;
};

function CoverageProgress({
  className,
  label,
  targetRate,
  value,
  valueLabel,
}: CoverageProgressProps) {
  const percent = value === null ? 0 : clampRatio(value) * 100;
  const targetPercent = targetRate === null ? null : clampRatio(targetRate) * 100;
  const reached = value !== null && targetRate !== null && value >= targetRate;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono font-semibold tabular-nums text-text-primary">{valueLabel}</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value === null ? undefined : Math.round(percent)}
        className="relative h-2 w-full overflow-visible rounded-full bg-surface-raised"
        role="progressbar"
      >
        {value !== null && (
          <div
            className={cn(
              'h-full rounded-full transition-all',
              reached ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${percent}%` }}
          />
        )}
        {targetPercent !== null && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 bottom-[-2px] w-0.5 rounded-full bg-text-primary/70"
            style={{ left: `${targetPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}

export { ComparisonBar, CoverageProgress, DeltaIndicator, ShareBar };
export type { ComparisonBarProps, CoverageProgressProps, DeltaIndicatorProps, ShareBarProps };
