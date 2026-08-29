import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/design-system/primitives/button';
import { FactVersionDetailPage } from '@/domains/product/fact-version-detail-page';
import { factVersionQueryOptions } from '@/domains/product/product.api';

export const Route = createFileRoute('/_app/products/$productId_/facts_/versions_/$versionId')({
  staticData: { breadcrumb: '事实版本' },
  head: ({ params }) => ({
    meta: [{ title: `事实版本 ${params.versionId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = factVersionQueryOptions(params.versionId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: FactVersionUnexpectedError,
  component: FactVersionDetailRoute,
});

function FactVersionDetailRoute() {
  const { productId, versionId } = Route.useParams();
  return <FactVersionDetailPage productId={productId} versionId={versionId} />;
}

function FactVersionUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">事实版本页面发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
