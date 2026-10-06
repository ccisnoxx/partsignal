import { describe, expect, it } from 'vitest';

import {
  formatExactProductTime,
  formatRelativeProductTime,
  productFactStatusRegistry,
  productWorkflowStageRegistry,
  resolveProductOverflowActions,
  resolveProductPrimaryAction,
  type ProductListItem,
} from './product.model';
import {
  canonicalProductsSearchRecord,
  formatCurrentFact,
  isCanonicalProductsSearch,
  productSortToSorting,
  productsSearchSchema,
  productsSearchToApiParams,
  sortingToProductSort,
} from './products-list.model';

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  part_number: 'PS-001',
  brand: 'PartSignal',
  category: 'MCU',
  status: 'ACTIVE',
  workflow_stage: 'FACTS_EMPTY',
  primary_task: 'ENTER_FACTS',
  available_actions: ['UPDATE'],
  deletion: null,
  revision: 3,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
  fact_status: 'NOT_ENTERED',
  current_fact: null,
} satisfies ProductListItem;

describe('Products list model', () => {
  it('规范化 search 并显式映射 URL 到 API', () => {
    const search = productsSearchSchema.parse({
      q: '  PS-001  ',
      page: '2',
      pageSize: '50',
      sort: 'MODEL_DESC',
      factStatus: 'APPROVED',
      workflowStage: 'FACT_APPROVED',
      unknown: 'remove-me',
    });

    expect(search).toEqual({
      q: 'PS-001',
      page: 2,
      pageSize: 50,
      sort: 'MODEL_DESC',
      factStatus: 'APPROVED',
      workflowStage: 'FACT_APPROVED',
    });
    expect(productsSearchToApiParams(search)).toEqual({
      search: 'PS-001',
      page: 2,
      page_size: 50,
      sort: 'MODEL_DESC',
      fact_status: 'APPROVED',
      workflow_stage: 'FACT_APPROVED',
    });
    expect(canonicalProductsSearchRecord(search)).toEqual({
      q: 'PS-001',
      page: 2,
      pageSize: 50,
      sort: 'MODEL_DESC',
      factStatus: 'APPROVED',
      workflowStage: 'FACT_APPROVED',
    });
  });

  it('非法 search 只产生 canonical 默认值，不把原值传给 API', () => {
    const search = productsSearchSchema.parse({
      q: 'x'.repeat(201),
      page: '0',
      pageSize: '999',
      sort: 'UNKNOWN',
      factStatus: 'UNKNOWN',
      workflowStage: 'UNKNOWN',
    });

    expect(search).toEqual({ page: 1, pageSize: 20, sort: 'UPDATED_DESC' });
    expect(canonicalProductsSearchRecord(search)).toEqual({ page: 1 });
    expect(isCanonicalProductsSearch({ page: 0, junk: 'x' }, search)).toBe(false);
    expect(isCanonicalProductsSearch({ page: 1 }, search)).toBe(true);
  });

  it('排序状态与 API enum 双向穷尽映射', () => {
    expect(productSortToSorting('UPDATED_DESC')).toEqual([{ id: 'updated_at', desc: true }]);
    expect(productSortToSorting('MODEL_ASC')).toEqual([{ id: 'part_number', desc: false }]);
    expect(sortingToProductSort([{ id: 'updated_at', desc: false }])).toBe('UPDATED_ASC');
    expect(sortingToProductSort([{ id: 'part_number', desc: true }])).toBe('MODEL_DESC');
    expect(() => sortingToProductSort([{ id: 'unknown', desc: false }])).toThrow('未知排序列');
  });

  it('六个 primary_task 只映射文案和批准 href', () => {
    const expectations = {
      ENTER_FACTS: ['录入事实', `/products/${product.id}/facts`],
      SUBMIT_FACT_REVIEW: ['提交审核', `/products/${product.id}/facts`],
      REVIEW_FACT: ['审核', `/products/${product.id}/facts/review`],
      REVISE_FACT: ['修订', `/products/${product.id}/facts`],
      CREATE_CONTENT_TASK: ['创建内容', `/content/tasks/new?productId=${product.id}`],
      VIEW_FACT_HISTORY: ['查看事实历史', `/products/${product.id}/facts/versions?page=1&pageSize=20`],
    } as const;

    for (const [primaryTask, [label, href]] of Object.entries(expectations)) {
      expect(resolveProductPrimaryAction({ ...product, primary_task: primaryTask as ProductListItem['primary_task'] }))
        .toMatchObject({ key: primaryTask, label, href, enabled: true });
    }
    expect(() => resolveProductPrimaryAction({ ...product, primary_task: 'UNKNOWN' as never }))
      .toThrow('未处理的合同 token');
  });

  it('UPDATE blocker、DELETE 与删除条件只消费服务端 projection', () => {
    expect(resolveProductOverflowActions(product, { deleting: false, surface: 'list' })).toEqual([
      expect.objectContaining({ key: 'UPDATE', enabled: true, href: `/products/${product.id}` }),
    ]);
    expect(resolveProductOverflowActions({
      ...product,
      available_actions: ['UPDATE', 'DELETE'],
      deletion: { blockers: [] },
    }, { deleting: false, surface: 'list' })).toEqual([
      expect.objectContaining({ key: 'UPDATE', enabled: true }),
      expect.objectContaining({ key: 'DELETE', enabled: true, intent: 'danger' }),
    ]);
    expect(resolveProductOverflowActions({
      ...product,
      deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
    }, { deleting: false, surface: 'list' })).toEqual([
      expect.objectContaining({ key: 'UPDATE' }),
      expect.objectContaining({ key: 'VIEW_DELETE_CONDITIONS', command: 'view-delete-conditions' }),
    ]);
    expect(() => resolveProductOverflowActions({
      ...product,
      available_actions: ['DELETE'],
      deletion: { blockers: [{ type: 'CONTENT_TASK', count: 2 }] },
    }, { deleting: false, surface: 'list' })).toThrow('矛盾的 DELETE projection');
    expect(() => resolveProductOverflowActions(
      { ...product, available_actions: ['UNKNOWN' as never] },
      { deleting: false, surface: 'list' },
    ))
      .toThrow('未处理的合同 token');
  });

  it('status registry、当前事实和原生 Intl formatter 提供展示语义', () => {
    expect(Object.keys(productFactStatusRegistry)).toHaveLength(5);
    expect(Object.keys(productWorkflowStageRegistry)).toHaveLength(6);
    expect(productFactStatusRegistry.APPROVED).toMatchObject({ label: '已批准', tone: 'success' });
    expect(formatCurrentFact(null)).toBe('暂无');
    expect(formatCurrentFact({ version: 3, status: 'APPROVED' })).toBe('Approved v3');
    const now = Date.parse('2026-08-09T12:00:00Z');
    expect(formatRelativeProductTime('2026-08-09T11:00:00Z', now)).toContain('1');
    expect(formatExactProductTime('2026-08-09T11:00:00Z')).toBeTruthy();
    expect(() => formatRelativeProductTime('invalid')).toThrow('非法时间');
  });
});
