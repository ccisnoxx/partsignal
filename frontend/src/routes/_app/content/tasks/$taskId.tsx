import { createFileRoute, Link } from '@tanstack/react-router';

import { contentTaskDetailQueryOptions } from '@/domains/content/content.api';
import { ContentTaskDetailPage } from '@/domains/content/content-task-detail-page';
import { RouteError } from '@/design-system/workspace/route-error';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

export const Route = createFileRoute('/_app/content/tasks/$taskId')({
  staticData: { breadcrumb: '内容任务详情' },
  validateSearch: (raw): { source_opportunity_id?: string } => {
    const result = canonicalUuidSchema.safeParse(raw.source_opportunity_id);
    return result.success ? { source_opportunity_id: result.data } : {};
  },
  head: ({ params }) => ({
    meta: [{ title: `内容任务 ${params.taskId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = contentTaskDetailQueryOptions(params.taskId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="内容任务详情发生意外错误" />
  ),
  component: ContentTaskDetailRoute,
});

function ContentTaskDetailRoute() {
  const { taskId } = Route.useParams();
  const { source_opportunity_id: opportunityId } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <div className="min-w-0 space-y-4">
      {opportunityId && <nav aria-label="发布修复来源导航" className="break-words text-sm"><Link className="inline-flex min-h-11 items-center text-interaction-primary underline" to="/geo/opportunities" search={{ opportunity_id: opportunityId }}>返回机会 {opportunityId}</Link></nav>}
      <ContentTaskDetailPage
        csrfToken={auth.csrfToken}
        onDeleted={() => navigate({
          to: '/content/tasks',
          search: { archiveStatus: 'ACTIVE', page: 1, pageSize: 20 },
          replace: true,
        })}
        taskId={taskId}
      />
    </div>
  );
}
