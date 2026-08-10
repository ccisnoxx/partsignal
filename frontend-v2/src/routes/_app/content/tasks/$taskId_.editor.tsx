import { createFileRoute } from '@tanstack/react-router';

import { ContentEditorPage } from '@/domains/content/content-editor-page';
import { contentEditorContextQueryOptions } from '@/domains/content/content.api';
import { Button } from '@/design-system/primitives/button';

export const Route = createFileRoute('/_app/content/tasks/$taskId_/editor')({
  staticData: { breadcrumb: 'Content Editor' },
  head: ({ params }) => ({
    meta: [{ title: `Content Editor ${params.taskId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = contentEditorContextQueryOptions(params.taskId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ContentEditorUnexpectedError,
  component: ContentEditorRoute,
});

function ContentEditorRoute() {
  const { taskId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <ContentEditorPage csrfToken={auth.csrfToken} taskId={taskId} />;
}

function ContentEditorUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">Content Editor 发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
