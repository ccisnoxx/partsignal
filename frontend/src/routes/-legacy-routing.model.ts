import {
  canonicalAuditSearchRecord,
  auditSearchSchema,
} from '@/domains/audit/audit.model';
import {
  canonicalAIChannelSearchRecord,
  aiChannelSearchSchema,
} from '@/domains/configuration/ai-channel-list.model';
import {
  canonicalPlatformSearchRecord,
  platformSearchSchema,
} from '@/domains/configuration/platform-list.model';
import {
  canonicalPromptWorkspaceSearchRecord,
  promptWorkspaceSearchSchema,
} from '@/domains/configuration/prompt-workspace.model';
import {
  canonicalContentTasksSearchRecord,
  contentTasksSearchSchema,
} from '@/domains/content/content-task-list.model';
import {
  canonicalGeoInsightSearchRecord,
  geoInsightSearchSchema,
} from '@/domains/geo/geo-insights.model';
import {
  canonicalGeoObservationSearchRecord,
  geoObservationSearchSchema,
} from '@/domains/geo/geo-observation-list.model';
import {
  canonicalUserSearchRecord,
  userSearchSchema,
} from '@/domains/identity/user-list.model';
import {
  canonicalPublicationWorkSearchRecord,
  publicationWorkSearchSchema,
} from '@/domains/publication/publication-work.model';
import {
  canonicalPublishedArticleSearchRecord,
  publishedArticleSearchSchema,
} from '@/domains/publication/published-article.model';
import {
  canonicalIssueSearchRecord,
  issueSearchSchema,
} from '@/domains/publication/published-content-issue.model';

type RawSearch = Record<string, unknown>;
type CanonicalSearch = Record<string, string | number>;

function value(search: RawSearch, key: string) {
  const current = search[key];
  return typeof current === 'string' || typeof current === 'number'
    ? String(current)
    : undefined;
}

