import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  attentionPresentations,
  formatWorkbenchRate,
  geoRateLabels,
  healthDomainLabels,
  healthStatusPresentations,
  resolveWorkbenchCounts,
} from './workbench.model';

const counts = {
  fact_reviews: { value: 0, href: '/facts' },
  content_reviews: { value: 2, href: '/content' },
  publication_verifications: { value: 3, href: '/verifications' },
  publication_actions: { value: 4, links: [{ label: '处理失败', href: '/publication-failures' }] },
  content_issues: { value: 5, href: '/issues' },
  geo_accuracy_issues: { value: 6, links: [{ label: '检查准确性', href: '/geo-accuracy' }] },
} satisfies components['schemas']['WorkbenchActionableCounts'];

describe('Workbench 展示模型', () => {
  it('穷尽映射六类 count 并原样保留服务端 href 与多链接文案', () => {
    expect(resolveWorkbenchCounts(counts)).toEqual([
      { key: 'fact_reviews', label: '事实审核', value: 0, links: [{ label: '查看事实审核', href: '/facts' }] },
      { key: 'content_reviews', label: '内容审核', value: 2, links: [{ label: '查看内容审核', href: '/content' }] },
      { key: 'publication_verifications', label: '待核验发布', value: 3, links: [{ label: '查看待核验发布', href: '/verifications' }] },
      { key: 'publication_actions', label: '发布处理', value: 4, links: [{ label: '处理失败', href: '/publication-failures' }] },
      { key: 'content_issues', label: '内容问题', value: 5, links: [{ label: '查看内容问题', href: '/issues' }] },
      { key: 'geo_accuracy_issues', label: 'GEO 准确性问题', value: 6, links: [{ label: '检查准确性', href: '/geo-accuracy' }] },
    ]);
  });

  it('穷尽映射 attention、四域 health、两种状态和三项 GEO rate', () => {
    expect(Object.keys(attentionPresentations)).toEqual([
      'FACT_REVIEW', 'CONTENT_REVIEW', 'PUBLICATION_VERIFICATION',
      'PUBLICATION_ACTION', 'CONTENT_ISSUE', 'GEO_ACCURACY_ISSUE',
    ]);
    expect(healthDomainLabels).toEqual({
      product_facts: '产品事实', content: '内容生产', publication: '发布管理', geo: 'GEO',
    });
    expect(healthStatusPresentations).toEqual({
      CLEAR: { label: '正常', tone: 'success' },
      ATTENTION: { label: '需关注', tone: 'warning' },
    });
    expect(geoRateLabels).toEqual({ discovery_rate: '发现率', mention_rate: '提及率', accuracy_rate: '准确率' });
  });

  it('严格区分 nullable rate 与合法 0', () => {
    expect(formatWorkbenchRate({ numerator: 0, denominator: 0, value: null })).toBe('暂无数据');
    expect(formatWorkbenchRate({ numerator: 0, denominator: 2, value: 0 })).toBe('0%');
  });
});
