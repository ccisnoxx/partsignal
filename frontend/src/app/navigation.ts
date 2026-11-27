import type { StaticDataRouteOption } from '@tanstack/react-router';
import {
  BotIcon,
  BoxesIcon,
  CalendarRangeIcon,
  ChartSplineIcon,
  ClipboardListIcon,
  EyeIcon,
  FileTextIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  MessageSquareWarningIcon,
  PlayCircleIcon,
  ScrollTextIcon,
  SendIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TagsIcon,
  TargetIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

type NavId =
  | 'workbench'
  | 'products'
  | 'content-campaigns'
  | 'content-tasks'
  | 'publishing-work'
  | 'publishing-articles'
  | 'publishing-issues'
  | 'geo-overview'
  | 'geo-reports'
  | 'geo-answer-insights'
  | 'geo-insights'
  | 'geo-topics'
  | 'geo-questions'
  | 'geo-plans'
  | 'geo-runs'
  | 'geo-opportunities'
  | 'geo-observations'
  | 'geo-entities'
  | 'geo-surfaces'
  | 'geo-rules'
  | 'platforms'
  | 'prompts'
  | 'ai-channels'
  | 'users'
  | 'audit';

type AppLayout = 'app' | 'print';

type NavigationItem = {
  id: NavId;
  matchNavIds?: readonly NavId[];
  label: string;
  to:
    | '/'
    | '/products'
    | '/content/campaigns'
    | '/content/tasks'
    | '/publishing/work'
    | '/publishing/articles'
    | '/publishing/issues'
    | '/geo/overview'
    | '/geo/reports'
    | '/geo/insights/answers'
    | '/geo/insights'
    | '/geo/topics'
    | '/geo/questions'
    | '/geo/plans'
    | '/geo/runs'
    | '/geo/opportunities'
    | '/geo/observations'
    | '/configuration/geo-entities'
    | '/configuration/geo-surfaces'
    | '/configuration/geo-rules'
    | '/settings/platforms'
    | '/settings/prompts'
    | '/settings/ai'
    | '/system/users'
    | '/system/audit';
  icon: LucideIcon;
  adminOnly?: boolean;
};

type NavigationSection = {
  id: string;
  label: string;
  collapsible?: boolean;
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

const geoAnalyticsNavIds: readonly NavId[] = [
  'geo-overview',
  'geo-answer-insights',
  'geo-reports',
  'geo-insights',
];

const navigationSections: readonly NavigationSection[] = [
  {
    id: 'workspace',
    label: '工作区',
    items: [
      { id: 'workbench', label: '工作台', to: '/', icon: LayoutDashboardIcon },
      { id: 'products', label: '产品', to: '/products', icon: BoxesIcon },
    ],
  },
  {
    id: 'content-ops',
    label: '内容运营',
    items: [
      { id: 'content-campaigns', label: '内容活动', to: '/content/campaigns', icon: TargetIcon },
      { id: 'content-tasks', label: '内容任务', to: '/content/tasks', icon: ListTodoIcon },
      { id: 'publishing-work', label: '发布工作', to: '/publishing/work', icon: SendIcon },
      { id: 'publishing-articles', label: '发布成果', to: '/publishing/articles', icon: ScrollTextIcon },
      { id: 'publishing-issues', label: '内容问题', to: '/publishing/issues', icon: MessageSquareWarningIcon },
    ],
  },
  {
    id: 'geo-ops',
    label: 'GEO 监测',
    items: [
      {
        id: 'geo-overview',
        matchNavIds: geoAnalyticsNavIds,
        label: '分析与报告',
        to: '/geo/overview',
        icon: ChartSplineIcon,
      },
      { id: 'geo-plans', label: '监测计划', to: '/geo/plans', icon: CalendarRangeIcon },
      { id: 'geo-runs', label: '运行中心', to: '/geo/runs', icon: PlayCircleIcon },
      { id: 'geo-opportunities', label: '机会工作台', to: '/geo/opportunities', icon: TargetIcon },
    ],
  },
  {
    id: 'geo-assets',
    label: 'GEO 资产',
    collapsible: true,
    items: [
      { id: 'geo-questions', label: '问题库', to: '/geo/questions', icon: HelpCircleIcon },
      { id: 'geo-topics', label: '问题主题', to: '/geo/topics', icon: TagsIcon },
      { id: 'geo-observations', label: '观测记录', to: '/geo/observations', icon: EyeIcon },
    ],
  },
  {
    id: 'configuration',
    label: '业务配置',
    collapsible: true,
    items: [
      { id: 'platforms', label: '平台与账号', to: '/settings/platforms', icon: Settings2Icon },
      { id: 'geo-surfaces', label: 'GEO 观测面与采集', to: '/configuration/geo-surfaces', icon: BotIcon, adminOnly: true },
      { id: 'geo-entities', label: '监测对象与竞品', to: '/configuration/geo-entities', icon: BoxesIcon, adminOnly: true },
      { id: 'geo-rules', label: 'GEO 规则与阈值', to: '/configuration/geo-rules', icon: SlidersHorizontalIcon, adminOnly: true },
      { id: 'prompts', label: 'Prompt 管理', to: '/settings/prompts', icon: FileTextIcon, adminOnly: true },
      { id: 'ai-channels', label: 'AI 渠道', to: '/settings/ai', icon: BotIcon, adminOnly: true },
    ],
  },
  {
    id: 'system',
    label: '系统管理',
    collapsible: true,
    items: [
      { id: 'users', label: '用户管理', to: '/system/users', icon: UsersIcon, adminOnly: true },
      { id: 'audit', label: '系统审计', to: '/system/audit', icon: ClipboardListIcon, adminOnly: true },
    ],
  },
];

function isNavItemActive(item: NavigationItem, activeNavId?: NavId): boolean {
  if (!activeNavId) return false;
  if (item.id === activeNavId) return true;
  return Boolean(item.matchNavIds?.includes(activeNavId));
}

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
  geoAnalyticsNavIds,
  isNavItemActive,
  navigationSections,
  resolveActiveNavId,
  resolveAppLayout,
  resolveBreadcrumbs,
  visibleNavigationSections,
};
export type { AppLayout, BreadcrumbItem, MetadataMatch, NavId, NavigationItem, NavigationSection };
