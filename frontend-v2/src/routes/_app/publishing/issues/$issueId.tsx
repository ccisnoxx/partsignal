import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { publishedContentIssueWorkspaceQueryOptions } from '@/domains/publication/publication.api';
import {
  isCanonicalIssueWorkspaceHash,
  type PublishedContentIssueWorkspaceSection,
} from '@/domains/publication/published-content-issue.model';
import { PublishedContentIssueWorkspacePage } from '@/domains/publication/published-content-issue-workspace-page';

export const Route = createFileRoute('/_app/publishing/issues/$issueId')({
  staticData: { breadcrumb: '问题工作区' },
  head: ({ params }) => ({
    meta: [{ title: `内容问题 ${params.issueId} | PartSignal` }],
  }),
  beforeLoad: ({ location, params }) => {
    if (!z.uuid().safeParse(params.issueId).success) {
      throw new Error(`内容问题 ID 不是有效 UUID：${params.issueId}`);
    }
    if (!isCanonicalIssueWorkspaceHash(location.hash)) {
      throw redirect({
        to: '/publishing/issues/$issueId',
        params,
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
  const { auth, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <PublishedContentIssueWorkspacePage
      csrfToken={auth.csrfToken}
      issueId={issueId}
      key={issueId}
      onContentProjectionChange={async (taskId) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.editorContext(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.reviewContext(taskId) }),
        ]);
      }}
      onSectionChange={(section: PublishedContentIssueWorkspaceSection) => navigate({ hash: section })}
    />
  );
}
