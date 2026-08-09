import { MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';

import { Button, buttonVariants } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu';
import { IconButton } from '@/design-system/primitives/icon-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/design-system/primitives/tooltip';
import type {
  ActionConfirmation,
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';

type ActionConfirmationDialogProps = {
  confirmation: ActionConfirmation | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

function ActionConfirmationDialog({
  confirmation,
  onConfirm,
  onOpenChange,
}: ActionConfirmationDialogProps) {
  return (
    <Dialog onOpenChange={(open) => onOpenChange(open)} open={confirmation !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation?.title}</DialogTitle>
          <DialogDescription>{confirmation?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={onConfirm} type="button" variant="destructive">
            {confirmation?.confirmLabel ?? '确认执行'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RowActionsProps = {
  objectLabel: string;
  onCommand: (command: string) => void;
  overflow: readonly OverflowRowAction[];
  primary?: PrimaryRowAction;
};

function DisabledPrimaryAction({ action }: { action: PrimaryRowAction }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-disabled="true"
            className="max-w-24 truncate"
            disabled
            focusableWhenDisabled
            type="button"
            variant="ghost"
          />
        }
      >
        {action.label}
      </TooltipTrigger>
      <TooltipContent>{action.disabledReason ?? '当前不可用'}</TooltipContent>
    </Tooltip>
  );
}

function PrimaryAction({ action, onCommand }: { action: PrimaryRowAction; onCommand: (command: string) => void }) {
  if (!action.enabled) {
    return <DisabledPrimaryAction action={action} />;
  }

  if (action.command !== undefined) {
    return (
      <Button className="max-w-24 truncate" onClick={() => onCommand(action.command)} type="button" variant="ghost">
        {action.label}
      </Button>
    );
  }

  return (
    <a className={buttonVariants({ className: 'max-w-24 truncate', variant: 'ghost' })} href={action.href}>
      {action.label}
    </a>
  );
}

function RowActions({ objectLabel, onCommand, overflow, primary }: RowActionsProps) {
  const [pendingAction, setPendingAction] = useState<OverflowRowAction | null>(null);

  function runAction(action: OverflowRowAction) {
    if (!action.enabled) return;
    if (action.confirmation) {
      setPendingAction(action);
      return;
    }
    if (action.command) onCommand(action.command);
  }

  function confirmAction() {
    if (pendingAction?.command) onCommand(pendingAction.command);
    setPendingAction(null);
  }

  return (
    <>
      <div className="flex min-h-8 w-full items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        {primary && <PrimaryAction action={primary} onCommand={onCommand} />}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<IconButton aria-label={`更多操作：${objectLabel}`} type="button" variant="ghost" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                {overflow.map((action) => {
                  const content = (
                    <>
                      <span>{action.label}</span>
                      {!action.enabled && (
                        <span className="ml-auto max-w-28 text-right text-xs text-text-muted">
                          {action.disabledReason ?? '当前不可用'}
                        </span>
                      )}
                    </>
                  );

                  if (action.href && action.enabled) {
                    return (
                      <DropdownMenuItem
                        key={action.key}
                        render={<a href={action.href} />}
                        variant={action.intent === 'danger' ? 'destructive' : 'default'}
                      >
                        {content}
                      </DropdownMenuItem>
                    );
                  }

                  return (
                    <DropdownMenuItem
                      aria-disabled={!action.enabled}
                      closeOnClick={action.enabled}
                      key={action.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!action.enabled) event.preventDefault();
                        runAction(action);
                      }}
                      variant={action.intent === 'danger' ? 'destructive' : 'default'}
                    >
                      {content}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ActionConfirmationDialog
        confirmation={pendingAction?.confirmation ?? null}
        onConfirm={confirmAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      />
    </>
  );
}

export { ActionConfirmationDialog, RowActions };
export type { ActionConfirmationDialogProps, RowActionsProps };
