import type { StaticDataRouteOption } from '@tanstack/react-router';
import {
  BoxesIcon,
  BotIcon,
  ChartSplineIcon,
  ClipboardListIcon,
  EyeIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  MessageSquareWarningIcon,
  SendIcon,
  ScrollTextIcon,
  Settings2Icon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

type NavId = 'workbench' | 'products' | 'content-tasks' | 'publishing-work' | 'publishing-articles' | 'publishing-issues' | 'geo-insights' | 'geo-topics' | 'geo-observations' | 'platforms' | 'prompts' | 'ai-channels' | 'users' | 'audit';
type AppLayout = 'app' | 'print';

type NavigationItem = {
  id: NavId;
  label: string;
  to: '/' | '/products' | '/content/tasks' | '/publishing/work' | '/publishing/articles' | '/publishing/issues' | '/geo/insights' | '/geo/topics' | '/geo/observations' | '/settings/platforms' | '/settings/prompts' | '/settings/ai' | '/system/users' | '/system/audit';
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
    layout?: AppLayout;
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
      { id: 'publishing-issues', label: '内容问题', to: '/publishing/issues', icon: MessageSquareWarningIcon },
    ],
  },
  {
    label: 'GEO',
    items: [
      { id: 'geo-insights', label: '洞察', to: '/geo/insights', icon: ChartSplineIcon },
      { id: 'geo-topics', label: '问题主题', to: '/geo/topics', icon: MessagesSquareIcon },
      { id: 'geo-observations', label: '观测记录', to: '/geo/observations', icon: EyeIcon },
    ],
  },
  {
    label: '业务配置',
    items: [
      { id: 'platforms', label: '平台与账号', to: '/settings/platforms', icon: Settings2Icon },
      { id: 'prompts', label: 'Prompt 管理', to: '/settings/prompts', icon: FileTextIcon, adminOnly: true },
      { id: 'ai-channels', label: 'AI 渠道', to: '/settings/ai', icon: BotIcon, adminOnly: true },
    ],
  },
  {
    label: '系统管理',
    items: [
      { id: 'users', label: '用户管理', to: '/system/users', icon: UsersIcon, adminOnly: true },
      { id: 'audit', label: '系统审计', to: '/system/audit', icon: ClipboardListIcon, adminOnly: true },
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

function resolveAppLayout(matches: readonly MetadataMatch[]): AppLayout {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const layout = matches[index]?.staticData.layout;
    if (layout) return layout;
  }
  return 'app';
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
  resolveAppLayout,
  resolveBreadcrumbs,
  visibleNavigationSections,
};
export type { AppLayout, BreadcrumbItem, MetadataMatch, NavId, NavigationItem, NavigationSection };
