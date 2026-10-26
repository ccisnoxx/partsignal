import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { PrincipalContinuation } from '@/app/auth/principal-epoch';
import { contentKeys } from '@/domains/content/content.api';
import { insightKeys } from '@/domains/geo-insights/insights.api';
import { reportKeys } from '@/domains/geo-reports/reports.api';
import { publicationKeys } from '@/domains/publication/publication.api';
import { api } from '@/shared/api/client';
import { headers, opportunityKeys, OpportunityRequestError, requestError } from './opportunities.api';
import type { RepairMode, RepairSubmission } from './opportunity-publication-repair.model';

const optionKey = (id: string) => ['geo', 'opportunities', 'publication-repair-options', id] as const;
export function publicationRepairOptions(id: string, mode: RepairMode, page: number, selectedIssueId: string | undefined, enabled: boolean) {
  return queryOptions({
    queryKey: [...optionKey(id), mode, page, selectedIssueId ?? null], enabled,
    retry: false, retryOnMount: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/geo/opportunities/{opportunity_id}/publication-repair-options', {
        params: { path: { opportunity_id: id }, query: { mode, page, page_size: 20, selected_issue_id: selectedIssueId } }, signal, cache: 'no-store',
      });
      if (!result.data) throw requestError('读取发布问题与修复选项', result);
      const data = result.data; const context = data.repair_context;
      if (data.opportunity_id !== id || data.mode !== mode || data.page !== page
        || data.candidates.some((item) => mode === 'OPEN_ISSUE' ? item.published_content_issue_id !== null || item.issue_revision !== null : !item.published_content_issue_id || item.issue_revision === null)
        || (context && (context.issue.id !== selectedIssueId || context.article.id !== context.issue.published_article_id || context.original_task.id !== context.article.task_id || context.product.id !== context.original_task.product_id))
        || (selectedIssueId && data.available_action_types.includes('PUBLICATION_REPAIR') && !context)) throw new OpportunityRequestError('发布修复选项身份与请求不一致');
      return data;
    },
  });
}
export async function startPublicationRepair(id: string, submission: RepairSubmission, csrfToken: string | null, signal: AbortSignal) {
  const { command: request, articleId } = submission; const body = request.body;
  const result = await api.POST('/api/v1/geo/opportunities/{opportunity_id}/actions/publication-repair', {
    params: { path: { opportunity_id: id }, header: { ...headers(csrfToken), 'Idempotency-Key': request.key } }, body, signal, cache: 'no-store',
  });
  if (!result.data) throw requestError('登记发布修复行动', result);
  const action = result.data.action; const source = action.source_snapshot;
  const task = body.mode === 'CREATE_REPAIR';
  const targetPath = task ? `/content/tasks/${action.target_id}` : `/publishing/issues/${action.target_id}`;
  if (action.action_type !== 'PUBLICATION_REPAIR' || action.target_type !== (task ? 'ContentTask' : 'PublishedContentIssue')
    || result.data.opportunity_revision !== body.expected_revision + 1 || !source
    || source.opportunity_id !== id || source.opportunity_revision !== body.expected_revision || source.published_article_id !== articleId
    || (body.mode === 'OPEN_ISSUE' ? source.published_content_issue_id !== action.target_id || articleId !== body.published_article_id
      : source.published_content_issue_id !== body.published_content_issue_id || (!task && action.target_id !== body.published_content_issue_id))
    || (body.mode === 'CREATE_REPAIR' && source.fact_version_id !== body.fact_version_id)
    || typeof action.target_available !== 'boolean'
    || (action.target_available ? action.navigation_path !== `${targetPath}?source_opportunity_id=${id}` : action.navigation_path !== null)) throw new OpportunityRequestError('发布修复回执与原请求不一致，请保留原请求核对结果');
  return result.data;
}
export async function invalidatePublicationRepair(client: QueryClient, id: string, owner: PrincipalContinuation) {
  const keys = [opportunityKeys.lists(), opportunityKeys.details(id), opportunityKeys.comparisons(id), optionKey(id), publicationKeys.all(),
    contentKeys.lists(), contentKeys.details(), [...insightKeys.root, 'overview'], reportKeys.root];
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
