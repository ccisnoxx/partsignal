import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router';
import { useRef } from 'react';

import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';

type DirtyGuardProps = {
  when: boolean;
  title?: string;
  description?: string;
  stayLabel?: string;
  leaveLabel?: string;
  shouldBlockNavigation?: ShouldBlockFn;
};

function DirtyGuard({
  description = '离开后，尚未保存的修改将会丢失。',
  leaveLabel = '放弃修改并离开',
  stayLabel = '继续编辑',
  shouldBlockNavigation,
  title = '要离开当前页面吗？',
  when,
}: DirtyGuardProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const blocker = useBlocker({
    disabled: !when,
    enableBeforeUnload: when,
    shouldBlockFn: async (args) => {
      const shouldBlock = await (shouldBlockNavigation?.(args) ?? true);
      // TanStack 的 blocker 会丢弃 hash；只在实际阻断时记录焦点，允许的导航不应改变恢复目标。
      if (shouldBlock && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      return shouldBlock;
    },
    withResolver: true,
  });

  function stayOnPage() {
    blocker.reset?.();
    queueMicrotask(() => returnFocusRef.current?.focus());
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && blocker.status === 'blocked') stayOnPage();
      }}
      open={blocker.status === 'blocked'}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={stayOnPage} type="button" variant="outline">
            {stayLabel}
          </Button>
          <Button onClick={() => blocker.proceed?.()} type="button" variant="destructive">
            {leaveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DirtyGuard };
export type { DirtyGuardProps };
