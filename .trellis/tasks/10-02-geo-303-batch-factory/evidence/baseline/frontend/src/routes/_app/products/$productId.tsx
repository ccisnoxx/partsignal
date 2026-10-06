import { createFileRoute } from '@tanstack/react-router';

import { productDetailQueryOptions } from '@/domains/product/product.api';
import { ProductDetailPage } from '@/domains/product/product-detail-page';
import { Button } from '@/design-system/primitives/button';

export const Route = createFileRoute('/_app/products/$productId')({
  staticData: { breadcrumb: '产品详情' },
  head: ({ params }) => ({
    meta: [{ title: `产品详情 ${params.productId} | PartSignal` }],
  }),
  loader: ({ context, params }) => {
    const options = productDetailQueryOptions(params.productId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ProductDetailUnexpectedError,
  component: ProductDetailRoute,
});

function ProductDetailRoute() {
  const { productId } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <ProductDetailPage
      csrfToken={auth.csrfToken}
      onDeleted={() => navigate({ to: '/products', search: { page: 1 }, replace: true })}
      productId={productId}
    />
  );
}

function ProductDetailUnexpectedError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">产品详情发生意外错误</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={reset} type="button">重试</Button>
    </section>
  );
}
