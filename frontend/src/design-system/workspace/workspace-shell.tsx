import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@/design-system/primitives/button';
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
        'min-w-0 rounded-xl border border-border-subtle bg-surface-panel shadow-[var(--shadow-panel)]',
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

const wideDesktopQuery = '(min-width: 1280px)';
const compactDesktopQuery = '(min-width: 1024px)';

function subscribeMedia(query: string) {
  return (change: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  };
}

function readMedia(query: string) {
  return () => window.matchMedia(query).matches;
}

const subscribeWideDesktop = subscribeMedia(wideDesktopQuery);
const isWideDesktop = readMedia(wideDesktopQuery);
const subscribeCompactDesktop = subscribeMedia(compactDesktopQuery);
const isCompactDesktop = readMedia(compactDesktopQuery);

function resolveDesktopGridClass(showContext: boolean, showReference: boolean) {
  if (showContext && showReference) return 'grid-cols-[15rem_minmax(0,1fr)_20rem]';
  if (showContext) return 'grid-cols-[15rem_minmax(0,1fr)]';
  if (showReference) return 'grid-cols-[minmax(0,1fr)_20rem]';
  return 'grid-cols-[minmax(0,1fr)]';
}

type WorkspaceShellProps = WorkspaceTabsProps & {
  ariaLabel: string;
  className?: string;
};

function WorkspaceShell({ ariaLabel, className, context, main, reference }: WorkspaceShellProps) {
  const wideDesktop = useSyncExternalStore(subscribeWideDesktop, isWideDesktop, () => false);
  const compactDesktop = useSyncExternalStore(subscribeCompactDesktop, isCompactDesktop, () => false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);

  const hasSideSlots = Boolean(context || reference);

  if (wideDesktop) {
    const showContext = Boolean(context) && !contextCollapsed;
    const showReference = Boolean(reference) && !referenceCollapsed;
    const gridClass = resolveDesktopGridClass(showContext, showReference);

    return (
      <div aria-label={ariaLabel} className={cn('min-w-0 space-y-2.5', className)} role="region">
        {hasSideSlots && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {context && (
                <Button
                  aria-expanded={showContext}
                  aria-pressed={showContext}
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setContextCollapsed((prev) => !prev)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <PanelLeftIcon aria-hidden="true" className="size-3.5" />
                  <span>{showContext ? `隐藏${context.label}` : `显示${context.label}`}</span>
                </Button>
              )}
            </div>
            <div>
              {reference && (
                <Button
                  aria-expanded={showReference}
                  aria-pressed={showReference}
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setReferenceCollapsed((prev) => !prev)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <PanelRightIcon aria-hidden="true" className="size-3.5" />
                  <span>{showReference ? `隐藏${reference.label}` : `显示${reference.label}`}</span>
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={cn('grid min-w-0 items-start gap-4', gridClass)}>
          {showContext && context && (
            <WorkspacePane area="context" label={context.label}>{context.content}</WorkspacePane>
          )}
          <WorkspacePane area="main" label={main.label}>{main.content}</WorkspacePane>
          {showReference && reference && (
            <WorkspacePane area="reference" label={reference.label}>{reference.content}</WorkspacePane>
          )}
        </div>
      </div>
    );
  }

  if (compactDesktop && hasSideSlots) {
    const showSide = !sideCollapsed;
    const sideSlots = [
      ...(context ? [{ area: 'context' as const, ...context }] : []),
      ...(reference ? [{ area: 'reference' as const, ...reference }] : []),
    ];
    const toggleLabel = sideSlots.map((slot) => slot.label).join(' / ');

    return (
      <div aria-label={ariaLabel} className={cn('min-w-0 space-y-2.5', className)} role="region">
        <div className="flex items-center justify-end">
          <Button
            aria-expanded={showSide}
            aria-pressed={showSide}
            className="text-text-secondary hover:text-text-primary"
            onClick={() => setSideCollapsed((prev) => !prev)}
            size="xs"
            type="button"
            variant="outline"
          >
            <PanelRightIcon aria-hidden="true" className="size-3.5" />
            <span>{showSide ? `隐藏${toggleLabel}` : `显示${toggleLabel}`}</span>
          </Button>
        </div>
        <div
          className={cn(
            'grid min-w-0 items-start gap-4',
            showSide ? 'grid-cols-[minmax(0,1fr)_20rem]' : 'grid-cols-[minmax(0,1fr)]',
          )}
        >
          <WorkspacePane area="main" label={main.label}>{main.content}</WorkspacePane>
          {showSide && (
            sideSlots.length === 1 && sideSlots[0] ? (
              <WorkspacePane area={sideSlots[0].area} label={sideSlots[0].label}>
                {sideSlots[0].content}
              </WorkspacePane>
            ) : (
              <Tabs className="min-w-0" defaultValue={sideSlots[0]?.area ?? 'context'}>
                <TabsList aria-label="辅助工作区面板" className="w-full" variant="default">
                  {sideSlots.map((slot) => (
                    <TabsTrigger key={slot.area} value={slot.area}>
                      {slot.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {sideSlots.map((slot) => (
                  <TabsContent keepMounted key={slot.area} value={slot.area}>
                    <WorkspacePane area={slot.area} label={slot.label}>{slot.content}</WorkspacePane>
                  </TabsContent>
                ))}
              </Tabs>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div aria-label={ariaLabel} className={cn('min-w-0', className)} role="region">
      <WorkspaceTabs context={context} main={main} reference={reference} />
    </div>
  );
}

export { WorkspacePane, WorkspaceShell, WorkspaceTabs };
export type { WorkspaceArea, WorkspacePaneProps, WorkspaceShellProps, WorkspaceSlot, WorkspaceTabsProps };
