import { useSyncExternalStore, type ReactNode } from 'react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design-system/primitives/tabs';
import { cn } from '@/shared/lib/utils';

type WorkspaceArea = 'context' | 'main' | 'reference';

type WorkspaceSlot = {
  label: string;
  content: ReactNode;
};

type WorkspacePaneProps = {
  area: WorkspaceArea;
  label: string;
  children: ReactNode;
  className?: string;
};

function WorkspacePane({ area, children, label, className }: WorkspacePaneProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        'min-w-0 rounded-xl border border-border-subtle bg-surface-panel',
        area === 'main' ? 'min-h-[32rem]' : 'min-h-48',
        className,
      )}
      data-workspace-area={area}
    >
      {children}
    </section>
  );
}

type WorkspaceTabsProps = {
  main: WorkspaceSlot;
  context?: WorkspaceSlot;
  reference?: WorkspaceSlot;
};

function WorkspaceTabs({ main, context, reference }: WorkspaceTabsProps) {
  const slots = [
    { area: 'main' as const, ...main },
    ...(context ? [{ area: 'context' as const, ...context }] : []),
    ...(reference ? [{ area: 'reference' as const, ...reference }] : []),
  ];

  return (
    <Tabs className="min-w-0" defaultValue="main">
      <TabsList aria-label="工作区面板" className="max-w-full overflow-x-auto" variant="line">
        {slots.map((slot) => (
          <TabsTrigger key={slot.area} value={slot.area}>
            {slot.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {slots.map((slot) => (
        <TabsContent keepMounted key={slot.area} value={slot.area}>
          <WorkspacePane area={slot.area} label={slot.label}>{slot.content}</WorkspacePane>
        </TabsContent>
      ))}
    </Tabs>
  );
}

const desktopQuery = '(min-width: 1280px)';

function subscribeToDesktop(change: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}

function isDesktop() {
  return window.matchMedia(desktopQuery).matches;
}

type WorkspaceShellProps = WorkspaceTabsProps & {
  ariaLabel: string;
  className?: string;
};

function WorkspaceShell({ ariaLabel, className, context, main, reference }: WorkspaceShellProps) {
  const desktop = useSyncExternalStore(subscribeToDesktop, isDesktop, () => false);

  return (
    <div aria-label={ariaLabel} className={cn('min-w-0', className)} role="region">
      {desktop ? (
        <div className="grid min-w-0 grid-cols-[16rem_minmax(0,1fr)_20rem] items-start gap-4">
          {context ? <WorkspacePane area="context" label={context.label}>{context.content}</WorkspacePane> : <div aria-hidden="true" />}
          <WorkspacePane area="main" label={main.label}>{main.content}</WorkspacePane>
          {reference ? <WorkspacePane area="reference" label={reference.label}>{reference.content}</WorkspacePane> : <div aria-hidden="true" />}
        </div>
      ) : (
        <WorkspaceTabs context={context} main={main} reference={reference} />
      )}
    </div>
  );
}

export { WorkspacePane, WorkspaceShell, WorkspaceTabs };
export type { WorkspaceArea, WorkspacePaneProps, WorkspaceShellProps, WorkspaceSlot, WorkspaceTabsProps };
