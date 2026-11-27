import { Link, useMatches, useRouterState } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  UserRoundIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AuthContextValue } from '@/app/auth/auth-provider';
import {
  isNavItemActive,
  resolveActiveNavId,
  resolveAppLayout,
  resolveBreadcrumbs,
  visibleNavigationSections,
  type BreadcrumbItem,
  type NavId,
  type NavigationItem,
} from '@/app/navigation';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu';
import { IconButton } from '@/design-system/primitives/icon-button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/design-system/primitives/sheet';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip';
import { cn } from '@/shared/lib/utils';

const SIDEBAR_STORAGE_KEY = 'partsignal:sidebar-collapsed';

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // 无本地存储权限时退化为当前会话状态。
  }
}

type AppShellProps = {
  auth: AuthContextValue;
  children: ReactNode;
};

function AppShell({ auth, children }: AppShellProps) {
  const matches = useMatches();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsedPreference);
  const activeNavId = resolveActiveNavId(matches);
  const breadcrumbs = resolveBreadcrumbs(matches);
  const layout = resolveAppLayout(matches);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPreference(next);
      return next;
    });
  }

  if (layout === 'print') {
    return (
      <main
        className="geo-insights-print-shell min-h-screen bg-surface-panel p-3 text-text-primary outline-none sm:p-5"
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
      >
        <div className="mx-auto max-w-[70rem]">{children}</div>
      </main>
    );
  }

  return (
    <div
      className={cn(
        'min-h-screen bg-surface-app text-text-primary lg:grid lg:transition-[grid-template-columns] lg:duration-150',
        sidebarCollapsed
          ? 'lg:grid-cols-[4rem_minmax(0,1fr)]'
          : 'lg:grid-cols-[15rem_minmax(0,1fr)]',
      )}
    >
      <a
        className="fixed top-2 left-2 z-[70] -translate-y-20 rounded-md bg-primary px-3 py-2 text-primary-foreground shadow-md transition-transform focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-ring/50"
        href="#main-content"
      >
        跳到主内容
      </a>

      <aside
        className="hidden border-r border-border-subtle bg-surface-panel lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col"
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
      >
        <Brand collapsed={sidebarCollapsed} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation
            activeNavId={activeNavId}
            collapsed={sidebarCollapsed}
            isAdmin={auth.isAdmin}
          />
        </div>
        <div className="shrink-0 border-t border-border-subtle p-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-expanded={!sidebarCollapsed}
                  aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                  className={cn(
                    'w-full text-text-secondary hover:text-text-primary',
                    sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-2.5',
                  )}
                  onClick={toggleSidebar}
                  size="sm"
                  type="button"
                  variant="ghost"
                />
              }
            >
              {!sidebarCollapsed && <span className="text-xs">收起导航</span>}
              {sidebarCollapsed ? (
                <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftCloseIcon aria-hidden="true" className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              {sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface-panel/95 px-3 backdrop-blur-sm md:px-5 lg:px-6">
          <MobileNavigation
            activeNavId={activeNavId}
            isAdmin={auth.isAdmin}
            open={mobileNavigationOpen}
            onOpenChange={setMobileNavigationOpen}
          />
          <span className="font-heading text-sm font-semibold tracking-tight text-text-primary lg:hidden">
            PartSignal
          </span>
          <div className="min-w-0 flex-1">
            <Breadcrumbs items={breadcrumbs} />
          </div>
          <AccountMenu auth={auth} />
        </header>

        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 flex-1 p-3 outline-none md:p-5 lg:p-6"
        >
          <div className="mx-auto min-w-0 max-w-[96rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center border-b border-border-subtle',
        collapsed ? 'justify-center px-2' : 'gap-2.5 px-4',
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold tracking-tight text-primary-foreground shadow-xs"
      >
        PS
      </span>
      {!collapsed && (
        <div className="min-w-0">
          <span className="block truncate font-heading text-sm font-semibold tracking-tight text-text-primary">
            PartSignal
          </span>
          <span className="block truncate text-[11px] text-text-tertiary">GEO 运营工作台</span>
        </div>
      )}
    </div>
  );
}

function Navigation({
  activeNavId,
  collapsed = false,
  isAdmin,
  onNavigate,
}: {
  activeNavId?: NavId;
  collapsed?: boolean;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sections = visibleNavigationSections(isAdmin);

  function toggleSection(sectionId: string) {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }

  return (
    <nav aria-label="主导航" className={cn('flex-1', collapsed ? 'space-y-2 p-2' : 'space-y-4 p-3')}>
      {sections.map((section, sectionIndex) => {
        const hasActiveItem = section.items.some((item) => isNavItemActive(item, activeNavId));
        const isSectionCollapsed =
          !collapsed && Boolean(section.collapsible) && Boolean(collapsedSections[section.id]) && !hasActiveItem;

        return (
          <section
            aria-labelledby={collapsed ? undefined : `nav-${section.id}`}
            className={cn(collapsed && sectionIndex > 0 && 'border-t border-border-subtle pt-2')}
            key={section.id}
          >
            {!collapsed && (
              section.collapsible ? (
                <button
                  aria-expanded={!isSectionCollapsed}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-left type-label text-text-tertiary transition-colors hover:bg-surface-raised hover:text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  id={`nav-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                  type="button"
                >
                  <span>{section.label}</span>
                  {isSectionCollapsed ? (
                    <ChevronRightIcon aria-hidden="true" className="size-3.5" />
                  ) : (
                    <ChevronDownIcon aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              ) : (
                <h2
                  className="mb-1 px-2 py-0.5 type-label text-text-tertiary"
                  id={`nav-${section.id}`}
                >
                  {section.label}
                </h2>
              )
            )}
            {!isSectionCollapsed && (
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <NavListItem
                    active={isNavItemActive(item, activeNavId)}
                    collapsed={collapsed}
                    item={item}
                    key={item.id}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

function NavListItem({
  active,
  collapsed,
  item,
  onNavigate,
}: {
  active: boolean;
  collapsed: boolean;
  item: NavigationItem;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const linkClass = cn(
    'relative flex min-h-9 items-center rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
    collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-1.5',
    active
      ? 'bg-surface-selected text-primary'
      : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
  );

  const link = (
    <Link
      activeOptions={{ exact: true }}
      aria-current={active ? 'page' : undefined}
      className={linkClass}
      onClick={onNavigate}
      to={item.to}
    >
      {active && !collapsed && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r-full bg-primary"
        />
      )}
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', active && 'text-primary')} />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{link}</li>;
}

function MobileNavigation({
  activeNavId,
  isAdmin,
  open,
  onOpenChange,
}: {
  activeNavId?: NavId;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={<IconButton aria-label="打开主导航" variant="ghost" className="lg:hidden" />}>
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(20rem,88vw)] overflow-hidden">
        <SheetHeader>
          <SheetTitle>PartSignal 导航</SheetTitle>
          <SheetDescription>选择工作区或系统管理入口。</SheetDescription>
        </SheetHeader>
        <SheetBody className="p-0">
          <Navigation
            activeNavId={activeNavId}
            isAdmin={isAdmin}
            onNavigate={() => onOpenChange(false)}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-text-muted">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.pathname}-${item.label}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />}
              {current ? (
                <span aria-current="page" className="truncate font-medium text-text-primary">
                  {item.label}
                </span>
              ) : (
                <Link
                  activeOptions={{ exact: true }}
                  className="truncate rounded-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  to={item.pathname}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function AccountMenu({ auth }: { auth: AuthContextValue }) {
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (auth.isLoading) {
    return <Skeleton aria-label="正在读取账户信息" className="h-8 w-28" />;
  }

  if (auth.error) {
    return (
      <div className="flex items-center gap-2" role="alert">
        <span className="text-xs text-text-danger">账户状态读取失败</span>
        <Button variant="outline" size="sm" onClick={() => void auth.refresh()}>重试</Button>
      </div>
    );
  }

  if (!auth.user) return null;

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : '退出登录失败');
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {signOutError && <span className="hidden text-xs text-text-danger sm:inline" role="alert">{signOutError}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="max-w-48 gap-2 px-2" />}>
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-selected text-xs font-semibold text-primary"
          >
            <UserRoundIcon className="size-3.5" />
          </span>
          <span className="truncate">{auth.user.display_name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-text-primary">{auth.user.display_name}</span>
                <Badge variant={auth.isAdmin ? 'info' : 'secondary'}>
                  {auth.isAdmin ? '管理员' : '工程师'}
                </Badge>
              </div>
              <span className="block truncate font-normal text-text-tertiary">@{auth.user.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/account/security" />}>
              <KeyRoundIcon />
              修改密码
            </DropdownMenuItem>
            <DropdownMenuItem disabled={auth.isSigningOut} onClick={() => void handleSignOut()}>
              <LogOutIcon />
              {auth.isSigningOut ? '正在退出…' : '退出登录'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { AppShell };