function href(pathname: string, search?: CanonicalSearch) {
  if (!search) return pathname;
  const params = new URLSearchParams();
  for (const [key, current] of Object.entries(search)) params.set(key, String(current));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function contentTasksLegacyHref(raw: RawSearch) {
  const status = value(raw, 'status');
  const search = contentTasksSearchSchema.parse({
    q: value(raw, 'q'),
    workflowStage: status === 'CANCELLED'
      ? 'CANCELLED'
      : status === 'COMPLETED' ? 'VERIFIED' : undefined,
    archiveStatus: value(raw, 'archive_status'),
    platformId: value(raw, 'platform_profile_id'),
    page: value(raw, 'page'),
    pageSize: 10,
  });
  return href('/content/tasks', canonicalContentTasksSearchRecord(search));
}

function geoObservationsLegacyHref(raw: RawSearch) {
  const sortOrder = value(raw, 'sort_order');
  const search = geoObservationSearchSchema.parse({
    q: value(raw, 'search'),
    productId: value(raw, 'product_id'),
    queryTopicId: value(raw, 'query_topic_id'),
    geoPlatform: value(raw, 'search_platform'),
    accuracy: value(raw, 'accuracy'),
    from: value(raw, 'date_from'),
    to: value(raw, 'date_to'),
    sort: sortOrder === 'ASC'
      ? 'OBSERVED_ASC'
      : sortOrder === 'DESC' ? 'OBSERVED_DESC' : undefined,
    page: value(raw, 'page'),
    pageSize: value(raw, 'page_size'),
  });
  return href('/geo/observations', canonicalGeoObservationSearchRecord(search));
}

function geoInsightsLegacyHref(
  raw: RawSearch,
  pathname: '/geo/insights' | '/geo/insights/print',
) {
  const search = geoInsightSearchSchema.parse({
    from: value(raw, 'date_from'),
    to: value(raw, 'date_to'),
    productId: value(raw, 'product_id'),
    contentPlatformId: value(raw, 'content_platform_id'),
    geoPlatform: value(raw, 'geo_platform'),
    publishedArticleId: value(raw, 'published_article_id'),
    queryTopicId: value(raw, 'query_topic_id'),
  });
  return href(pathname, canonicalGeoInsightSearchRecord(search));
}

function platformsLegacyHref(raw: RawSearch, selectedKey: 'platform' | 'platform_profile_id') {
  const selected = value(raw, selectedKey);
  if (selected) return href(`/settings/platforms/${encodeURIComponent(selected)}`, { tab: 'accounts' });

  const search = platformSearchSchema.parse({
    q: value(raw, 'q'),
    platformTypeId: value(raw, 'platform_type_id'),
    status: value(raw, 'status'),
    page: value(raw, 'page'),
    pageSize: value(raw, 'page_size'),
  });
  return href('/settings/platforms', canonicalPlatformSearchRecord(search));
}

function promptsLegacyHref(raw: RawSearch) {
  const search = promptWorkspaceSearchSchema.parse({
    promptId: value(raw, 'platform_prompt_id'),
    new: value(raw, 'new'),
  });
  return href('/settings/prompts', canonicalPromptWorkspaceSearchRecord(search));
}

function aiConfigurationLegacyHref(raw: RawSearch) {
  const legacyStatus = value(raw, 'status');
  const search = aiChannelSearchSchema.parse({
    q: value(raw, 'q'),
    status: legacyStatus === 'enabled'
      ? 'ENABLED'
      : legacyStatus === 'disabled' ? 'DISABLED' : undefined,
    provider: value(raw, 'provider_brand'),
    sort: value(raw, 'sort'),
    page: value(raw, 'page'),
    pageSize: value(raw, 'page_size'),
  });
  return href('/settings/ai', canonicalAIChannelSearchRecord(search));
}

function usersLegacyHref(raw: RawSearch) {
  const search = userSearchSchema.parse({
    q: value(raw, 'q'),
    accountType: value(raw, 'account_type'),
    status: value(raw, 'status'),
    page: value(raw, 'page'),
    pageSize: value(raw, 'page_size'),
  });
  return href('/system/users', canonicalUserSearchRecord(search));
}

function auditLegacyHref(raw: RawSearch) {
  const search = auditSearchSchema.parse({
    createdFrom: value(raw, 'created_from'),
    createdTo: value(raw, 'created_to'),
    actorId: value(raw, 'actor_id'),
    module: value(raw, 'business_module'),
    action: value(raw, 'action'),
    targetType: value(raw, 'target_type'),
    outcome: value(raw, 'outcome'),
    requestId: value(raw, 'request_id'),
    keyword: value(raw, 'keyword'),
    page: value(raw, 'page'),
    pageSize: value(raw, 'page_size'),
  });
  return href('/system/audit', canonicalAuditSearchRecord(search));
}

const activePublicationStatuses = [
  'PREPARING',
  'PLATFORM_REVIEW',
  'AWAITING_VERIFICATION',
  'ACTION_REQUIRED',
] as const;

function publicationsLegacyHref(raw: RawSearch) {
  const selected = value(raw, 'selected');
  const kind = value(raw, 'kind');
  if (selected && kind === 'work') return `/publishing/work/${encodeURIComponent(selected)}`;
  if (selected && kind === 'article') return `/publishing/articles/${encodeURIComponent(selected)}`;
  if (selected && kind === 'issue') return `/publishing/issues/${encodeURIComponent(selected)}`;

  const tab = value(raw, 'tab');
  if (tab === 'articles') {
    const search = publishedArticleSearchSchema.parse({ page: value(raw, 'page'), pageSize: 20 });
    return href('/publishing/articles', canonicalPublishedArticleSearchRecord(search));
  }

  if (tab === 'history' && value(raw, 'status') === 'RESOLVED') {
    const search = issueSearchSchema.parse({ status: 'RESOLVED', page: value(raw, 'page'), pageSize: 20 });
    return href('/publishing/issues', canonicalIssueSearchRecord(search));
  }

  const legacyStatus = value(raw, 'status');
  const status = tab === 'history'
    ? 'CLOSED'
    : activePublicationStatuses.find((candidate) => candidate === legacyStatus);
  const search = publicationWorkSearchSchema.parse({
    status,
    page: value(raw, 'work_page') ?? value(raw, 'page'),
    pageSize: 20,
  });
  return href('/publishing/work', canonicalPublicationWorkSearchRecord(search));
}

export {
  aiConfigurationLegacyHref,
  auditLegacyHref,
  contentTasksLegacyHref,
  geoInsightsLegacyHref,
  geoObservationsLegacyHref,
  platformsLegacyHref,
  promptsLegacyHref,
  publicationsLegacyHref,
  usersLegacyHref,
};
