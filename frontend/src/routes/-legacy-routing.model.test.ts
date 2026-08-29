import { describe, expect, it } from 'vitest';

import {
  aiConfigurationLegacyHref,
  auditLegacyHref,
  contentTasksLegacyHref,
  geoInsightsLegacyHref,
  geoObservationsLegacyHref,
  platformsLegacyHref,
  promptsLegacyHref,
  publicationsLegacyHref,
  usersLegacyHref,
} from './-legacy-routing.model';

const id = '00000000-0000-4000-8000-000000000001';

describe('legacy routing query 转换', () => {
  it('Content Tasks 只转换精确等价字段', () => {
    expect(contentTasksLegacyHref({
      q: ' sensor ', status: 'COMPLETED', archive_status: 'ARCHIVED',
      platform_profile_id: id, page: '2', filter_product_id: id, unknown: 'drop',
    })).toBe(`/content/tasks?archiveStatus=ARCHIVED&page=2&pageSize=10&q=sensor&workflowStage=VERIFIED&platformId=${id}`);
  });

  it('GEO Observation 和 Insight 使用 canonical parser', () => {
    expect(geoObservationsLegacyHref({
      search: 'model', product_id: id, sort_order: 'ASC', page_size: '50', all_time: '1',
    })).toBe(`/geo/observations?page=1&pageSize=50&q=model&productId=${id}&sort=OBSERVED_ASC`);
    expect(geoInsightsLegacyHref({ date_from: '2026-08-01', date_to: '2026-08-26', product_id: id, filters_collapsed: '1' }, '/geo/insights'))
      .toBe(`/geo/insights?from=2026-08-01&to=2026-08-26&productId=${id}`);
  });

  it('GEO 白名单覆盖日期、主题、平台、准确性与全部 Insight identity', () => {
    const observation = new URL(geoObservationsLegacyHref({
      query_topic_id: id,
      search_platform: 'ChatGPT',
      accuracy: 'PARTIAL',
      date_from: '2026-08-01',
      date_to: '2026-08-26',
      page: '3',
      publication_search: 'drop',
    }), 'https://partsignal.invalid');
    expect(Object.fromEntries(observation.searchParams)).toEqual({
      page: '3', pageSize: '20', queryTopicId: id, geoPlatform: 'ChatGPT',
      accuracy: 'PARTIAL', from: '2026-08-01', to: '2026-08-26',
    });

    const insight = new URL(geoInsightsLegacyHref({
      date_from: '2026-08-01',
      date_to: '2026-08-26',
      content_platform_id: id,
      geo_platform: 'Gemini',
      published_article_id: id,
      query_topic_id: id,
    }, '/geo/insights/print'), 'https://partsignal.invalid');
    expect(Object.fromEntries(insight.searchParams)).toEqual({
      from: '2026-08-01', to: '2026-08-26', contentPlatformId: id,
      geoPlatform: 'Gemini', publishedArticleId: id, queryTopicId: id,
    });
  });

  it('Configuration 只保留目标已有状态', () => {
    expect(platformsLegacyHref({ platform: id, q: 'ignored' }, 'platform'))
      .toBe(`/settings/platforms/${id}?tab=accounts`);
    expect(promptsLegacyHref({ platform_prompt_id: id, tab: 'humanization' }))
      .toBe(`/settings/prompts?promptId=${id}`);
    expect(aiConfigurationLegacyHref({ status: 'enabled', provider_brand: 'OPENAI', page_size: '10' }))
      .toBe('/settings/ai?page=1&pageSize=10&status=ENABLED&provider=OPENAI');
  });

  it('Configuration list 白名单覆盖筛选、分页、新建与 AI 枚举', () => {
    expect(platformsLegacyHref({
      q: ' profile ', platform_type_id: id, status: 'DISABLED', page: '2',
      page_size: '50', configuration_status: 'COMPLETE',
    }, 'platform')).toBe(
      `/settings/platforms?page=2&pageSize=50&q=profile&platformTypeId=${id}&status=DISABLED`,
    );
    expect(promptsLegacyHref({ platform_prompt_id: id, new: '1', q: 'drop' }))
      .toBe('/settings/prompts?new=1');
    expect(aiConfigurationLegacyHref({
      q: ' channel ', status: 'disabled', provider_brand: 'ANTHROPIC',
      sort: 'NAME_ASC', page: '4', page_size: '50', tab: 'logs',
    })).toBe('/settings/ai?page=4&pageSize=50&q=channel&status=DISABLED&provider=ANTHROPIC&sort=NAME_ASC');
    expect(aiConfigurationLegacyHref({ status: 'all' }))
      .toBe('/settings/ai?page=1&pageSize=20');
  });

  it('System query 按 snake_case 白名单转换', () => {
    expect(usersLegacyHref({ q: 'xx', account_type: 'ADMIN', page_size: '50', extra: 'drop' }))
      .toBe('/system/users?status=ENABLED&page=1&pageSize=50&q=xx&accountType=ADMIN');
    const audit = auditLegacyHref({
      created_from: '2026-08-01T00:00:00Z', created_to: '2026-08-02T00:00:00Z',
      business_module: 'PUBLICATION', request_id: 'req-1', all_time: '1',
    });
    expect(audit).toContain('/system/audit?page=1&pageSize=20');
    expect(audit).toContain('&module=PUBLICATION&requestId=req-1');
    expect(audit).not.toContain('all_time');
  });

  it('System 白名单覆盖状态、主体、动作、目标、结果与分页', () => {
    expect(usersLegacyHref({
      q: ' user ', account_type: 'ENGINEER', status: 'ALL', page: '3', page_size: '10',
    })).toBe('/system/users?status=ALL&page=3&pageSize=10&q=user&accountType=ENGINEER');

    const audit = new URL(auditLegacyHref({
      created_from: '2026-08-01T00:00:00Z',
      created_to: '2026-08-02T00:00:00Z',
      actor_id: id,
      business_module: 'PUBLICATION',
      action: 'UPDATE',
      target_type: 'PublicationWork',
      outcome: 'SUCCESS',
      request_id: 'req-1',
      keyword: 'sensor',
      page: '2',
      page_size: '50',
      target_id: 'drop',
    }), 'https://partsignal.invalid');
    expect(Object.fromEntries(audit.searchParams)).toEqual({
      page: '2', pageSize: '50', createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T00:00:00.000Z', actorId: id, module: 'PUBLICATION',
      action: 'UPDATE', targetType: 'PublicationWork', outcome: 'SUCCESS',
      requestId: 'req-1', keyword: 'sensor',
    });
  });

  it('Publishing 严格执行详情、文章、问题与 closed work 优先级', () => {
    expect(publicationsLegacyHref({ kind: 'work', selected: id }))
      .toBe(`/publishing/work/${id}`);
    expect(publicationsLegacyHref({ kind: 'article', selected: id }))
      .toBe(`/publishing/articles/${id}`);
    expect(publicationsLegacyHref({ kind: 'issue', selected: id, tab: 'articles' }))
      .toBe(`/publishing/issues/${id}`);
    expect(publicationsLegacyHref({ tab: 'articles', page: '3', status: 'RESOLVED' }))
      .toBe('/publishing/articles?page=3&pageSize=20');
    expect(publicationsLegacyHref({ tab: 'history', status: 'RESOLVED', page: '4' }))
      .toBe('/publishing/issues?status=RESOLVED&page=4&pageSize=20');
    expect(publicationsLegacyHref({ tab: 'history', work_page: '5' }))
      .toBe('/publishing/work?page=5&pageSize=20&status=CLOSED');
    expect(publicationsLegacyHref({ status: 'ACTION_REQUIRED', work_page: '2', selected: id }))
      .toBe('/publishing/work?page=2&pageSize=20&status=ACTION_REQUIRED');
    expect(publicationsLegacyHref({ status: 'CLOSED', selected: id, unknown: 'drop' }))
      .toBe('/publishing/work?page=1&pageSize=20');
  });
});
