import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/design-system/primitives/button';
import { FactReviewPage } from '@/domains/product/fact-review-page';
import { productFactReviewQueryOptions } from '@/domains/product/product.api';

export const Route = createFileRoute('/_app/products/$productId_/facts_/review')({
  staticData: { breadcrumb: '事实审核' },
  head: ({ params }) => ({
    meta: [{ title: `事实审核 ${params.productId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = productFactReviewQueryOptions(params.productId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: FactReviewUnexpectedError,
  component: FactReviewRoute,
});

function FactReviewRoute() {
  const { productId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <FactReviewPage csrfToken={auth.csrfToken} key={productId} productId={productId} />;
}

function FactReviewUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">事实审核工作台发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
