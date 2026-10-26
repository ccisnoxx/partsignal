import { createFileRoute, Link } from '@tanstack/react-router';

import { FactWorkspacePage } from '@/domains/product/fact-workspace-page';
import { productFactsQueryOptions } from '@/domains/product/product.api';
import { Button } from '@/design-system/primitives/button';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

export const Route = createFileRoute('/_app/products/$productId_/facts')({
  staticData: { breadcrumb: '事实工作台' },
  validateSearch: (raw): { source_opportunity_id?: string } => {
    const result = canonicalUuidSchema.safeParse(raw.source_opportunity_id);
    return result.success ? { source_opportunity_id: result.data } : {};
  },
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
  const { source_opportunity_id: opportunityId } = Route.useSearch();
  return <div className="min-w-0 space-y-4">
    {opportunityId && <nav aria-label="事实修订来源导航" className="break-words text-sm"><Link className="inline-flex min-h-11 items-center text-interaction-primary underline" to="/geo/opportunities" search={{ opportunity_id: opportunityId }}>返回机会 {opportunityId}</Link></nav>}
    <FactWorkspacePage csrfToken={auth.csrfToken} key={productId} productId={productId} />
  </div>;
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
