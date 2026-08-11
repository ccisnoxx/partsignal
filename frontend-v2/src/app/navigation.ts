import type { StaticDataRouteOption } from '@tanstack/react-router';
import {
  BoxesIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  SendIcon,
  ScrollTextIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

type NavId = 'workbench' | 'products' | 'content-tasks' | 'publishing-work' | 'publishing-articles' | 'users';

type NavigationItem = {
  id: NavId;
  label: string;
  to: '/' | '/products' | '/content/tasks' | '/publishing/work' | '/publishing/articles' | '/system/users';
  icon: LucideIcon;
  adminOnly?: boolean;
};

type NavigationSection = {
  label: string;
  items: readonly NavigationItem[];
};

type MetadataMatch = {
  pathname: string;
  staticData: StaticDataRouteOption;
};

type BreadcrumbItem = {
  label: string;
  pathname: string;
};

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    navId?: NavId;
    breadcrumb?: string;
  }
}

const navigationSections: readonly NavigationSection[] = [
  {
    label: '工作区',
    items: [
      { id: 'workbench', label: '工作台', to: '/', icon: LayoutDashboardIcon },
      { id: 'products', label: '产品', to: '/products', icon: BoxesIcon },
    ],
  },
  {
    label: '内容运营',
    items: [
      { id: 'content-tasks', label: '内容任务', to: '/content/tasks', icon: ListTodoIcon },
      { id: 'publishing-work', label: '发布工作', to: '/publishing/work', icon: SendIcon },
      { id: 'publishing-articles', label: '发布成果', to: '/publishing/articles', icon: ScrollTextIcon },
    ],
  },
  {
    label: '系统管理',
    items: [
      { id: 'users', label: '用户管理', to: '/system/users', icon: UsersIcon, adminOnly: true },
    ],
  },
];

function resolveActiveNavId(matches: readonly MetadataMatch[]): NavId | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const navId = matches[index]?.staticData.navId;
    if (navId) return navId;
  }
  return undefined;
}

function resolveBreadcrumbs(matches: readonly MetadataMatch[]): BreadcrumbItem[] {
  return matches.flatMap((match) =>
    match.staticData.breadcrumb
      ? [{ label: match.staticData.breadcrumb, pathname: match.pathname }]
      : [],
  );
}

function visibleNavigationSections(isAdmin: boolean): NavigationSection[] {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((section) => section.items.length > 0);
}

export {
  navigationSections,
  resolveActiveNavId,
  resolveBreadcrumbs,
  visibleNavigationSections,
};
export type { BreadcrumbItem, MetadataMatch, NavId, NavigationItem, NavigationSection };
