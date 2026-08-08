import { useState } from 'react';

import { ActionConfirmationDialog } from '@/design-system/data-table/row-actions';
import type { BulkAction } from '@/design-system/data-table/types';
import { Button } from '@/design-system/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/design-system/primitives/tooltip';

type BulkActionBarProps = {
  actions: readonly BulkAction[];
  onClear: () => void;
  onCommand: (command: string) => void;
  selectedCount: number;
};

function BulkActionBar({ actions, onClear, onCommand, selectedCount }: BulkActionBarProps) {
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);

  if (selectedCount === 0) return null;

  function runAction(action: BulkAction) {
    if (!action.enabled) return;
    if (action.confirmation) {
      setPendingAction(action);
      return;
    }
    onCommand(action.command);
  }

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between" role="toolbar" aria-label="批量操作">
        <strong className="text-sm font-medium">已选择 {selectedCount} 项</strong>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => {
            const button = (
              <Button
                aria-disabled={!action.enabled}
                disabled={!action.enabled}
                focusableWhenDisabled={!action.enabled}
                onClick={() => runAction(action)}
                type="button"
                variant={action.intent === 'danger' ? 'destructive' : 'outline'}
              >
                {action.label}
              </Button>
            );

            return action.enabled ? (
              <span key={action.key}>{button}</span>
            ) : (
              <Tooltip key={action.key}>
                <TooltipTrigger render={button} />
                <TooltipContent>{action.disabledReason ?? '当前不可用'}</TooltipContent>
              </Tooltip>
            );
          })}
          <Button onClick={onClear} type="button" variant="ghost">清除选择</Button>
        </div>
      </div>
      <ActionConfirmationDialog
        confirmation={pendingAction?.confirmation ?? null}
        onConfirm={() => {
          if (pendingAction) onCommand(pendingAction.command);
          setPendingAction(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      />
    </>
  );
}

export { BulkActionBar };
export type { BulkActionBarProps };
