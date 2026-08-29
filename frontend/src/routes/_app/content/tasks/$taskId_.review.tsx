import { createFileRoute } from '@tanstack/react-router';

import { RouteError } from '@/design-system/workspace/route-error';
import { ContentReviewPage } from '@/domains/content/content-review-page';
import { contentReviewContextQueryOptions } from '@/domains/content/content.api';

export const Route = createFileRoute('/_app/content/tasks/$taskId_/review')({
  staticData: { breadcrumb: 'Content Review' },
  head: ({ params }) => ({
    meta: [{ title: `Content Review ${params.taskId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = contentReviewContextQueryOptions(params.taskId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="Content Review 发生意外错误" />
  ),
  component: ContentReviewRoute,
});

function ContentReviewRoute() {
  const { taskId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <ContentReviewPage csrfToken={auth.csrfToken} key={taskId} taskId={taskId} />;
}
