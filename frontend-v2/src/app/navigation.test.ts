import { describe, expect, it } from 'vitest';

import {
  resolveActiveNavId,
  resolveBreadcrumbs,
  visibleNavigationSections,
  type MetadataMatch,
} from './navigation';

const matches = (...items: MetadataMatch[]) => items;

describe('路由导航元数据', () => {
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

  it('按匹配链顺序生成面包屑，并只向管理员显示系统入口', () => {
    expect(resolveBreadcrumbs(matches(
      { pathname: '/', staticData: {} },
      { pathname: '/products', staticData: { breadcrumb: '产品' } },
      { pathname: '/products/part-1', staticData: { breadcrumb: '产品详情' } },
    ))).toEqual([
      { label: '产品', pathname: '/products' },
      { label: '产品详情', pathname: '/products/part-1' },
    ]);

    expect(visibleNavigationSections(false).flatMap((section) => section.items.map((item) => item.id)))
      .toEqual([
        'workbench',
        'products',
        'content-tasks',
        'publishing-work',
        'publishing-articles',
        'publishing-issues',
      ]);
    expect(visibleNavigationSections(true).flatMap((section) => section.items.map((item) => item.id)))
      .toEqual([
        'workbench',
        'products',
        'content-tasks',
        'publishing-work',
        'publishing-articles',
        'publishing-issues',
        'users',
      ]);
  });
});
