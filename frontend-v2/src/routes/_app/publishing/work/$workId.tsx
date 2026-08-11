import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { publicationWorkspaceContextQueryOptions } from '@/domains/publication/publication.api';
import { PublicationWorkspacePage } from '@/domains/publication/publication-workspace-page';
import {
  isCanonicalPublicationWorkspaceHash,
  type PublicationWorkspaceSection,
} from '@/domains/publication/publication-workspace.model';

export const Route = createFileRoute('/_app/publishing/work/$workId')({
  staticData: { breadcrumb: '发布工作台' },
  head: ({ params }) => ({
    meta: [{ title: `发布工作 ${params.workId} | PartSignal` }],
  }),
  beforeLoad: ({ location, params }) => {
    if (!z.uuid().safeParse(params.workId).success) {
      throw new Error(`发布工作 ID 不是有效 UUID：${params.workId}`);
    }
    if (!isCanonicalPublicationWorkspaceHash(location.hash)) {
      throw redirect({
        to: '/publishing/work/$workId',
        params,
        hash: 'summary',
        replace: true,
      });
    }
  },
  loader: ({ context, params }) => {
    const options = publicationWorkspaceContextQueryOptions(params.workId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublicationWorkspaceRoute,
});

function PublicationWorkspaceRoute() {
  const { workId } = Route.useParams();
  const { auth, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <PublicationWorkspacePage
      csrfToken={auth.csrfToken}
      key={workId}
      onContentProjectionChange={async (taskId) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.editorContext(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.reviewContext(taskId) }),
        ]);
      }}
      onSectionChange={(section: PublicationWorkspaceSection) => navigate({ hash: section })}
      workId={workId}
    />
  );
}
