import { useRef, useState, type ReactNode } from 'react';

import { ActionConfirmationDialog } from '@/design-system/data-table/row-actions';
import type { ActionConfirmation } from '@/design-system/data-table/types';
import { Button } from '@/design-system/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/design-system/primitives/tooltip';
import { cn } from '@/shared/lib/utils';

type StickyActionBase = {
  key: string;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  onSelect: () => void;
};

type StickyAction =
  | (StickyActionBase & {
      intent: 'primary' | 'secondary';
      confirmation?: ActionConfirmation;
    })
  | (StickyActionBase & {
      intent: 'danger';
      confirmation: ActionConfirmation;
    });

type StickyActionBarProps = {
  actions: readonly StickyAction[];
  status?: ReactNode;
  className?: string;
};

function StickyActionBar({ actions, className, status }: StickyActionBarProps) {
  const [pendingAction, setPendingAction] = useState<StickyAction | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  function runAction(action: StickyAction, trigger: HTMLButtonElement) {
    if (!action.enabled) return;
    if (action.confirmation) {
      returnFocusRef.current = trigger;
      setPendingAction(action);
      return;
    }
    action.onSelect();
  }

  function closeDialog() {
    setPendingAction(null);
    queueMicrotask(() => returnFocusRef.current?.focus());
  }

  function confirmAction() {
    pendingAction?.onSelect();
    closeDialog();
  }

  function actionButton(action: StickyAction) {
    const variant = action.intent === 'danger'
      ? 'destructive'
      : action.intent === 'secondary'
        ? 'outline'
        : 'default';

    if (!action.enabled) {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled
                focusableWhenDisabled
                onClick={(event) => runAction(action, event.currentTarget)}
                type="button"
                variant={variant}
              />
            }
          >
            {action.label}
          </TooltipTrigger>
          <TooltipContent>{action.disabledReason ?? '当前不可用'}</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Button
        onClick={(event) => runAction(action, event.currentTarget)}
        type="button"
        variant={variant}
      >
        {action.label}
      </Button>
    );
  }

  return (
    <>
      <div
        className={cn(
          'sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border-default bg-surface-panel/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.35)] backdrop-blur sm:flex-row sm:items-center sm:justify-between',
          className,
        )}
        data-safe-area="bottom"
      >
        <div className="min-h-5 text-sm text-text-secondary">{status}</div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          {actions.map((action) => (
            <div key={action.key}>{actionButton(action)}</div>
          ))}
        </div>
      </div>
      <ActionConfirmationDialog
        confirmation={pendingAction?.confirmation ?? null}
        onConfirm={confirmAction}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      />
    </>
  );
}

export { StickyActionBar };
export type { StickyAction, StickyActionBarProps };
