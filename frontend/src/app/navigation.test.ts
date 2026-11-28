import { describe, expect, it } from 'vitest';

import {
  isNavItemActive,
  resolveActiveNavId,
  resolveAppLayout,
  resolveBreadcrumbs,
  visibleNavigationSections,
  type MetadataMatch,
} from './navigation';

const matches = (...items: MetadataMatch[]) => items;

describe('路由导航元数据与 5 入口收敛', () => {
  it('从最深显式声明的路由继承 navId，不依赖 pathname 前缀', () => {
    expect(resolveActiveNavId(matches(
      { pathname: '/products', staticData: { navId: 'products', breadcrumb: '产品' } },
      { pathname: '/products/part-1', staticData: { breadcrumb: '产品详情' } },
    ))).toBe('products');

    expect(resolveActiveNavId(matches(
      { pathname: '/products', staticData: { navId: 'products' } },
      { pathname: '/products/part-1', staticData: { navId: 'users' } },
    ))).toBe('users');
  });

  it('默认日常导航收敛为 5 入口，VIEWER 仅见 3 个只读入口，高级配置默认折叠', () => {
    expect(resolveBreadcrumbs(matches(
      { pathname: '/', staticData: {} },
      { pathname: '/products', staticData: { breadcrumb: '产品' } },
      { pathname: '/products/part-1', staticData: { breadcrumb: '产品详情' } },
    ))).toEqual([
      { label: '产品', pathname: '/products' },
      { label: '产品详情', pathname: '/products/part-1' },
    ]);

    const viewerSections = visibleNavigationSections('VIEWER');
    expect(viewerSections.map((s) => s.id)).toEqual(['daily']);
    expect(viewerSections[0]?.items.map((item) => item.id)).toEqual([
      'geo-dashboard',
      'articles',
      'products',
    ]);

    const engineerSections = visibleNavigationSections('ENGINEER');
    expect(engineerSections.map((s) => s.id)).toEqual(['daily', 'advanced-ops']);
    expect(engineerSections[0]?.items.map((item) => item.id)).toEqual([
      'geo-dashboard',
      'geo-today',
      'articles',
      'products',
      'platforms',
    ]);
    expect(engineerSections[1]?.defaultCollapsed).toBe(true);
    expect(engineerSections[1]?.items.some((item) => item.id === 'users')).toBe(false);

    const adminSections = visibleNavigationSections('ADMIN');
    expect(adminSections.map((s) => s.id)).toEqual(['daily', 'advanced-ops', 'system']);
    expect(adminSections[2]?.defaultCollapsed).toBe(true);
    expect(adminSections[2]?.items.map((item) => item.id)).toEqual(['users', 'audit']);

    const dashboardItem = visibleNavigationSections(false)
      .flatMap((section) => section.items)
      .find((item) => item.id === 'geo-dashboard');
    expect(dashboardItem).toBeDefined();
    expect(isNavItemActive(dashboardItem!, 'geo-dashboard')).toBe(true);
    expect(isNavItemActive(dashboardItem!, 'geo-overview')).toBe(true);
    expect(isNavItemActive(dashboardItem!, 'geo-answer-insights')).toBe(true);
    expect(isNavItemActive(dashboardItem!, 'geo-reports')).toBe(true);
    expect(isNavItemActive(dashboardItem!, 'geo-insights')).toBe(true);
    expect(isNavItemActive(dashboardItem!, 'geo-today')).toBe(false);
  });

  it('只由最深显式路由切换打印布局', () => {
    expect(resolveAppLayout(matches(
      { pathname: '/geo/dashboard', staticData: {} },
      { pathname: '/geo/dashboard/print', staticData: { layout: 'print' } },
    ))).toBe('print');
    expect(resolveAppLayout(matches({ pathname: '/geo/dashboard', staticData: {} }))).toBe('app');
  });
});
