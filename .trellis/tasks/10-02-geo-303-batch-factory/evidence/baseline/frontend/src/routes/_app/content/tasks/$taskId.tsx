import { createFileRoute } from '@tanstack/react-router';

import { contentTaskDetailQueryOptions } from '@/domains/content/content.api';
import { ContentTaskDetailPage } from '@/domains/content/content-task-detail-page';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/content/tasks/$taskId')({
  staticData: { breadcrumb: '内容任务详情' },
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
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <ContentTaskDetailPage
      csrfToken={auth.csrfToken}
      onDeleted={() => navigate({
        to: '/content/tasks',
        search: { archiveStatus: 'ACTIVE', page: 1, pageSize: 20 },
        replace: true,
      })}
      taskId={taskId}
    />
  );
}
