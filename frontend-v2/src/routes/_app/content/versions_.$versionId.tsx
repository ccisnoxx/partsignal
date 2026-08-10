import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/design-system/primitives/button';
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
  errorComponent: ContentVersionUnexpectedError,
  component: ContentVersionDetailRoute,
});

function ContentVersionDetailRoute() {
  const { versionId } = Route.useParams();
  return <ContentVersionDetailPage versionId={versionId} />;
}

function ContentVersionUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">内容版本页面发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
