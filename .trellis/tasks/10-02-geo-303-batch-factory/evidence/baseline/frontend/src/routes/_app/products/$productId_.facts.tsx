import { createFileRoute } from '@tanstack/react-router';

import { FactWorkspacePage } from '@/domains/product/fact-workspace-page';
import { productFactsQueryOptions } from '@/domains/product/product.api';
import { Button } from '@/design-system/primitives/button';

export const Route = createFileRoute('/_app/products/$productId_/facts')({
  staticData: { breadcrumb: '事实工作台' },
  head: ({ params }) => ({
    meta: [{ title: `事实工作台 ${params.productId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = productFactsQueryOptions(params.productId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: FactWorkspaceUnexpectedError,
  component: FactWorkspaceRoute,
});

function FactWorkspaceRoute() {
  const { productId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  return <FactWorkspacePage csrfToken={auth.csrfToken} key={productId} productId={productId} />;
}

function FactWorkspaceUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">事实工作台发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
