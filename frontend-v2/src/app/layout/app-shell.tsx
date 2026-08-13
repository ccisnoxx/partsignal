import { Link, useMatches, useRouterState } from '@tanstack/react-router';
import { ChevronRightIcon, LogOutIcon, MenuIcon, UserRoundIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AuthContextValue } from '@/app/auth/auth-provider';
import {
  resolveActiveNavId,
  resolveAppLayout,
  resolveBreadcrumbs,
  visibleNavigationSections,
  type BreadcrumbItem,
  type NavId,
} from '@/app/navigation';
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
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/design-system/primitives/sheet';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { cn } from '@/shared/lib/utils';

type AppShellProps = {
  auth: AuthContextValue;
  children: ReactNode;
};

function AppShell({ auth, children }: AppShellProps) {
  const matches = useMatches();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const activeNavId = resolveActiveNavId(matches);
  const breadcrumbs = resolveBreadcrumbs(matches);
  const layout = resolveAppLayout(matches);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

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
    <div className="min-h-screen bg-surface-app text-text-primary lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
      <a
        className="fixed top-2 left-2 z-[70] -translate-y-20 rounded-md bg-primary px-3 py-2 text-primary-foreground shadow-md transition-transform focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-ring/50"
        href="#main-content"
      >
        跳到主内容
      </a>

      <aside className="hidden min-h-screen border-r border-border-subtle bg-surface-panel lg:flex lg:flex-col">
        <Brand />
        <Navigation activeNavId={activeNavId} isAdmin={auth.isAdmin} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border-subtle bg-surface-panel/95 px-3 backdrop-blur-sm md:px-4 lg:px-5">
          <MobileNavigation
            activeNavId={activeNavId}
            isAdmin={auth.isAdmin}
            open={mobileNavigationOpen}
            onOpenChange={setMobileNavigationOpen}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate type-label text-text-muted">PartSignal</p>
            <p className="truncate font-medium">运营工作台</p>
          </div>
          <AccountMenu auth={auth} />
        </header>

        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="min-h-[calc(100vh-4rem)] p-3 outline-none md:p-4 lg:p-5"
        >
          <div className="mx-auto max-w-[95rem] space-y-4">
            <Breadcrumbs items={breadcrumbs} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center border-b border-border-subtle px-4">
      <span className="font-heading text-base font-semibold">PartSignal</span>
    </div>
  );
}

function Navigation({
  activeNavId,
  isAdmin,
  onNavigate,
}: {
  activeNavId?: NavId;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="主导航" className="flex-1 space-y-5 p-3">
      {visibleNavigationSections(isAdmin).map((section) => (
        <section key={section.label} aria-labelledby={`nav-${section.label}`}>
          <h2 id={`nav-${section.label}`} className="mb-1 px-2 type-label text-text-muted">
            {section.label}
          </h2>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = item.id === activeNavId;
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: true }}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                      active
                        ? 'bg-surface-selected text-text-primary'
                        : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
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
      <SheetContent side="left" className="w-[min(20rem,88vw)]">
        <SheetHeader>
          <SheetTitle>PartSignal 导航</SheetTitle>
          <SheetDescription>选择工作区或系统管理入口。</SheetDescription>
        </SheetHeader>
        <Navigation
          activeNavId={activeNavId}
          isAdmin={isAdmin}
          onNavigate={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="面包屑">
      <ol className="flex flex-wrap items-center gap-1 type-body-sm text-text-muted">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.pathname}-${item.label}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRightIcon aria-hidden="true" className="size-3.5" />}
              {current ? (
                <span aria-current="page" className="text-text-primary">{item.label}</span>
              ) : (
                <Link activeOptions={{ exact: true }} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" to={item.pathname}>
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
    <div className="flex items-center gap-2">
      {signOutError && <span className="hidden text-xs text-text-danger sm:inline" role="alert">{signOutError}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="max-w-44" />}>
          <UserRoundIcon />
          <span className="truncate">{auth.user.display_name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="space-y-0.5">
              <span className="block truncate text-text-primary">{auth.user.display_name}</span>
              <span className="block truncate font-normal">@{auth.user.username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
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
