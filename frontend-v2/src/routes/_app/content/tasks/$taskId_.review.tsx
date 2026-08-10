import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/design-system/primitives/button';
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
  errorComponent: ContentReviewUnexpectedError,
  component: ContentReviewRoute,
});

function ContentReviewRoute() {
  const { taskId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <ContentReviewPage csrfToken={auth.csrfToken} key={taskId} taskId={taskId} />;
}

function ContentReviewUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">Content Review 发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
