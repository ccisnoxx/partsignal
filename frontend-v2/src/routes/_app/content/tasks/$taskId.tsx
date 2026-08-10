import { createFileRoute } from '@tanstack/react-router';

import { contentTaskDetailQueryOptions } from '@/domains/content/content.api';
import { ContentTaskDetailPage } from '@/domains/content/content-task-detail-page';
import { Button } from '@/design-system/primitives/button';

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
  errorComponent: ContentTaskDetailUnexpectedError,
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

function ContentTaskDetailUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">内容任务详情发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
