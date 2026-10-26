import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { publishedContentIssueWorkspaceQueryOptions } from '@/domains/publication/publication.api';
import {
  isCanonicalIssueWorkspaceHash,
  type PublishedContentIssueWorkspaceSection,
} from '@/domains/publication/published-content-issue.model';
import { PublishedContentIssueWorkspacePage } from '@/domains/publication/published-content-issue-workspace-page';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

export const Route = createFileRoute('/_app/publishing/issues/$issueId')({
  staticData: { breadcrumb: '问题工作区' },
  validateSearch: (raw): { source_opportunity_id?: string } => {
    const result = canonicalUuidSchema.safeParse(raw.source_opportunity_id);
    return result.success ? { source_opportunity_id: result.data } : {};
  },
  head: ({ params }) => ({
    meta: [{ title: `内容问题 ${params.issueId} | PartSignal` }],
  }),
  beforeLoad: ({ location, params, search }) => {
    if (!z.uuid().safeParse(params.issueId).success) {
      throw new Error(`内容问题 ID 不是有效 UUID：${params.issueId}`);
    }
    if (!isCanonicalIssueWorkspaceHash(location.hash)) {
      throw redirect({
        to: '/publishing/issues/$issueId',
        params,
        search,
        hash: 'issue',
        replace: true,
      });
    }
  },
  loader: ({ context, params }) => {
    const options = publishedContentIssueWorkspaceQueryOptions(params.issueId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublishedContentIssueRoute,
});

function PublishedContentIssueRoute() {
  const { issueId } = Route.useParams();
  const { source_opportunity_id: opportunityId } = Route.useSearch();
  const { auth, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <div className="min-w-0 space-y-4">
      {opportunityId && <nav aria-label="发布修复来源导航" className="break-words text-sm"><Link className="inline-flex min-h-11 items-center text-interaction-primary underline" to="/geo/opportunities" search={{ opportunity_id: opportunityId }}>返回机会 {opportunityId}</Link></nav>}
      <PublishedContentIssueWorkspacePage
        csrfToken={auth.csrfToken}
        issueId={issueId}
        key={issueId}
        onContentProjectionChange={async (taskId, continuation) => {
          if (!continuation.isCurrent()) return;
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
            queryClient.invalidateQueries({ queryKey: contentKeys.detail(taskId) }),
            queryClient.invalidateQueries({ queryKey: contentKeys.editorContext(taskId) }),
            queryClient.invalidateQueries({ queryKey: contentKeys.reviewContext(taskId) }),
          ]);
          if (!continuation.isCurrent()) return;
        }}
        onSectionChange={(section: PublishedContentIssueWorkspaceSection) => navigate({ hash: section, search: true })}
      />
    </div>
  );
}
