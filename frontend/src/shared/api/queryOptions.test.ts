/** 验证 GEO 洞察查询键和请求始终携带同一组六类筛选。 */
import { queryClient } from '../../app/queryClient';
import { mockFetch } from '../../test/fetchMock';
import { queryKeys } from './queryKeys';
import { auditLogListQueryOptions, geoInsightsQueryOptions } from './queryOptions';
import type { AuditLogListQuery, GeoInsightQuery } from './types';

test('GEO 洞察查询键包含全部筛选并可由 GEO 根键统一失效', async () => {
  const filters = {
    date_from: '2026-06-23',
    date_to: '2026-07-22',
    content_platform_id: '10000000-0000-4000-8000-000000000001',
    geo_platform: 'DeepSeek',
    published_article_id: '20000000-0000-4000-8000-000000000001',
    query_topic_id: '30000000-0000-4000-8000-000000000001',
  } satisfies GeoInsightQuery;
  let requested: URL | undefined;
  mockFetch((request) => {
    requested = new URL(request.url);
    return { body: {} };
  });

  await queryClient.fetchQuery(geoInsightsQueryOptions(filters));

  expect(queryKeys.geo.insight(filters)).toEqual(['geo', 'insights', filters]);
  expect(queryKeys.geo.insight(filters).slice(0, 2)).toEqual(queryKeys.geo.insights);
  expect(queryKeys.geo.insights.slice(0, 1)).toEqual(queryKeys.geo.all);
  for (const [key, value] of Object.entries(filters)) expect(requested?.searchParams.get(key)).toBe(value);
});

test('审计列表查询键与请求共享同一个组合筛选对象', async () => {
  const filters = {
    page: 2,
    page_size: 50,
    created_from: '2026-07-20T00:00:00.000Z',
    created_to: '2026-07-23T00:00:00.000Z',
    actor_id: '10000000-0000-4000-8000-000000000001',
    business_module: 'CONFIGURATION',
    action: 'platform_profile.updated',
    target_type: 'PlatformProfile',
    outcome: 'SUCCESS',
    request_id: 'req-audit-1',
    keyword: 'revision',
  } satisfies AuditLogListQuery;
  let requested: URL | undefined;
  mockFetch((request) => {
    requested = new URL(request.url);
    return { body: { items: [], page: 2, page_size: 50, total: 0 } };
  });

  await queryClient.fetchQuery(auditLogListQueryOptions(filters));

  expect(queryKeys.auditLogListByQuery(filters)).toEqual(['audit-logs', 'list', filters]);
  expect(queryKeys.auditLogListByQuery(filters).slice(0, 1)).toEqual(queryKeys.auditLogs);
  for (const [key, value] of Object.entries(filters)) expect(requested?.searchParams.get(key)).toBe(String(value));
});
