import { createFileRoute } from '@tanstack/react-router';

import { RouteError } from '@/design-system/workspace/route-error';
import { contentVersionDetailQueryOptions } from '@/domains/content/content.api';
import { ContentVersionDetailPage } from '@/domains/content/content-version-detail-page';

export const Route = createFileRoute('/_app/content/versions_/$versionId')({
  staticData: { breadcrumb: '内容版本' },
  head: ({ params }) => ({
    meta: [{ title: `内容版本 ${params.versionId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = contentVersionDetailQueryOptions(params.versionId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="内容版本页面发生意外错误" />
  ),
  component: ContentVersionDetailRoute,
});

function ContentVersionDetailRoute() {
  const { versionId } = Route.useParams();
  return <ContentVersionDetailPage versionId={versionId} />;
}
