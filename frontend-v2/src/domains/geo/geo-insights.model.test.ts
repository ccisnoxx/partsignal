import { describe, expect, it } from 'vitest';

import {
  contentInsightHref,
  coverageInsightHref,
  defaultGeoInsightDates,
  formatInsightChange,
  formatInsightRate,
  geoInsightSearchSchema,
  geoInsightSearchToApiParams,
  isCanonicalGeoInsightSearch,
  toGeoOptimizationCreate,
} from './geo-insights.model';

const articleId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000001';
const platformId = '30000000-0000-4000-8000-000000000001';
const topicId = '40000000-0000-4000-8000-000000000001';
const factId = '50000000-0000-4000-8000-000000000001';
const period = { date_from: '2026-07-15', date_to: '2026-08-13' };

describe('GEO Insights URL 与动作模型', () => {
  it('使用 UTC 30 日默认周期，并把合法筛选一一映射到 API', () => {
    expect(defaultGeoInsightDates(new Date('2026-08-13T23:30:00-07:00'))).toEqual({
      from: '2026-07-16',
      to: '2026-08-14',
    });
    const search = geoInsightSearchSchema.parse({
      from: '2026-07-15', to: '2026-08-13', productId: productId.toUpperCase(),
      contentPlatformId: platformId, geoPlatform: '  DeepSeek  ',
      publishedArticleId: articleId, queryTopicId: topicId, ignored: 'x',
    });
    expect(geoInsightSearchToApiParams(search)).toEqual({
      date_from: '2026-07-15', date_to: '2026-08-13', product_id: productId,
      content_platform_id: platformId, geo_platform: 'DeepSeek',
      published_article_id: articleId, query_topic_id: topicId,
    });
    expect(isCanonicalGeoInsightSearch({ ...search }, search)).toBe(true);
    expect(isCanonicalGeoInsightSearch({ ...search, ignored: 'x' }, search)).toBe(false);
  });

  it('不把空分母或不可比较变化伪装成 0%', () => {
    expect(formatInsightRate({ numerator: 0, denominator: 0, value: null })).toBe('暂无数据');
    expect(formatInsightRate({ numerator: 0, denominator: 2, value: 0 })).toBe('0%');
    expect(formatInsightChange({ current: { numerator: 1, denominator: 2, value: 0.5 }, previous: { numerator: 0, denominator: 0, value: null }, change: null, points: [] })).toBe('上一周期暂无样本');
    expect(formatInsightChange({ current: { numerator: 1, denominator: 2, value: 0.5 }, previous: { numerator: 0, denominator: 2, value: 0 }, change: null, points: [] })).toBe('相对变化不可计算');
  });

  it('只按服务端 primary task 生成精确 drill-down 或命令 body', () => {
    const content = {
      published_article_id: articleId, product_id: productId,
      content_platform_id: platformId, title: '文章', content_platform: '官网',
      observation_count: 2,
      discovery_rate: { numerator: 2, denominator: 2, value: 1 },
      mention_rate: { numerator: 1, denominator: 2, value: 0.5 },
      accuracy_rate: { numerator: 1, denominator: 1, value: 1 },
      primary_task: 'VIEW_CONTENT_PERFORMANCE' as const,
      optimization_action: null,
    };
    expect(contentInsightHref(content, period)).toBe(`/publishing/articles/${articleId}`);
    expect(coverageInsightHref({
      query_topic_id: topicId, canonical_question: '问题', geo_platform: 'DeepSeek',
      status: 'UNCOVERED', observation_count: 1, mentioned_observation_count: 0,
      coverage_rate: { numerator: 0, denominator: 1, value: 0 },
      primary_task: 'ADD_OBSERVATION', optimization_action: null,
    }, period)).toBe(`/geo/observations/new?queryTopicId=${topicId}&geoPlatform=DeepSeek`);
    const action = { rule_code: 'CONTENT_DECLINE' as const, ...period, published_article_id: articleId, query_topic_id: null, geo_platform: null };
    expect(toGeoOptimizationCreate(action, {
      product_id: productId, platform_profile_id: platformId, fact_version_id: factId,
    })).toEqual({ ...action, product_id: productId, platform_profile_id: platformId, fact_version_id: factId });
  });
});
