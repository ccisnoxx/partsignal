import { createFileRoute } from '@tanstack/react-router';

import { ContentEditorPage } from '@/domains/content/content-editor-page';
import { contentEditorContextQueryOptions } from '@/domains/content/content.api';
import { RouteError } from '@/design-system/workspace/route-error';

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
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="Content Editor 发生意外错误" />
  ),
  component: ContentEditorRoute,
});

function ContentEditorRoute() {
  const { taskId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <ContentEditorPage csrfToken={auth.csrfToken} taskId={taskId} />;
}
